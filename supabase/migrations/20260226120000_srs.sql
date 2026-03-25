-- Non-stationary SRS: words (ensure schema), user_words, review_events, exposure_events, RLS, indexes, RPCs
-- If words already exists with (language, definition): we alter. If not: we create.

-- Ensure words table has the SRS schema (lang, rank, lemma, surface, pos, freq, extra)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'words') THEN
    -- Alter existing words: add new columns if missing, migrate language/definition
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'words' AND column_name = 'lang') THEN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'words' AND column_name = 'language') THEN
        ALTER TABLE public.words RENAME COLUMN language TO lang;
      ELSE
        ALTER TABLE public.words ADD COLUMN IF NOT EXISTS lang text;
      END IF;
    END IF;
    ALTER TABLE public.words ADD COLUMN IF NOT EXISTS surface text;
    ALTER TABLE public.words ADD COLUMN IF NOT EXISTS pos text;
    ALTER TABLE public.words ADD COLUMN IF NOT EXISTS freq numeric;
    ALTER TABLE public.words ADD COLUMN IF NOT EXISTS extra jsonb;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'words' AND column_name = 'definition') THEN
      UPDATE public.words SET extra = COALESCE(extra, '{}'::jsonb) || jsonb_build_object('definition', definition) WHERE definition IS NOT NULL;
      ALTER TABLE public.words DROP COLUMN IF EXISTS definition;
    END IF;
  ELSE
    CREATE TABLE public.words (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lang text NOT NULL,
      rank int NOT NULL,
      lemma text NOT NULL,
      surface text,
      pos text,
      freq numeric,
      extra jsonb,
      CONSTRAINT words_lang_rank_unique UNIQUE (lang, rank)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS words_lang_lemma_unique ON public.words (lang, lemma);
  END IF;
END $$;

-- Drop old user_words if it exists (SM-2 schema); we recreate with half-life schema
DROP TABLE IF EXISTS public.user_words CASCADE;

CREATE TABLE public.user_words (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word_id uuid NOT NULL REFERENCES public.words(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'learning' CHECK (status IN ('learning', 'known', 'suspended')),
  half_life_hours numeric NOT NULL DEFAULT 8,
  target_p numeric NOT NULL DEFAULT 0.85,
  last_review_at timestamptz,
  due_at timestamptz NOT NULL DEFAULT now(),
  reps int NOT NULL DEFAULT 0,
  lapses int NOT NULL DEFAULT 0,
  ewma_surprise numeric NOT NULL DEFAULT 0,
  ewma_abs_surprise numeric NOT NULL DEFAULT 0,
  ewma_accuracy numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, word_id),
  CONSTRAINT user_words_target_p_range CHECK (target_p >= 0.75 AND target_p <= 0.95),
  CONSTRAINT user_words_half_life_range CHECK (half_life_hours >= 0.25 AND half_life_hours <= 17520)
);

CREATE INDEX user_words_user_due ON public.user_words (user_id, due_at);

CREATE TABLE public.review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word_id uuid NOT NULL REFERENCES public.words(id) ON DELETE CASCADE,
  happened_at timestamptz NOT NULL DEFAULT now(),
  grade text NOT NULL CHECK (grade IN ('again', 'hard', 'good', 'easy')),
  correct boolean NOT NULL,
  ms_spent int NOT NULL,
  user_answer text NOT NULL,
  expected text[] NOT NULL DEFAULT '{}',
  p_pred numeric,
  delta_hours numeric,
  half_life_before numeric,
  half_life_after numeric
);

CREATE INDEX review_events_user_happened ON public.review_events (user_id, happened_at DESC);
CREATE INDEX review_events_user_word_happened ON public.review_events (user_id, word_id, happened_at DESC);

CREATE TABLE public.exposure_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word_id uuid NOT NULL REFERENCES public.words(id) ON DELETE CASCADE,
  happened_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('reader_tap', 'reader_seen', 'listening_seen')),
  weight numeric NOT NULL DEFAULT 0.1
);

CREATE INDEX exposure_events_user_happened ON public.exposure_events (user_id, happened_at DESC);
CREATE INDEX exposure_events_user_word_happened ON public.exposure_events (user_id, word_id, happened_at DESC);

-- Ensure words has (lang, rank) unique and index for queue (dedupe first if needed)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'words_lang_rank_unique' AND conrelid = 'public.words'::regclass) THEN
    -- Deduplicate: keep one row per (lang, rank) with smallest id; point user_words to it, then delete duplicates
    IF EXISTS (SELECT 1 FROM public.words GROUP BY lang, rank HAVING count(*) > 1) THEN
      UPDATE public.user_words uw
      SET word_id = k.keep_id
      FROM (
        SELECT w.id AS old_id, (SELECT w2.id FROM public.words w2 WHERE w2.lang = w.lang AND w2.rank = w.rank ORDER BY w2.id LIMIT 1) AS keep_id
        FROM public.words w
      ) k
      WHERE uw.word_id = k.old_id AND k.old_id <> k.keep_id;
      DELETE FROM public.words w
      WHERE EXISTS (
        SELECT 1 FROM public.words w2
        WHERE w2.lang = w.lang AND w2.rank = w.rank AND w2.id < w.id
      );
    END IF;
    ALTER TABLE public.words ADD CONSTRAINT words_lang_rank_unique UNIQUE (lang, rank);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS words_lang_rank ON public.words (lang, rank);

-- RLS
ALTER TABLE public.words ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow read words" ON public.words;
CREATE POLICY "Allow read words" ON public.words FOR SELECT USING (true);

ALTER TABLE public.user_words ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_words_own" ON public.user_words;
CREATE POLICY "user_words_own" ON public.user_words FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.review_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "review_events_own" ON public.review_events;
CREATE POLICY "review_events_own" ON public.review_events FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "review_events_insert_own" ON public.review_events FOR INSERT WITH CHECK (user_id = auth.uid());

ALTER TABLE public.exposure_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "exposure_events_own" ON public.exposure_events;
CREATE POLICY "exposure_events_own" ON public.exposure_events FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "exposure_events_insert_own" ON public.exposure_events FOR INSERT WITH CHECK (user_id = auth.uid());

-- updated_at trigger for user_words
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS user_words_updated_at ON public.user_words;
CREATE TRIGGER user_words_updated_at
  BEFORE UPDATE ON public.user_words
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- SRS algorithm constants (match lib/srs/math.ts and constants.ts)
-- min_hl = 0.25, max_hl = 17520 (24*365*2), base_eta, k, eta_min, eta_max, alpha, relearn_mins, grade factors

CREATE OR REPLACE FUNCTION public.upsert_user_word(p_word_id uuid, p_lang text DEFAULT NULL)
RETURNS SETOF public.user_words
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.user_words (user_id, word_id, status, half_life_hours, target_p, due_at, last_review_at, reps, lapses, ewma_surprise, ewma_abs_surprise, ewma_accuracy)
  VALUES (v_uid, p_word_id, 'learning', 8, 0.85, now(), NULL, 0, 0, 0, 0, 1)
  ON CONFLICT (user_id, word_id) DO NOTHING;
  RETURN QUERY SELECT * FROM public.user_words WHERE user_id = v_uid AND word_id = p_word_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_daily_queue(p_lang text, p_new_limit int, p_review_limit int)
RETURNS TABLE (
  word_id uuid,
  lemma text,
  rank int,
  kind text,
  surface text,
  pos text,
  extra jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  -- Due reviews first
  (SELECT w.id AS word_id, w.lemma, w.rank, 'review'::text AS kind, w.surface, w.pos, w.extra
   FROM public.user_words uw
   JOIN public.words w ON w.id = uw.word_id
   WHERE uw.user_id = v_uid AND uw.due_at <= now() AND w.lang = p_lang
   ORDER BY uw.due_at ASC
   LIMIT p_review_limit)
  UNION ALL
  -- New words by rank
  (SELECT w.id AS word_id, w.lemma, w.rank, 'new'::text AS kind, w.surface, w.pos, w.extra
   FROM public.words w
   WHERE w.lang = p_lang
     AND NOT EXISTS (SELECT 1 FROM public.user_words uw WHERE uw.user_id = v_uid AND uw.word_id = w.id)
   ORDER BY w.rank ASC
   LIMIT p_new_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_review(
  p_word_id uuid,
  p_grade text,
  p_ms_spent int,
  p_user_answer text,
  p_expected text[],
  p_correct boolean
)
RETURNS TABLE (
  user_id uuid,
  word_id uuid,
  status text,
  half_life_hours numeric,
  target_p numeric,
  last_review_at timestamptz,
  due_at timestamptz,
  reps int,
  lapses int,
  ewma_surprise numeric,
  ewma_abs_surprise numeric,
  ewma_accuracy numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.user_words%ROWTYPE;
  v_delta_hours numeric;
  v_p_pred numeric;
  v_r numeric;
  v_grade_factor numeric;
  v_surprise numeric;
  v_eta numeric;
  v_hl_new numeric;
  v_interval_hours numeric;
  v_min_hl numeric := 0.25;
  v_max_hl numeric := 17520;
  v_base_eta numeric := 0.4;
  v_k numeric := 0.2;
  v_eta_min numeric := 0.1;
  v_eta_max numeric := 1.0;
  v_alpha numeric := 0.3;
  v_hl_before numeric;
BEGIN
  IF v_uid IS NULL OR p_grade NOT IN ('again', 'hard', 'good', 'easy') THEN
    RETURN;
  END IF;
  PERFORM * FROM public.upsert_user_word(p_word_id, NULL);
  SELECT * INTO v_row FROM public.user_words WHERE user_words.user_id = v_uid AND user_words.word_id = p_word_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_hl_before := v_row.half_life_hours;
  IF v_row.last_review_at IS NULL THEN
    v_delta_hours := 0.1;
  ELSE
    v_delta_hours := EXTRACT(epoch FROM (now() - v_row.last_review_at)) / 3600.0;
  END IF;
  v_p_pred := power(2, -v_delta_hours / NULLIF(v_row.half_life_hours, 0));
  v_p_pred := GREATEST(LEAST(v_p_pred, 1), 0);

  v_r := CASE WHEN p_correct THEN 1.0 ELSE 0.0 END;
  v_grade_factor := CASE p_grade WHEN 'again' THEN 0.6 WHEN 'hard' THEN 0.85 WHEN 'good' THEN 1.0 WHEN 'easy' THEN 1.15 ELSE 1.0 END;
  v_surprise := v_r - v_p_pred;

  v_row.ewma_surprise := v_row.ewma_surprise * (1 - v_alpha) + v_surprise * v_alpha;
  v_row.ewma_abs_surprise := v_row.ewma_abs_surprise * (1 - v_alpha) + abs(v_surprise) * v_alpha;
  v_row.ewma_accuracy := v_row.ewma_accuracy * (1 - v_alpha) + v_r * v_alpha;

  v_eta := v_base_eta + v_k * v_row.ewma_abs_surprise;
  v_eta := GREATEST(v_eta_min, LEAST(v_eta_max, v_eta));
  v_hl_new := v_row.half_life_hours * exp(v_eta * (v_r - v_p_pred) * v_grade_factor);
  v_hl_new := GREATEST(v_min_hl, LEAST(v_max_hl, v_hl_new));

  v_row.half_life_hours := v_hl_new;
  v_row.last_review_at := now();

  IF p_correct THEN
    v_row.reps := v_row.reps + 1;
    v_interval_hours := v_hl_new * ln(1.0 / v_row.target_p) / ln(2);
    v_row.due_at := now() + (v_interval_hours || ' hours')::interval;
  ELSE
    v_row.lapses := v_row.lapses + 1;
    v_row.due_at := now() + interval '10 minutes';
  END IF;

  UPDATE public.user_words SET
    half_life_hours = v_row.half_life_hours,
    target_p = v_row.target_p,
    last_review_at = v_row.last_review_at,
    due_at = v_row.due_at,
    reps = v_row.reps,
    lapses = v_row.lapses,
    ewma_surprise = v_row.ewma_surprise,
    ewma_abs_surprise = v_row.ewma_abs_surprise,
    ewma_accuracy = v_row.ewma_accuracy
  WHERE user_words.user_id = v_uid AND user_words.word_id = p_word_id;

  INSERT INTO public.review_events (user_id, word_id, grade, correct, ms_spent, user_answer, expected, p_pred, delta_hours, half_life_before, half_life_after)
  VALUES (v_uid, p_word_id, p_grade, p_correct, p_ms_spent, COALESCE(p_user_answer, ''), COALESCE(p_expected, '{}'), v_p_pred, v_delta_hours, v_hl_before, v_hl_new);

  RETURN QUERY SELECT uw.user_id, uw.word_id, uw.status, uw.half_life_hours, uw.target_p, uw.last_review_at, uw.due_at, uw.reps, uw.lapses, uw.ewma_surprise, uw.ewma_abs_surprise, uw.ewma_accuracy
    FROM public.user_words uw WHERE uw.user_id = v_uid AND uw.word_id = p_word_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_exposure(p_word_id uuid, p_kind text, p_weight numeric DEFAULT 0.1)
RETURNS SETOF public.user_words
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.user_words%ROWTYPE;
  v_delta_hours numeric;
  v_p_pred numeric;
  v_r numeric := 1.0;
  v_surprise_weighted numeric;
  v_eta numeric;
  v_hl_new numeric;
  v_min_hl numeric := 0.25;
  v_max_hl numeric := 17520;
  v_base_eta numeric := 0.4;
  v_k numeric := 0.2;
  v_eta_min numeric := 0.1;
  v_eta_max numeric := 1.0;
  v_alpha numeric := 0.3;
  v_weight numeric := GREATEST(0.05, LEAST(0.25, p_weight));
BEGIN
  IF v_uid IS NULL OR p_kind NOT IN ('reader_tap', 'reader_seen', 'listening_seen') THEN
    RETURN;
  END IF;
  PERFORM * FROM public.upsert_user_word(p_word_id, NULL);
  SELECT * INTO v_row FROM public.user_words WHERE user_words.user_id = v_uid AND user_words.word_id = p_word_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_row.last_review_at IS NULL THEN
    v_delta_hours := 0.1;
  ELSE
    v_delta_hours := EXTRACT(epoch FROM (now() - v_row.last_review_at)) / 3600.0;
  END IF;
  v_p_pred := power(2, -v_delta_hours / NULLIF(v_row.half_life_hours, 0));
  v_p_pred := GREATEST(LEAST(v_p_pred, 1), 0);
  v_surprise_weighted := (v_r - v_p_pred) * v_weight;

  v_eta := v_base_eta + v_k * v_row.ewma_abs_surprise;
  v_eta := GREATEST(v_eta_min, LEAST(v_eta_max, v_eta));
  v_hl_new := v_row.half_life_hours * exp(v_eta * v_surprise_weighted);
  v_hl_new := GREATEST(v_min_hl, LEAST(v_max_hl, v_hl_new));

  UPDATE public.user_words SET half_life_hours = v_hl_new
  WHERE user_words.user_id = v_uid AND user_words.word_id = p_word_id;

  INSERT INTO public.exposure_events (user_id, word_id, kind, weight)
  VALUES (v_uid, p_word_id, p_kind, v_weight);

  RETURN QUERY SELECT * FROM public.user_words WHERE user_id = v_uid AND word_id = p_word_id;
END;
$$;

-- Reload PostgREST schema cache so new columns and RPCs are visible to the API
NOTIFY pgrst, 'reload schema';
