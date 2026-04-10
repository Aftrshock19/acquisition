-- SRS v2: Research-shaped spaced-repetition scheduler
-- Adds per-word hidden state (difficulty, stability_days, learned_level, etc.)
-- Replaces half-life scheduling with deterministic stability-based model.
--
-- Rollback notes:
--   - New columns on user_words are all ADD COLUMN IF NOT EXISTS with defaults,
--     so rolling back = dropping them. The old half_life_hours / due_at columns
--     are preserved and remain functional.
--   - The record_review function is replaced; to rollback, re-run the previous
--     migration's CREATE OR REPLACE for record_review.
--   - review_events gains first_try and retry_index columns; safe to drop.
-- ---------------------------------------------------------------------------

-- 1a. Ensure legacy columns exist (from earlier migrations that may not have run)
-- ---------------------------------------------------------------------------
-- From 20260226120000_srs.sql: core half-life SRS columns on user_words
ALTER TABLE public.user_words
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'learning',
  ADD COLUMN IF NOT EXISTS half_life_hours numeric NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS target_p numeric NOT NULL DEFAULT 0.85,
  ADD COLUMN IF NOT EXISTS last_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS due_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reps int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lapses int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ewma_surprise numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ewma_abs_surprise numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ewma_accuracy numeric NOT NULL DEFAULT 1;

-- From 20260325120000_align_database_context.sql: attempts/accuracy/difficulty columns
ALTER TABLE public.user_words
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accuracy numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS difficulty numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_graded_at timestamptz,
  ADD COLUMN IF NOT EXISTS reps_today int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reps_today_date date;

-- From 20260325120000: daily_sessions table
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

ALTER TABLE public.daily_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_sessions_own" ON public.daily_sessions;
DROP POLICY IF EXISTS "daily_sessions_insert_own" ON public.daily_sessions;
DROP POLICY IF EXISTS "daily_sessions_update_own" ON public.daily_sessions;

CREATE POLICY "daily_sessions_own"
  ON public.daily_sessions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "daily_sessions_insert_own"
  ON public.daily_sessions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "daily_sessions_update_own"
  ON public.daily_sessions FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- From 20260410140000: extra columns on daily_sessions
ALTER TABLE public.daily_sessions
  ADD COLUMN IF NOT EXISTS assigned_flashcard_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assigned_new_words_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assigned_review_cards_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flashcard_completed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flashcard_new_completed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flashcard_review_completed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flashcard_attempts_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flashcard_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS flashcards_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- From 20260325120000: core review_events columns
ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS card_type text NOT NULL DEFAULT 'cloze';

ALTER TABLE public.review_events
  DROP CONSTRAINT IF EXISTS review_events_card_type_check;
ALTER TABLE public.review_events
  ADD CONSTRAINT review_events_card_type_check
    CHECK (card_type IN ('cloze', 'normal', 'audio', 'mcq', 'sentences'));

-- From 20260410140000: session tracking columns on review_events
ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS daily_session_id uuid REFERENCES public.daily_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_date date,
  ADD COLUMN IF NOT EXISTS client_attempt_id text;

CREATE UNIQUE INDEX IF NOT EXISTS review_events_user_client_attempt_unique
  ON public.review_events (user_id, client_attempt_id)
  WHERE client_attempt_id IS NOT NULL;

-- 1b. Add new SRS v2 state columns to user_words
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_words
  ADD COLUMN IF NOT EXISTS srs_state text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS stability_days numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS learned_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS successful_first_try_reviews integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_first_try_correct integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_result text,
  ADD COLUMN IF NOT EXISTS last_was_first_try boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_due timestamptz NOT NULL DEFAULT now();

-- Constraints (idempotent: drop first)
ALTER TABLE public.user_words
  DROP CONSTRAINT IF EXISTS user_words_srs_state_check,
  DROP CONSTRAINT IF EXISTS user_words_learned_level_nonneg,
  DROP CONSTRAINT IF EXISTS user_words_stability_days_nonneg,
  DROP CONSTRAINT IF EXISTS user_words_last_result_check;

ALTER TABLE public.user_words
  ADD CONSTRAINT user_words_srs_state_check
    CHECK (srs_state IN ('new', 'learning', 'review')),
  ADD CONSTRAINT user_words_learned_level_nonneg
    CHECK (learned_level >= 0),
  ADD CONSTRAINT user_words_stability_days_nonneg
    CHECK (stability_days >= 0),
  ADD CONSTRAINT user_words_last_result_check
    CHECK (last_result IS NULL OR last_result IN ('correct', 'incorrect'));

-- Index for next_due queue lookups
CREATE INDEX IF NOT EXISTS user_words_user_next_due
  ON public.user_words (user_id, next_due);

-- 2. Backfill sensible defaults from existing state
-- ---------------------------------------------------------------------------
-- Wrapped in a DO block so it is skipped safely if the legacy columns
-- (reps, lapses, ewma_accuracy, etc.) don't exist yet on this database.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_words'
      AND column_name  = 'reps'
  ) THEN
    UPDATE public.user_words
    SET
      srs_state = CASE
        WHEN reps >= 2 THEN 'review'
        WHEN reps >= 1 OR lapses >= 1 THEN 'learning'
        ELSE 'new'
      END,
      stability_days = GREATEST(0, COALESCE(half_life_hours, 8) * ln(1.0 / GREATEST(COALESCE(target_p, 0.85), 0.5)) / ln(2) / 24.0),
      learned_level = CASE
        WHEN reps >= 5 AND COALESCE(ewma_accuracy, 0.5) >= 0.8 THEN 4
        WHEN reps >= 3 THEN 3
        WHEN reps >= 2 THEN 2
        WHEN reps >= 1 THEN 1
        ELSE 0
      END,
      next_due = COALESCE(due_at, now()),
      successful_first_try_reviews = GREATEST(0, COALESCE(correct_attempts, 0)),
      consecutive_first_try_correct = CASE
        WHEN COALESCE(ewma_accuracy, 0.5) >= 0.9 THEN LEAST(3, COALESCE(reps, 0))
        WHEN COALESCE(ewma_accuracy, 0.5) >= 0.7 THEN 1
        ELSE 0
      END,
      last_result = CASE
        WHEN last_review_at IS NOT NULL AND COALESCE(ewma_accuracy, 0.5) >= 0.5 THEN 'correct'
        WHEN last_review_at IS NOT NULL THEN 'incorrect'
        ELSE NULL
      END,
      last_was_first_try = COALESCE(ewma_accuracy, 0.5) >= 0.7
    WHERE TRUE;
  END IF;
END
$$;

-- 3. Add first_try and retry_index to review_events
-- ---------------------------------------------------------------------------
-- Ensure columns from 20260410140000 exist first (may not have run)
ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS queue_source text NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS queue_kind text,
  ADD COLUMN IF NOT EXISTS session_date date,
  ADD COLUMN IF NOT EXISTS shown_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS client_attempt_id text;

ALTER TABLE public.review_events
  DROP CONSTRAINT IF EXISTS review_events_queue_source_check,
  DROP CONSTRAINT IF EXISTS review_events_queue_kind_check;

ALTER TABLE public.review_events
  ADD CONSTRAINT review_events_queue_source_check
    CHECK (queue_source IN ('main', 'retry')),
  ADD CONSTRAINT review_events_queue_kind_check
    CHECK (queue_kind IS NULL OR queue_kind IN ('new', 'review'));

-- New columns for SRS v2
ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS first_try boolean,
  ADD COLUMN IF NOT EXISTS retry_index integer NOT NULL DEFAULT 0;

-- Backfill: main-queue reviews are first_try, retries are not
UPDATE public.review_events
SET first_try = CASE
    WHEN queue_source = 'retry' THEN false
    ELSE correct
  END,
  retry_index = CASE
    WHEN queue_source = 'retry' THEN 1
    ELSE 0
  END
WHERE first_try IS NULL;

-- 4. Update get_daily_queue to use next_due instead of due_at
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_daily_queue(text, integer, integer);
CREATE OR REPLACE FUNCTION public.get_daily_queue(p_lang text, p_new_limit int, p_review_limit int)
RETURNS TABLE (
  word_id uuid,
  lemma text,
  rank int,
  kind text,
  pos text,
  translation text,
  definition_es text,
  definition_en text,
  example_sentence text,
  example_sentence_en text,
  definition text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lang text := COALESCE(NULLIF(trim(p_lang), ''), 'es');
BEGIN
  IF v_uid IS NULL OR v_lang <> 'es' THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- Due reviews: use next_due instead of due_at
  (SELECT
      w.id AS word_id,
      w.lemma,
      w.rank,
      'review'::text AS kind,
      w.pos,
      w.translation,
      d.definition_es,
      d.definition_en,
      w.example_sentence,
      w.example_sentence_en,
      COALESCE(w.translation, d.translation, d.definition_en, d.definition_es) AS definition
   FROM public.user_words uw
   JOIN public.words w ON w.id = uw.word_id
   LEFT JOIN public.definitions d ON d.id = w.id
   WHERE uw.user_id = v_uid
     AND uw.next_due <= now()
   ORDER BY uw.next_due ASC
   LIMIT p_review_limit)
  UNION ALL
  -- New words by rank
  (SELECT
      w.id AS word_id,
      w.lemma,
      w.rank,
      'new'::text AS kind,
      w.pos,
      w.translation,
      d.definition_es,
      d.definition_en,
      w.example_sentence,
      w.example_sentence_en,
      COALESCE(w.translation, d.translation, d.definition_en, d.definition_es) AS definition
   FROM public.words w
   LEFT JOIN public.definitions d ON d.id = w.id
   WHERE NOT EXISTS (
       SELECT 1 FROM public.user_words uw
       WHERE uw.user_id = v_uid AND uw.word_id = w.id
     )
   ORDER BY w.rank ASC
   LIMIT p_new_limit);
END;
$$;

-- 5. Replace record_review with SRS v2 logic
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_review(uuid, text, int, text, text[], text, date, text, text, timestamptz, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.record_review(uuid, text, int, text, text[], boolean);
DROP FUNCTION IF EXISTS public.record_review(uuid, text, int, text, text[]);
DROP FUNCTION IF EXISTS public.record_review(uuid, text, int, text, text[], text);

CREATE OR REPLACE FUNCTION public.record_review(
  p_word_id uuid,
  p_grade text,
  p_ms_spent int,
  p_user_answer text,
  p_expected text[],
  p_card_type text DEFAULT 'cloze',
  p_session_date date DEFAULT NULL,
  p_queue_kind text DEFAULT NULL,
  p_queue_source text DEFAULT 'main',
  p_shown_at timestamptz DEFAULT NULL,
  p_submitted_at timestamptz DEFAULT NULL,
  p_retry_scheduled_for timestamptz DEFAULT NULL,
  p_client_attempt_id text DEFAULT NULL,
  p_first_try boolean DEFAULT true,
  p_retry_index integer DEFAULT 0
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
  v_now timestamptz := COALESCE(p_submitted_at, now());
  v_session_date date := COALESCE(p_session_date, v_now::date);
  v_row public.user_words%ROWTYPE;
  v_session public.daily_sessions%ROWTYPE;
  v_correct boolean;
  v_card_type text := COALESCE(p_card_type, 'cloze');
  v_queue_kind text := CASE
    WHEN p_queue_kind IN ('new', 'review') THEN p_queue_kind
    ELSE NULL
  END;
  v_queue_source text := CASE
    WHEN p_queue_source = 'retry' THEN 'retry'
    ELSE 'main'
  END;

  -- SRS v2 state variables
  v_is_first_ever boolean;
  v_is_second_clean boolean;
  v_growth numeric;
  v_new_stability numeric;
  v_new_difficulty numeric;
  v_new_learned_level integer;
  v_new_srs_state text;
  v_new_next_due timestamptz;
  v_new_consec integer;

  -- Legacy half-life variables (still computed for review_events logging)
  v_delta_hours numeric;
  v_p_pred numeric;
  v_r numeric;
  v_grade_factor numeric;
  v_surprise numeric;
  v_eta numeric;
  v_hl_new numeric;
  v_hl_before numeric;
  v_min_hl numeric := 0.25;
  v_max_hl numeric := 17520;
  v_base_eta numeric := 0.4;
  v_k numeric := 0.2;
  v_eta_min numeric := 0.1;
  v_eta_max numeric := 1.0;
  v_alpha numeric := 0.3;
  v_interval_hours numeric;

  v_attempts integer;
  v_correct_attempts integer;
  v_reps_today integer;
  v_accuracy numeric;
  v_session_stage text;
BEGIN
  IF v_uid IS NULL OR p_grade NOT IN ('again', 'hard', 'good', 'easy') THEN
    RETURN;
  END IF;

  -- Deduplicate by client_attempt_id
  IF p_client_attempt_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.review_events
      WHERE review_events.user_id = v_uid AND client_attempt_id = p_client_attempt_id
    ) THEN
      RETURN QUERY
      SELECT uw.user_id, uw.word_id, uw.status, uw.half_life_hours, uw.target_p,
             uw.last_review_at, uw.due_at, uw.reps, uw.lapses,
             uw.ewma_surprise, uw.ewma_abs_surprise, uw.ewma_accuracy
      FROM public.user_words uw WHERE uw.user_id = v_uid AND uw.word_id = p_word_id;
      RETURN;
    END IF;
  END IF;

  IF v_card_type NOT IN ('cloze', 'normal', 'audio', 'mcq', 'sentences') THEN
    v_card_type := 'cloze';
  END IF;

  v_correct := (p_grade <> 'again');

  BEGIN
    PERFORM * FROM public.upsert_user_word(p_word_id, NULL);

    SELECT * INTO v_row
    FROM public.user_words
    WHERE user_words.user_id = v_uid AND user_words.word_id = p_word_id
    FOR UPDATE;

    IF NOT FOUND THEN RETURN; END IF;

    -- -----------------------------------------------------------------------
    -- Legacy half-life update (kept for review_events backward compat)
    -- -----------------------------------------------------------------------
    v_hl_before := v_row.half_life_hours;
    IF v_row.last_review_at IS NULL THEN
      v_delta_hours := 0.1;
    ELSE
      v_delta_hours := EXTRACT(epoch FROM (v_now - v_row.last_review_at)) / 3600.0;
    END IF;
    v_p_pred := power(2, -v_delta_hours / NULLIF(v_row.half_life_hours, 0));
    v_p_pred := GREATEST(LEAST(v_p_pred, 1), 0);

    v_r := CASE WHEN v_correct THEN 1.0 ELSE 0.0 END;
    v_grade_factor := CASE p_grade
      WHEN 'again' THEN 0.6 WHEN 'hard' THEN 0.85 WHEN 'good' THEN 1.0 WHEN 'easy' THEN 1.15 ELSE 1.0
    END;
    v_surprise := v_r - v_p_pred;

    v_row.ewma_surprise := v_row.ewma_surprise * (1 - v_alpha) + v_surprise * v_alpha;
    v_row.ewma_abs_surprise := v_row.ewma_abs_surprise * (1 - v_alpha) + abs(v_surprise) * v_alpha;
    v_row.ewma_accuracy := v_row.ewma_accuracy * (1 - v_alpha) + v_r * v_alpha;

    v_eta := v_base_eta + v_k * v_row.ewma_abs_surprise;
    v_eta := GREATEST(v_eta_min, LEAST(v_eta_max, v_eta));
    v_hl_new := v_row.half_life_hours * exp(v_eta * (v_r - v_p_pred) * v_grade_factor);
    v_hl_new := GREATEST(v_min_hl, LEAST(v_max_hl, v_hl_new));

    v_row.half_life_hours := v_hl_new;
    v_row.last_review_at := v_now;

    IF v_correct THEN
      v_row.reps := v_row.reps + 1;
      v_interval_hours := v_hl_new * ln(1.0 / v_row.target_p) / ln(2);
      v_row.due_at := v_now + (v_interval_hours || ' hours')::interval;
    ELSE
      v_row.lapses := v_row.lapses + 1;
      v_row.due_at := v_now + interval '10 minutes';
    END IF;

    -- -----------------------------------------------------------------------
    -- SRS v2: deterministic scheduler update
    -- -----------------------------------------------------------------------
    v_is_first_ever := (v_row.srs_state = 'new')
                    OR (COALESCE(v_row.reps, 0) <= 1 AND COALESCE(v_row.lapses, 0) = 0
                        AND NOT v_correct);
    -- Correct path only: re-check first_ever for correct
    IF v_correct THEN
      v_is_first_ever := (v_row.srs_state = 'new')
                       OR (COALESCE(v_row.reps, 0) = 1 AND COALESCE(v_row.lapses, 0) = 0);
    END IF;

    v_is_second_clean := NOT v_is_first_ever
                       AND v_correct
                       AND p_first_try
                       AND COALESCE(v_row.consecutive_first_try_correct, 0) = 1
                       AND COALESCE(v_row.last_was_first_try, false);

    v_new_difficulty := COALESCE(v_row.difficulty, 0.55);
    v_new_stability := COALESCE(v_row.stability_days, 0);
    v_new_learned_level := COALESCE(v_row.learned_level, 0);
    v_new_consec := COALESCE(v_row.consecutive_first_try_correct, 0);

    IF v_correct AND p_first_try THEN
      -- Clean success
      IF v_is_first_ever THEN
        v_new_difficulty := GREATEST(0.30, v_new_difficulty - 0.08);
        v_new_learned_level := v_new_learned_level + 2;
        v_new_stability := GREATEST(v_new_stability, 2);
        v_new_srs_state := 'review';
        v_new_consec := v_new_consec + 1;
        v_new_next_due := v_now + interval '2 days';
      ELSIF v_is_second_clean THEN
        v_new_difficulty := GREATEST(0.20, v_new_difficulty - 0.05);
        v_new_learned_level := v_new_learned_level + 2;
        v_new_stability := GREATEST(6, v_new_stability * 3);
        v_new_stability := LEAST(730, v_new_stability);
        v_new_srs_state := 'review';
        v_new_consec := v_new_consec + 1;
        v_new_next_due := v_now + (v_new_stability || ' days')::interval;
      ELSE
        v_growth := 1.8 + (1 - v_new_difficulty) * 0.8;
        IF v_new_consec >= 2 THEN
          v_growth := v_growth + 0.15;
        END IF;
        v_new_stability := GREATEST(v_new_stability + 1, v_new_stability * v_growth);
        v_new_stability := LEAST(730, v_new_stability);
        v_new_difficulty := GREATEST(0.15, v_new_difficulty - 0.02);
        v_new_learned_level := v_new_learned_level + 1;
        v_new_srs_state := 'review';
        v_new_consec := v_new_consec + 1;
        v_new_next_due := v_now + (v_new_stability || ' days')::interval;
      END IF;

      v_row.successful_first_try_reviews := COALESCE(v_row.successful_first_try_reviews, 0) + 1;
      v_row.last_was_first_try := true;

    ELSIF v_correct AND NOT p_first_try THEN
      -- Rescued success
      v_new_difficulty := GREATEST(0.20, v_new_difficulty - 0.01);
      IF v_new_learned_level > 0 THEN
        v_new_learned_level := v_new_learned_level + 1;
      END IF;
      v_new_stability := GREATEST(1, v_new_stability * 1.2);
      v_new_stability := LEAST(730, v_new_stability);
      v_new_consec := 0;
      v_new_srs_state := CASE WHEN v_new_stability < 2 THEN 'learning' ELSE 'review' END;
      v_row.last_was_first_try := false;
      v_new_next_due := v_now + interval '1 day';

    ELSE
      -- Incorrect
      v_new_difficulty := LEAST(0.95, v_new_difficulty + 0.08);
      v_new_learned_level := GREATEST(0, v_new_learned_level - 1);
      v_new_stability := GREATEST(0.5, v_new_stability * 0.35);
      v_new_consec := 0;
      v_new_srs_state := 'learning';
      v_row.last_was_first_try := false;
      -- Due tomorrow unless recovered in-session
      v_new_next_due := v_now + interval '1 day';
    END IF;

    v_row.consecutive_first_try_correct := v_new_consec;
    v_row.last_result := CASE WHEN v_correct THEN 'correct' ELSE 'incorrect' END;

    -- Sync due_at with next_due for backward compat
    v_row.due_at := v_new_next_due;

    v_attempts := COALESCE(v_row.attempts, 0) + 1;
    v_correct_attempts := COALESCE(v_row.correct_attempts, 0) + CASE WHEN v_correct THEN 1 ELSE 0 END;
    v_reps_today := CASE
      WHEN v_row.reps_today_date = v_session_date THEN COALESCE(v_row.reps_today, 0) + 1
      ELSE 1
    END;
    v_accuracy := v_correct_attempts::numeric / GREATEST(v_attempts, 1);

    UPDATE public.user_words
    SET half_life_hours = v_row.half_life_hours,
        target_p = v_row.target_p,
        last_review_at = v_row.last_review_at,
        due_at = v_row.due_at,
        reps = v_row.reps,
        lapses = v_row.lapses,
        ewma_surprise = v_row.ewma_surprise,
        ewma_abs_surprise = v_row.ewma_abs_surprise,
        ewma_accuracy = v_row.ewma_accuracy,
        attempts = v_attempts,
        correct_attempts = v_correct_attempts,
        accuracy = v_accuracy,
        difficulty = v_new_difficulty,
        last_seen_at = v_now,
        last_graded_at = v_now,
        reps_today = v_reps_today,
        reps_today_date = v_session_date,
        -- SRS v2 fields
        srs_state = v_new_srs_state,
        stability_days = v_new_stability,
        learned_level = v_new_learned_level,
        successful_first_try_reviews = COALESCE(v_row.successful_first_try_reviews, 0),
        consecutive_first_try_correct = v_new_consec,
        last_result = v_row.last_result,
        last_was_first_try = v_row.last_was_first_try,
        next_due = v_new_next_due
    WHERE user_words.user_id = v_uid AND user_words.word_id = p_word_id;

    -- -----------------------------------------------------------------------
    -- Daily session counters
    -- -----------------------------------------------------------------------
    SELECT * INTO v_session
    FROM public.daily_sessions
    WHERE daily_sessions.user_id = v_uid AND session_date = v_session_date
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.daily_sessions (
        user_id, session_date, stage,
        assigned_flashcard_count, assigned_new_words_count, assigned_review_cards_count,
        flashcard_completed_count, flashcard_new_completed_count, flashcard_review_completed_count,
        flashcard_attempts_count, flashcard_retry_count,
        new_words_count, reviews_done, started_at, last_active_at
      ) VALUES (
        v_uid, v_session_date, 'flashcards',
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, v_now, v_now
      ) RETURNING * INTO v_session;
    END IF;

    v_session.flashcard_attempts_count := COALESCE(v_session.flashcard_attempts_count, 0) + 1;
    v_session.last_active_at := v_now;
    v_session.started_at := COALESCE(v_session.started_at, v_now);

    IF v_queue_source = 'retry' THEN
      v_session.flashcard_retry_count := COALESCE(v_session.flashcard_retry_count, 0) + 1;
    ELSE
      v_session.flashcard_completed_count := COALESCE(v_session.flashcard_completed_count, 0) + 1;
      IF v_queue_kind = 'new' THEN
        v_session.flashcard_new_completed_count := COALESCE(v_session.flashcard_new_completed_count, 0) + 1;
      ELSIF v_queue_kind = 'review' THEN
        v_session.flashcard_review_completed_count := COALESCE(v_session.flashcard_review_completed_count, 0) + 1;
      END IF;
      IF v_session.flashcards_completed_at IS NULL
        AND COALESCE(v_session.flashcard_completed_count, 0) >= COALESCE(v_session.assigned_flashcard_count, 0)
      THEN
        v_session.flashcards_completed_at := v_now;
      END IF;
    END IF;

    v_session.new_words_count := GREATEST(COALESCE(v_session.new_words_count, 0), COALESCE(v_session.assigned_flashcard_count, 0));
    v_session.reviews_done := COALESCE(v_session.flashcard_completed_count, 0);

    v_session_stage := CASE
      WHEN COALESCE(v_session.flashcard_completed_count, 0) < COALESCE(v_session.assigned_flashcard_count, 0) THEN 'flashcards'
      WHEN NOT COALESCE(v_session.reading_done, false) THEN 'reading'
      WHEN NOT COALESCE(v_session.listening_done, false) THEN 'listening'
      ELSE 'complete'
    END;

    v_session.stage := v_session_stage;
    v_session.completed := (v_session_stage = 'complete');
    IF v_session.completed AND v_session.completed_at IS NULL THEN
      v_session.completed_at := v_now;
    END IF;

    UPDATE public.daily_sessions
    SET stage = v_session.stage,
        assigned_flashcard_count = COALESCE(v_session.assigned_flashcard_count, 0),
        assigned_new_words_count = COALESCE(v_session.assigned_new_words_count, 0),
        assigned_review_cards_count = COALESCE(v_session.assigned_review_cards_count, 0),
        flashcard_completed_count = COALESCE(v_session.flashcard_completed_count, 0),
        flashcard_new_completed_count = COALESCE(v_session.flashcard_new_completed_count, 0),
        flashcard_review_completed_count = COALESCE(v_session.flashcard_review_completed_count, 0),
        flashcard_attempts_count = COALESCE(v_session.flashcard_attempts_count, 0),
        flashcard_retry_count = COALESCE(v_session.flashcard_retry_count, 0),
        new_words_count = COALESCE(v_session.new_words_count, 0),
        reviews_done = COALESCE(v_session.reviews_done, 0),
        started_at = v_session.started_at,
        last_active_at = v_session.last_active_at,
        flashcards_completed_at = v_session.flashcards_completed_at,
        completed = v_session.completed,
        completed_at = v_session.completed_at
    WHERE id = v_session.id;

    -- -----------------------------------------------------------------------
    -- Insert review event with first_try and retry_index
    -- -----------------------------------------------------------------------
    INSERT INTO public.review_events (
      user_id, word_id, daily_session_id, session_date,
      queue_kind, queue_source, card_type,
      shown_at, submitted_at, retry_scheduled_for, client_attempt_id,
      grade, correct, ms_spent, user_answer, expected,
      p_pred, delta_hours, half_life_before, half_life_after,
      first_try, retry_index
    ) VALUES (
      v_uid, p_word_id, v_session.id, v_session_date,
      v_queue_kind, v_queue_source, v_card_type,
      p_shown_at, v_now, p_retry_scheduled_for, p_client_attempt_id,
      p_grade, v_correct, GREATEST(0, p_ms_spent),
      COALESCE(p_user_answer, ''), COALESCE(p_expected, '{}'),
      v_p_pred, v_delta_hours, v_hl_before, v_hl_new,
      COALESCE(p_first_try, true), COALESCE(p_retry_index, 0)
    );

  EXCEPTION
    WHEN unique_violation THEN
      IF p_client_attempt_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.review_events
        WHERE review_events.user_id = v_uid AND client_attempt_id = p_client_attempt_id
      ) THEN
        RETURN QUERY
        SELECT uw.user_id, uw.word_id, uw.status, uw.half_life_hours, uw.target_p,
               uw.last_review_at, uw.due_at, uw.reps, uw.lapses,
               uw.ewma_surprise, uw.ewma_abs_surprise, uw.ewma_accuracy
        FROM public.user_words uw WHERE uw.user_id = v_uid AND uw.word_id = p_word_id;
        RETURN;
      END IF;
      RAISE;
  END;

  RETURN QUERY
  SELECT uw.user_id, uw.word_id, uw.status, uw.half_life_hours, uw.target_p,
         uw.last_review_at, uw.due_at, uw.reps, uw.lapses,
         uw.ewma_surprise, uw.ewma_abs_surprise, uw.ewma_accuracy
  FROM public.user_words uw WHERE uw.user_id = v_uid AND uw.word_id = p_word_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
