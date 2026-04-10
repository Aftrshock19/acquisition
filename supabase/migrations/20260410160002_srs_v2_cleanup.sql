-- SRS v2 cleanup: scheduler_outcome instrumentation + stability cap 365
-- ---------------------------------------------------------------------------
-- 1. Add scheduler_outcome to review_events
-- 2. Update record_review RPC:
--    - writes scheduler_outcome on every review
--    - tightens stability cap to 365 days (was 730)
--    - adds guardrails: no NaN/negative/null propagation
-- ---------------------------------------------------------------------------

-- 1. Add scheduler_outcome column
-- ---------------------------------------------------------------------------
ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS scheduler_outcome text;

ALTER TABLE public.review_events
  DROP CONSTRAINT IF EXISTS review_events_scheduler_outcome_check;

ALTER TABLE public.review_events
  ADD CONSTRAINT review_events_scheduler_outcome_check
    CHECK (scheduler_outcome IS NULL OR scheduler_outcome IN (
      'first_clean_success',
      'second_clean_success',
      'later_clean_review',
      'rescued_success',
      'incorrect_lapse'
    ));

-- Historical rows: leave as NULL (no fabricated precision)
-- New rows will always have a value set by record_review.

CREATE INDEX IF NOT EXISTS review_events_scheduler_outcome_idx
  ON public.review_events (user_id, scheduler_outcome)
  WHERE scheduler_outcome IS NOT NULL;

-- 2. Replace record_review with instrumented + capped version
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_review(uuid, text, int, text, text[], text, date, text, text, timestamptz, timestamptz, timestamptz, text, boolean, integer);
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
  v_scheduler_outcome text;

  -- Hard caps (keep in sync with lib/srs/scheduler.ts constants)
  v_max_stability_days constant numeric := 365;
  v_min_stability_days constant numeric := 0.5;

  -- Legacy half-life variables (kept for review_events backward compat)
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

    -- Guardrail: sanitise incoming state to prevent NaN/null propagation
    v_new_difficulty   := GREATEST(0.15, LEAST(0.95, COALESCE(v_row.difficulty, 0.55)));
    v_new_stability    := GREATEST(0,    LEAST(v_max_stability_days, COALESCE(v_row.stability_days, 0)));
    v_new_learned_level := GREATEST(0, COALESCE(v_row.learned_level, 0));
    v_new_consec       := GREATEST(0, COALESCE(v_row.consecutive_first_try_correct, 0));

    v_is_first_ever := FALSE;
    IF v_correct THEN
      v_is_first_ever := (v_row.srs_state = 'new')
                       OR (COALESCE(v_row.reps, 0) = 1 AND COALESCE(v_row.lapses, 0) = 0);
    END IF;

    v_is_second_clean := NOT v_is_first_ever
                       AND v_correct
                       AND p_first_try
                       AND v_new_consec = 1
                       AND COALESCE(v_row.last_was_first_try, false);

    IF v_correct AND p_first_try THEN
      -- Clean success
      IF v_is_first_ever THEN
        -- Path: first_clean_success
        v_scheduler_outcome := 'first_clean_success';
        v_new_difficulty    := GREATEST(0.30, v_new_difficulty - 0.08);
        v_new_learned_level := v_new_learned_level + 2;
        v_new_stability     := GREATEST(v_new_stability, 2);
        v_new_srs_state     := 'review';
        v_new_consec        := v_new_consec + 1;
        v_new_next_due      := v_now + interval '2 days';

      ELSIF v_is_second_clean THEN
        -- Path: second_clean_success
        v_scheduler_outcome := 'second_clean_success';
        v_new_difficulty    := GREATEST(0.20, v_new_difficulty - 0.05);
        v_new_learned_level := v_new_learned_level + 2;
        v_new_stability     := LEAST(v_max_stability_days, GREATEST(6, v_new_stability * 3));
        v_new_srs_state     := 'review';
        v_new_consec        := v_new_consec + 1;
        v_new_next_due      := v_now + (v_new_stability || ' days')::interval;

      ELSE
        -- Path: later_clean_review
        v_scheduler_outcome := 'later_clean_review';
        v_growth := 1.8 + (1.0 - v_new_difficulty) * 0.8;
        IF v_new_consec >= 2 THEN
          v_growth := v_growth + 0.15;
        END IF;
        v_new_stability := LEAST(v_max_stability_days,
                             GREATEST(v_new_stability + 1, v_new_stability * v_growth));
        v_new_difficulty    := GREATEST(0.15, v_new_difficulty - 0.02);
        v_new_learned_level := v_new_learned_level + 1;
        v_new_srs_state     := 'review';
        v_new_consec        := v_new_consec + 1;
        v_new_next_due      := v_now + (v_new_stability || ' days')::interval;
      END IF;

      v_row.successful_first_try_reviews := COALESCE(v_row.successful_first_try_reviews, 0) + 1;
      v_row.last_was_first_try := true;

    ELSIF v_correct AND NOT p_first_try THEN
      -- Path: rescued_success
      v_scheduler_outcome     := 'rescued_success';
      v_new_difficulty        := GREATEST(0.20, v_new_difficulty - 0.01);
      IF v_new_learned_level > 0 THEN
        v_new_learned_level   := v_new_learned_level + 1;
      END IF;
      v_new_stability         := LEAST(v_max_stability_days, GREATEST(1, v_new_stability * 1.2));
      v_new_consec            := 0;
      v_new_srs_state         := CASE WHEN v_new_stability < 2 THEN 'learning' ELSE 'review' END;
      v_row.last_was_first_try := false;
      v_new_next_due          := v_now + interval '1 day';

    ELSE
      -- Path: incorrect_lapse
      v_scheduler_outcome     := 'incorrect_lapse';
      v_new_difficulty        := LEAST(0.95, v_new_difficulty + 0.08);
      v_new_learned_level     := GREATEST(0, v_new_learned_level - 1);
      v_new_stability         := GREATEST(v_min_stability_days, v_new_stability * 0.35);
      v_new_consec            := 0;
      v_new_srs_state         := 'learning';
      v_row.last_was_first_try := false;
      -- Due tomorrow unless recovered in-session
      v_new_next_due          := v_now + interval '1 day';
    END IF;

    -- Guardrail: next_due must always be in the future (>= 1 hour from now)
    v_new_next_due := GREATEST(v_new_next_due, v_now + interval '1 hour');

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
    -- Insert review event with first_try, retry_index, scheduler_outcome
    -- -----------------------------------------------------------------------
    INSERT INTO public.review_events (
      user_id, word_id, daily_session_id, session_date,
      queue_kind, queue_source, card_type,
      shown_at, submitted_at, retry_scheduled_for, client_attempt_id,
      grade, correct, ms_spent, user_answer, expected,
      p_pred, delta_hours, half_life_before, half_life_after,
      first_try, retry_index,
      scheduler_outcome
    ) VALUES (
      v_uid, p_word_id, v_session.id, v_session_date,
      v_queue_kind, v_queue_source, v_card_type,
      p_shown_at, v_now, p_retry_scheduled_for, p_client_attempt_id,
      p_grade, v_correct, GREATEST(0, p_ms_spent),
      COALESCE(p_user_answer, ''), COALESCE(p_expected, '{}'),
      v_p_pred, v_delta_hours, v_hl_before, v_hl_new,
      COALESCE(p_first_try, true), COALESCE(p_retry_index, 0),
      v_scheduler_outcome
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
