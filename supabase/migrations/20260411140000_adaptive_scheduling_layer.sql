-- Non-stationary adaptive scheduling layer.
--
-- Adds:
--   1. scheduler_variant + adaptive instrumentation columns on daily_sessions
--   2. adaptive instrumentation columns on review_events
--   3. cold-start prior + adaptive metadata on user_words
--   4. scheduler_variant on user_settings (feature flag)
--   5. reading_question_attempts table (persisted comprehension answers)
--   6. updated record_review RPC accepting p_scheduler_variant,
--      p_learner_factor, p_item_factor and applying them to next_due
--      while preserving baseline mode unchanged.
--
-- The adaptive layer is conservative by design:
--   * combined multiplier clamp = [0.80, 1.20]
--   * applied only to clean correct paths (first_try=true) where the baseline
--     produced a forward-going stability_days > 0
--   * baseline mode is byte-for-byte equivalent to the prior implementation
-- ---------------------------------------------------------------------------

-- 1. daily_sessions: scheduler_variant + adaptive snapshot
ALTER TABLE public.daily_sessions
  ADD COLUMN IF NOT EXISTS scheduler_variant text NOT NULL DEFAULT 'baseline',
  ADD COLUMN IF NOT EXISTS learner_state_score numeric,
  ADD COLUMN IF NOT EXISTS learner_factor numeric,
  ADD COLUMN IF NOT EXISTS workload_factor numeric,
  ADD COLUMN IF NOT EXISTS adaptive_new_word_cap integer,
  ADD COLUMN IF NOT EXISTS starting_due_backlog integer,
  ADD COLUMN IF NOT EXISTS reading_question_accuracy numeric,
  ADD COLUMN IF NOT EXISTS reading_question_attempts_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.daily_sessions
  DROP CONSTRAINT IF EXISTS daily_sessions_scheduler_variant_check;
ALTER TABLE public.daily_sessions
  ADD CONSTRAINT daily_sessions_scheduler_variant_check
    CHECK (scheduler_variant IN ('baseline', 'adaptive'));

-- 2. review_events: per-event adaptive instrumentation
ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS scheduler_variant text NOT NULL DEFAULT 'baseline',
  ADD COLUMN IF NOT EXISTS learner_factor numeric,
  ADD COLUMN IF NOT EXISTS item_factor numeric,
  ADD COLUMN IF NOT EXISTS baseline_interval_days numeric,
  ADD COLUMN IF NOT EXISTS effective_interval_days numeric,
  ADD COLUMN IF NOT EXISTS difficulty_before numeric,
  ADD COLUMN IF NOT EXISTS difficulty_after numeric;

ALTER TABLE public.review_events
  DROP CONSTRAINT IF EXISTS review_events_scheduler_variant_check;
ALTER TABLE public.review_events
  ADD CONSTRAINT review_events_scheduler_variant_check
    CHECK (scheduler_variant IN ('baseline', 'adaptive'));

-- 3. user_words: cold-start prior + adaptive bookkeeping
--    cold_start_prior is computed from word frequency rank on first review.
--    Lower rank (commoner) → easier prior, higher rank → harder prior.
ALTER TABLE public.user_words
  ADD COLUMN IF NOT EXISTS cold_start_prior numeric,
  ADD COLUMN IF NOT EXISTS adaptive_evidence_count integer NOT NULL DEFAULT 0;

-- 4. user_settings: scheduler_variant feature flag
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS scheduler_variant text NOT NULL DEFAULT 'adaptive';

ALTER TABLE public.user_settings
  DROP CONSTRAINT IF EXISTS user_settings_scheduler_variant_check;
ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_scheduler_variant_check
    CHECK (scheduler_variant IN ('baseline', 'adaptive'));

-- 5. reading_question_attempts: persisted comprehension answers
CREATE TABLE IF NOT EXISTS public.reading_question_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_session_id  uuid REFERENCES public.daily_sessions(id) ON DELETE SET NULL,
  session_date      date,
  text_id           uuid NOT NULL REFERENCES public.texts(id) ON DELETE CASCADE,
  question_id       uuid NOT NULL REFERENCES public.reading_questions(id) ON DELETE CASCADE,
  selected_option   smallint NOT NULL,
  correct_option    smallint NOT NULL,
  correct           boolean NOT NULL,
  response_ms       integer,
  scheduler_variant text NOT NULL DEFAULT 'baseline',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reading_question_attempts_user_session_idx
  ON public.reading_question_attempts (user_id, session_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS reading_question_attempts_user_text_idx
  ON public.reading_question_attempts (user_id, text_id);

ALTER TABLE public.reading_question_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reading_question_attempts_select_own" ON public.reading_question_attempts;
DROP POLICY IF EXISTS "reading_question_attempts_insert_own" ON public.reading_question_attempts;

CREATE POLICY "reading_question_attempts_select_own"
  ON public.reading_question_attempts FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "reading_question_attempts_insert_own"
  ON public.reading_question_attempts FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- 6. record_reading_question_attempt RPC
DROP FUNCTION IF EXISTS public.record_reading_question_attempt(uuid, uuid, smallint, integer);
CREATE OR REPLACE FUNCTION public.record_reading_question_attempt(
  p_text_id uuid,
  p_question_id uuid,
  p_selected_option smallint,
  p_response_ms integer
)
RETURNS public.reading_question_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.daily_sessions%ROWTYPE;
  v_question public.reading_questions%ROWTYPE;
  v_session_date date := (now() at time zone 'Europe/London')::date;
  v_correct boolean;
  v_variant text := 'baseline';
  v_row public.reading_question_attempts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_question FROM public.reading_questions WHERE id = p_question_id;
  IF NOT FOUND OR v_question.text_id <> p_text_id THEN
    RAISE EXCEPTION 'question not found for text';
  END IF;

  v_correct := (p_selected_option = v_question.correct_option_index);

  SELECT scheduler_variant INTO v_variant FROM public.user_settings WHERE user_id = v_uid;
  v_variant := COALESCE(v_variant, 'adaptive');

  SELECT * INTO v_session FROM public.daily_sessions
    WHERE user_id = v_uid AND session_date = v_session_date;

  INSERT INTO public.reading_question_attempts (
    user_id, daily_session_id, session_date, text_id, question_id,
    selected_option, correct_option, correct, response_ms, scheduler_variant
  ) VALUES (
    v_uid, v_session.id, v_session_date, p_text_id, p_question_id,
    p_selected_option, v_question.correct_option_index, v_correct,
    GREATEST(0, COALESCE(p_response_ms, 0)), v_variant
  ) RETURNING * INTO v_row;

  -- Roll up reading-question accuracy onto daily_sessions for fast reads
  IF v_session.id IS NOT NULL THEN
    UPDATE public.daily_sessions
    SET reading_question_attempts_count = COALESCE(reading_question_attempts_count, 0) + 1,
        reading_question_accuracy = (
          SELECT AVG(CASE WHEN correct THEN 1.0 ELSE 0.0 END)
          FROM public.reading_question_attempts
          WHERE daily_session_id = v_session.id
        ),
        last_active_at = now()
    WHERE id = v_session.id;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_reading_question_attempt(uuid, uuid, smallint, integer)
  TO authenticated;

-- 7. record_review: extend signature with adaptive parameters and apply
--    learner_factor * item_factor (clamped to [0.80, 1.20]) to the
--    forward-going stability_days only on clean correct first-try paths.
--    Baseline path (scheduler_variant='baseline') is unchanged.
DROP FUNCTION IF EXISTS public.record_review(uuid, text, int, text, text[], text, date, text, text, timestamptz, timestamptz, timestamptz, text, boolean, integer);

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
  p_retry_index integer DEFAULT 0,
  p_scheduler_variant text DEFAULT 'baseline',
  p_learner_factor numeric DEFAULT 1.0,
  p_item_factor numeric DEFAULT 1.0
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

  v_variant text := CASE WHEN p_scheduler_variant = 'adaptive' THEN 'adaptive' ELSE 'baseline' END;
  v_lf numeric := COALESCE(p_learner_factor, 1.0);
  v_if numeric := COALESCE(p_item_factor, 1.0);
  v_combined numeric;

  v_is_first_ever boolean;
  v_is_second_clean boolean;
  v_growth numeric;
  v_baseline_stability numeric;
  v_new_stability numeric;
  v_new_difficulty numeric;
  v_new_learned_level integer;
  v_new_srs_state text;
  v_new_next_due timestamptz;
  v_new_consec integer;
  v_difficulty_before numeric;
  v_baseline_interval_days numeric;
  v_effective_interval_days numeric;

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

  -- Clamp combined adaptive multiplier conservatively to [0.80, 1.20]
  v_combined := GREATEST(0.80, LEAST(1.20, v_lf * v_if));

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

    v_difficulty_before := COALESCE(v_row.difficulty, 0.55);

    -- Legacy half-life update (kept for review_events backward compat)
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

    -- SRS v2 deterministic update
    v_is_first_ever := (v_row.srs_state = 'new')
                    OR (COALESCE(v_row.reps, 0) <= 1 AND COALESCE(v_row.lapses, 0) = 0
                        AND NOT v_correct);
    IF v_correct THEN
      v_is_first_ever := (v_row.srs_state = 'new')
                       OR (COALESCE(v_row.reps, 0) = 1 AND COALESCE(v_row.lapses, 0) = 0);
    END IF;

    v_is_second_clean := NOT v_is_first_ever
                       AND v_correct
                       AND p_first_try
                       AND COALESCE(v_row.consecutive_first_try_correct, 0) = 1
                       AND COALESCE(v_row.last_was_first_try, false);

    v_new_difficulty := v_difficulty_before;
    v_new_stability := COALESCE(v_row.stability_days, 0);
    v_new_learned_level := COALESCE(v_row.learned_level, 0);
    v_new_consec := COALESCE(v_row.consecutive_first_try_correct, 0);

    IF v_correct AND p_first_try THEN
      IF v_is_first_ever THEN
        v_new_difficulty := GREATEST(0.30, v_new_difficulty - 0.08);
        v_new_learned_level := v_new_learned_level + 2;
        v_new_stability := GREATEST(v_new_stability, 2);
        v_new_srs_state := 'review';
        v_new_consec := v_new_consec + 1;
      ELSIF v_is_second_clean THEN
        v_new_difficulty := GREATEST(0.20, v_new_difficulty - 0.05);
        v_new_learned_level := v_new_learned_level + 2;
        v_new_stability := GREATEST(6, v_new_stability * 3);
        v_new_stability := LEAST(730, v_new_stability);
        v_new_srs_state := 'review';
        v_new_consec := v_new_consec + 1;
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
      END IF;

      v_baseline_stability := v_new_stability;

      -- Apply adaptive multiplier only on clean correct paths in adaptive mode
      IF v_variant = 'adaptive' THEN
        v_new_stability := GREATEST(0.5, LEAST(730, v_baseline_stability * v_combined));
      END IF;

      v_new_next_due := v_now + (v_new_stability || ' days')::interval;

      v_row.successful_first_try_reviews := COALESCE(v_row.successful_first_try_reviews, 0) + 1;
      v_row.last_was_first_try := true;

    ELSIF v_correct AND NOT p_first_try THEN
      v_new_difficulty := GREATEST(0.20, v_new_difficulty - 0.01);
      IF v_new_learned_level > 0 THEN
        v_new_learned_level := v_new_learned_level + 1;
      END IF;
      v_new_stability := GREATEST(1, v_new_stability * 1.2);
      v_new_stability := LEAST(730, v_new_stability);
      v_baseline_stability := v_new_stability;
      v_new_consec := 0;
      v_new_srs_state := CASE WHEN v_new_stability < 2 THEN 'learning' ELSE 'review' END;
      v_row.last_was_first_try := false;
      v_new_next_due := v_now + interval '1 day';

    ELSE
      v_new_difficulty := LEAST(0.95, v_new_difficulty + 0.08);
      v_new_learned_level := GREATEST(0, v_new_learned_level - 1);
      v_new_stability := GREATEST(0.5, v_new_stability * 0.35);
      v_baseline_stability := v_new_stability;
      v_new_consec := 0;
      v_new_srs_state := 'learning';
      v_row.last_was_first_try := false;
      v_new_next_due := v_now + interval '1 day';
    END IF;

    v_baseline_interval_days := v_baseline_stability;
    v_effective_interval_days := EXTRACT(epoch FROM (v_new_next_due - v_now)) / 86400.0;

    v_row.consecutive_first_try_correct := v_new_consec;
    v_row.last_result := CASE WHEN v_correct THEN 'correct' ELSE 'incorrect' END;
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
        srs_state = v_new_srs_state,
        stability_days = v_new_stability,
        learned_level = v_new_learned_level,
        successful_first_try_reviews = COALESCE(v_row.successful_first_try_reviews, 0),
        consecutive_first_try_correct = v_new_consec,
        last_result = v_row.last_result,
        last_was_first_try = v_row.last_was_first_try,
        next_due = v_new_next_due,
        adaptive_evidence_count = COALESCE(adaptive_evidence_count, 0) + 1
    WHERE user_words.user_id = v_uid AND user_words.word_id = p_word_id;

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
        new_words_count, reviews_done, started_at, last_active_at,
        scheduler_variant
      ) VALUES (
        v_uid, v_session_date, 'flashcards',
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, v_now, v_now,
        v_variant
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
        completed_at = v_session.completed_at,
        scheduler_variant = COALESCE(v_session.scheduler_variant, v_variant)
    WHERE id = v_session.id;

    INSERT INTO public.review_events (
      user_id, word_id, daily_session_id, session_date,
      queue_kind, queue_source, card_type,
      shown_at, submitted_at, retry_scheduled_for, client_attempt_id,
      grade, correct, ms_spent, user_answer, expected,
      p_pred, delta_hours, half_life_before, half_life_after,
      first_try, retry_index,
      scheduler_variant, learner_factor, item_factor,
      baseline_interval_days, effective_interval_days,
      difficulty_before, difficulty_after
    ) VALUES (
      v_uid, p_word_id, v_session.id, v_session_date,
      v_queue_kind, v_queue_source, v_card_type,
      p_shown_at, v_now, p_retry_scheduled_for, p_client_attempt_id,
      p_grade, v_correct, GREATEST(0, p_ms_spent),
      COALESCE(p_user_answer, ''), COALESCE(p_expected, '{}'),
      v_p_pred, v_delta_hours, v_hl_before, v_hl_new,
      COALESCE(p_first_try, true), COALESCE(p_retry_index, 0),
      v_variant, v_lf, v_if,
      v_baseline_interval_days, v_effective_interval_days,
      v_difficulty_before, v_new_difficulty
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

GRANT EXECUTE ON FUNCTION public.record_review(
  uuid, text, int, text, text[], text, date, text, text,
  timestamptz, timestamptz, timestamptz, text, boolean, integer,
  text, numeric, numeric
) TO authenticated;

NOTIFY pgrst, 'reload schema';
