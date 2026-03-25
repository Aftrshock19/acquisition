-- Align the checked-in schema with the authoritative Supabase database context.
-- This is a forward-only compatibility migration: it adds the missing shared
-- content and user-progress tables/columns without removing legacy columns that
-- the current app code may still read.

-- Reusable updated_at trigger function
DO $outer$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_updated_at'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.set_updated_at()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = public
      AS $body$
      BEGIN
        NEW.updated_at := now();
        RETURN NEW;
      END;
      $body$
    $fn$;
  END IF;
END
$outer$;

-- Shared content tables
ALTER TABLE public.words
  ADD COLUMN IF NOT EXISTS definition text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.words
SET definition = COALESCE(definition, extra ->> 'definition')
WHERE definition IS NULL
  AND extra ? 'definition';

CREATE UNIQUE INDEX IF NOT EXISTS words_lang_lemma_unique ON public.words (lang, lemma);

DROP TRIGGER IF EXISTS words_updated_at ON public.words;
CREATE TRIGGER words_updated_at
BEFORE UPDATE ON public.words
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.word_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lang text NOT NULL,
  form text NOT NULL,
  lemma text NOT NULL,
  pos text,
  extra jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS word_forms_lang_form_lemma_unique
  ON public.word_forms (lang, form, lemma);
CREATE INDEX IF NOT EXISTS word_forms_lang_form_idx
  ON public.word_forms (lang, form);

CREATE TABLE IF NOT EXISTS public.texts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lang text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS texts_updated_at ON public.texts;
CREATE TRIGGER texts_updated_at
BEFORE UPDATE ON public.texts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.audio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text_id uuid NOT NULL REFERENCES public.texts(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  transcript text,
  duration_seconds int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audio_text_id_idx
  ON public.audio (text_id);

DROP TRIGGER IF EXISTS audio_updated_at ON public.audio;
CREATE TRIGGER audio_updated_at
BEFORE UPDATE ON public.audio
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- User progress/state tables
ALTER TABLE public.user_words
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accuracy numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS difficulty numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_graded_at timestamptz,
  ADD COLUMN IF NOT EXISTS reps_today int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reps_today_date date,
  ADD COLUMN IF NOT EXISTS mastery numeric;

ALTER TABLE public.user_words
  DROP CONSTRAINT IF EXISTS user_words_accuracy_range;
ALTER TABLE public.user_words
  DROP CONSTRAINT IF EXISTS user_words_difficulty_range;
ALTER TABLE public.user_words
  ADD CONSTRAINT user_words_accuracy_range CHECK (accuracy >= 0 AND accuracy <= 1),
  ADD CONSTRAINT user_words_difficulty_range CHECK (difficulty >= 0 AND difficulty <= 1);

UPDATE public.user_words
SET attempts = CASE
      WHEN attempts = 0 AND COALESCE(reps + lapses, 0) > 0
        THEN reps + lapses
      ELSE attempts
    END,
    correct_attempts = CASE
      WHEN correct_attempts = 0 AND COALESCE(reps, 0) > 0
        THEN reps
      ELSE correct_attempts
    END,
    accuracy = CASE
      WHEN COALESCE(reps + lapses, 0) > 0
        THEN reps::numeric / NULLIF(reps + lapses, 0)
      ELSE COALESCE(accuracy, 0)
    END,
    difficulty = CASE
      WHEN difficulty = 0.5 AND ewma_accuracy IS NOT NULL
        THEN LEAST(1, GREATEST(0, 1 - ewma_accuracy))
      ELSE difficulty
    END,
    last_graded_at = COALESCE(last_graded_at, last_review_at),
    reps_today_date = COALESCE(reps_today_date, CURRENT_DATE)
WHERE TRUE;

CREATE INDEX IF NOT EXISTS user_words_user_id_idx
  ON public.user_words (user_id);
CREATE INDEX IF NOT EXISTS user_words_word_id_idx
  ON public.user_words (word_id);

ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS card_type text,
  ADD COLUMN IF NOT EXISTS base_difficulty_before numeric,
  ADD COLUMN IF NOT EXISTS base_difficulty_after numeric,
  ADD COLUMN IF NOT EXISTS effective_difficulty numeric,
  ADD COLUMN IF NOT EXISTS reps_today int;

UPDATE public.review_events
SET created_at = COALESCE(created_at, happened_at, now()),
    card_type = COALESCE(card_type, 'cloze');

ALTER TABLE public.review_events
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN card_type SET DEFAULT 'cloze',
  ALTER COLUMN card_type SET NOT NULL;

ALTER TABLE public.review_events
  DROP CONSTRAINT IF EXISTS review_events_card_type_check;
ALTER TABLE public.review_events
  ADD CONSTRAINT review_events_card_type_check
    CHECK (card_type IN ('cloze', 'normal', 'audio', 'mcq', 'sentences'));

CREATE INDEX IF NOT EXISTS review_events_user_created_at_idx
  ON public.review_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.daily_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  stage text NOT NULL DEFAULT 'flashcards',
  new_words_count int NOT NULL DEFAULT 0,
  reviews_done int NOT NULL DEFAULT 0,
  reading_done boolean NOT NULL DEFAULT false,
  listening_done boolean NOT NULL DEFAULT false,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_sessions_stage_check
    CHECK (stage IN ('flashcards', 'reading', 'listening', 'complete')),
  CONSTRAINT daily_sessions_user_date_unique
    UNIQUE (user_id, session_date)
);

CREATE INDEX IF NOT EXISTS daily_sessions_user_session_date_idx
  ON public.daily_sessions (user_id, session_date DESC);

ALTER TABLE public.daily_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_sessions_own" ON public.daily_sessions;
DROP POLICY IF EXISTS "daily_sessions_insert_own" ON public.daily_sessions;
DROP POLICY IF EXISTS "daily_sessions_update_own" ON public.daily_sessions;

CREATE POLICY "daily_sessions_own"
ON public.daily_sessions
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "daily_sessions_insert_own"
ON public.daily_sessions
FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "daily_sessions_update_own"
ON public.daily_sessions
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS daily_sessions_updated_at ON public.daily_sessions;
CREATE TRIGGER daily_sessions_updated_at
BEFORE UPDATE ON public.daily_sessions
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Shared content should be readable by the app.
ALTER TABLE public.word_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read word_forms" ON public.word_forms;
DROP POLICY IF EXISTS "Allow read texts" ON public.texts;
DROP POLICY IF EXISTS "Allow read audio" ON public.audio;

CREATE POLICY "Allow read word_forms"
ON public.word_forms
FOR SELECT
USING (true);

CREATE POLICY "Allow read texts"
ON public.texts
FOR SELECT
USING (true);

CREATE POLICY "Allow read audio"
ON public.audio
FOR SELECT
USING (true);

-- Keep the current app RPC shape, but source definition from the canonical column.
CREATE OR REPLACE FUNCTION public.get_daily_queue(p_lang text, p_new_limit int, p_review_limit int)
RETURNS TABLE (
  word_id uuid,
  lemma text,
  rank int,
  kind text,
  surface text,
  pos text,
  extra jsonb,
  definition text
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
  (SELECT
      w.id AS word_id,
      w.lemma,
      w.rank,
      'review'::text AS kind,
      w.surface,
      w.pos,
      w.extra,
      COALESCE(w.definition, (w.extra ->> 'definition')::text) AS definition
   FROM public.user_words uw
   JOIN public.words w ON w.id = uw.word_id
   WHERE uw.user_id = v_uid
     AND uw.due_at <= now()
     AND w.lang = p_lang
   ORDER BY uw.due_at ASC
   LIMIT p_review_limit)
  UNION ALL
  (SELECT
      w.id AS word_id,
      w.lemma,
      w.rank,
      'new'::text AS kind,
      w.surface,
      w.pos,
      w.extra,
      COALESCE(w.definition, (w.extra ->> 'definition')::text) AS definition
   FROM public.words w
   WHERE w.lang = p_lang
     AND NOT EXISTS (
       SELECT 1
       FROM public.user_words uw
       WHERE uw.user_id = v_uid
         AND uw.word_id = w.id
     )
   ORDER BY w.rank ASC
   LIMIT p_new_limit);
END;
$$;

NOTIFY pgrst, 'reload schema';
