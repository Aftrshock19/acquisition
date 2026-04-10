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
  ADD COLUMN IF NOT EXISTS last_resumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resume_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flashcards_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reading_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reading_time_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS listening_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS listening_playback_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS listening_time_seconds integer NOT NULL DEFAULT 0;

ALTER TABLE public.daily_sessions
  DROP CONSTRAINT IF EXISTS daily_sessions_assigned_flashcard_count_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_sessions_assigned_new_words_count_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_sessions_assigned_review_cards_count_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_sessions_flashcard_completed_count_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_sessions_flashcard_new_completed_count_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_sessions_flashcard_review_completed_count_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_sessions_flashcard_attempts_count_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_sessions_flashcard_retry_count_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_sessions_resume_count_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_sessions_reading_time_seconds_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_sessions_listening_time_seconds_nonnegative;

ALTER TABLE public.daily_sessions
  ADD CONSTRAINT daily_sessions_assigned_flashcard_count_nonnegative
    CHECK (assigned_flashcard_count >= 0),
  ADD CONSTRAINT daily_sessions_assigned_new_words_count_nonnegative
    CHECK (assigned_new_words_count >= 0),
  ADD CONSTRAINT daily_sessions_assigned_review_cards_count_nonnegative
    CHECK (assigned_review_cards_count >= 0),
  ADD CONSTRAINT daily_sessions_flashcard_completed_count_nonnegative
    CHECK (flashcard_completed_count >= 0),
  ADD CONSTRAINT daily_sessions_flashcard_new_completed_count_nonnegative
    CHECK (flashcard_new_completed_count >= 0),
  ADD CONSTRAINT daily_sessions_flashcard_review_completed_count_nonnegative
    CHECK (flashcard_review_completed_count >= 0),
  ADD CONSTRAINT daily_sessions_flashcard_attempts_count_nonnegative
    CHECK (flashcard_attempts_count >= 0),
  ADD CONSTRAINT daily_sessions_flashcard_retry_count_nonnegative
    CHECK (flashcard_retry_count >= 0),
  ADD CONSTRAINT daily_sessions_resume_count_nonnegative
    CHECK (resume_count >= 0),
  ADD CONSTRAINT daily_sessions_reading_time_seconds_nonnegative
    CHECK (reading_time_seconds >= 0),
  ADD CONSTRAINT daily_sessions_listening_time_seconds_nonnegative
    CHECK (listening_time_seconds >= 0);

UPDATE public.daily_sessions
SET assigned_flashcard_count = GREATEST(
      COALESCE(assigned_flashcard_count, 0),
      COALESCE(new_words_count, 0),
      COALESCE(assigned_new_words_count, 0) + COALESCE(assigned_review_cards_count, 0)
    ),
    flashcard_completed_count = GREATEST(
      COALESCE(flashcard_completed_count, 0),
      LEAST(COALESCE(reviews_done, 0), COALESCE(new_words_count, 0))
    ),
    flashcard_attempts_count = GREATEST(
      COALESCE(flashcard_attempts_count, 0),
      COALESCE(reviews_done, 0)
    ),
    started_at = COALESCE(started_at, created_at),
    last_active_at = COALESCE(last_active_at, updated_at),
    flashcards_completed_at = CASE
      WHEN flashcards_completed_at IS NULL
        AND COALESCE(reviews_done, 0) >= COALESCE(new_words_count, 0)
        THEN updated_at
      ELSE flashcards_completed_at
    END,
    completed_at = CASE
      WHEN completed AND completed_at IS NULL
        THEN COALESCE(listening_completed_at, reading_completed_at, updated_at)
      ELSE completed_at
    END;

CREATE INDEX IF NOT EXISTS daily_sessions_started_at_idx
  ON public.daily_sessions (user_id, started_at DESC)
  WHERE started_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS daily_sessions_completed_at_idx
  ON public.daily_sessions (user_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;

ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS daily_session_id uuid REFERENCES public.daily_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_date date,
  ADD COLUMN IF NOT EXISTS queue_kind text,
  ADD COLUMN IF NOT EXISTS queue_source text NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS shown_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS client_attempt_id text;

ALTER TABLE public.review_events
  DROP CONSTRAINT IF EXISTS review_events_queue_kind_check,
  DROP CONSTRAINT IF EXISTS review_events_queue_source_check;

ALTER TABLE public.review_events
  ADD CONSTRAINT review_events_queue_kind_check
    CHECK (queue_kind IS NULL OR queue_kind IN ('new', 'review')),
  ADD CONSTRAINT review_events_queue_source_check
    CHECK (queue_source IN ('main', 'retry'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'review_events' AND column_name = 'happened_at'
  ) THEN
    UPDATE public.review_events
    SET session_date = COALESCE(session_date, created_at::date, happened_at::date),
        submitted_at = COALESCE(submitted_at, created_at, happened_at);
  ELSE
    UPDATE public.review_events
    SET session_date = COALESCE(session_date, created_at::date),
        submitted_at = COALESCE(submitted_at, created_at);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS review_events_user_session_date_idx
  ON public.review_events (user_id, session_date DESC);

CREATE INDEX IF NOT EXISTS review_events_daily_session_id_idx
  ON public.review_events (daily_session_id);

CREATE UNIQUE INDEX IF NOT EXISTS review_events_user_client_attempt_unique
  ON public.review_events (user_id, client_attempt_id)
  WHERE client_attempt_id IS NOT NULL;

ALTER TABLE public.user_deck_words
  ADD COLUMN IF NOT EXISTS session_date date,
  ADD COLUMN IF NOT EXISTS daily_session_id uuid REFERENCES public.daily_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS text_id uuid REFERENCES public.texts(id) ON DELETE SET NULL;

UPDATE public.user_deck_words
SET session_date = COALESCE(session_date, added_at::date);

CREATE INDEX IF NOT EXISTS user_deck_words_user_session_date_idx
  ON public.user_deck_words (user_id, session_date DESC);

CREATE INDEX IF NOT EXISTS user_deck_words_daily_session_id_idx
  ON public.user_deck_words (daily_session_id);

CREATE TABLE IF NOT EXISTS public.export_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  anonymized_user_id text NOT NULL,
  format text NOT NULL,
  dataset text NOT NULL,
  date_from date,
  date_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT export_runs_format_check CHECK (format IN ('json', 'csv')),
  CONSTRAINT export_runs_dataset_check
    CHECK (
      dataset IN (
        'all',
        'daily_aggregates',
        'sessions',
        'review_events',
        'reading_events',
        'listening_events',
        'saved_words',
        'export_runs'
      )
    )
);

CREATE INDEX IF NOT EXISTS export_runs_user_created_at_idx
  ON public.export_runs (user_id, created_at DESC);

ALTER TABLE public.export_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "export_runs_own_select" ON public.export_runs;
DROP POLICY IF EXISTS "export_runs_own_insert" ON public.export_runs;

CREATE POLICY "export_runs_own_select"
ON public.export_runs
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "export_runs_own_insert"
ON public.export_runs
FOR INSERT
WITH CHECK (user_id = auth.uid());

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
  p_client_attempt_id text DEFAULT NULL
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
  v_delta_hours numeric;
  v_p_pred numeric;
  v_r numeric;
  v_correct boolean;
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
  v_card_type text := COALESCE(p_card_type, 'cloze');
  v_queue_kind text := CASE
    WHEN p_queue_kind IN ('new', 'review') THEN p_queue_kind
    ELSE NULL
  END;
  v_queue_source text := CASE
    WHEN p_queue_source = 'retry' THEN 'retry'
    ELSE 'main'
  END;
  v_attempts integer;
  v_correct_attempts integer;
  v_reps_today integer;
  v_accuracy numeric;
  v_difficulty numeric;
  v_session_stage text;
BEGIN
  IF v_uid IS NULL OR p_grade NOT IN ('again', 'hard', 'good', 'easy') THEN
    RETURN;
  END IF;

  IF p_client_attempt_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.review_events
      WHERE user_id = v_uid
        AND client_attempt_id = p_client_attempt_id
    ) THEN
      RETURN QUERY
      SELECT
        uw.user_id,
        uw.word_id,
        uw.status,
        uw.half_life_hours,
        uw.target_p,
        uw.last_review_at,
        uw.due_at,
        uw.reps,
        uw.lapses,
        uw.ewma_surprise,
        uw.ewma_abs_surprise,
        uw.ewma_accuracy
      FROM public.user_words uw
      WHERE uw.user_id = v_uid
        AND uw.word_id = p_word_id;
      RETURN;
    END IF;
  END IF;

  IF v_card_type NOT IN ('cloze', 'normal', 'audio', 'mcq', 'sentences') THEN
    v_card_type := 'cloze';
  END IF;

  v_correct := (p_grade <> 'again');

  BEGIN
    PERFORM * FROM public.upsert_user_word(p_word_id, NULL);

    SELECT *
    INTO v_row
    FROM public.user_words
    WHERE user_words.user_id = v_uid
      AND user_words.word_id = p_word_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN;
    END IF;

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
      WHEN 'again' THEN 0.6
      WHEN 'hard' THEN 0.85
      WHEN 'good' THEN 1.0
      WHEN 'easy' THEN 1.15
      ELSE 1.0
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

    v_attempts := COALESCE(v_row.attempts, 0) + 1;
    v_correct_attempts := COALESCE(v_row.correct_attempts, 0) + CASE
      WHEN v_correct THEN 1
      ELSE 0
    END;
    v_reps_today := CASE
      WHEN v_row.reps_today_date = v_session_date
        THEN COALESCE(v_row.reps_today, 0) + 1
      ELSE 1
    END;
    v_accuracy := v_correct_attempts::numeric / GREATEST(v_attempts, 1);
    v_difficulty := LEAST(
      1,
      GREATEST(
        0,
        COALESCE(v_row.difficulty, 0.5) + CASE
          WHEN v_correct THEN -0.05
          ELSE 0.08
        END
      )
    );

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
        difficulty = v_difficulty,
        last_seen_at = v_now,
        last_graded_at = v_now,
        reps_today = v_reps_today,
        reps_today_date = v_session_date
    WHERE user_words.user_id = v_uid
      AND user_words.word_id = p_word_id;

    SELECT *
    INTO v_session
    FROM public.daily_sessions
    WHERE user_id = v_uid
      AND session_date = v_session_date
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.daily_sessions (
        user_id,
        session_date,
        stage,
        assigned_flashcard_count,
        assigned_new_words_count,
        assigned_review_cards_count,
        flashcard_completed_count,
        flashcard_new_completed_count,
        flashcard_review_completed_count,
        flashcard_attempts_count,
        flashcard_retry_count,
        new_words_count,
        reviews_done,
        started_at,
        last_active_at
      )
      VALUES (
        v_uid,
        v_session_date,
        'flashcards',
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        v_now,
        v_now
      )
      RETURNING *
      INTO v_session;
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

    v_session.new_words_count := GREATEST(
      COALESCE(v_session.new_words_count, 0),
      COALESCE(v_session.assigned_flashcard_count, 0)
    );
    v_session.reviews_done := COALESCE(v_session.flashcard_completed_count, 0);

    v_session_stage := CASE
      WHEN COALESCE(v_session.flashcard_completed_count, 0) < COALESCE(v_session.assigned_flashcard_count, 0)
        THEN 'flashcards'
      WHEN NOT COALESCE(v_session.reading_done, false)
        THEN 'reading'
      WHEN NOT COALESCE(v_session.listening_done, false)
        THEN 'listening'
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

    INSERT INTO public.review_events (
      user_id,
      word_id,
      daily_session_id,
      session_date,
      queue_kind,
      queue_source,
      card_type,
      shown_at,
      submitted_at,
      retry_scheduled_for,
      client_attempt_id,
      grade,
      correct,
      ms_spent,
      user_answer,
      expected,
      p_pred,
      delta_hours,
      half_life_before,
      half_life_after
    )
    VALUES (
      v_uid,
      p_word_id,
      v_session.id,
      v_session_date,
      v_queue_kind,
      v_queue_source,
      v_card_type,
      p_shown_at,
      v_now,
      p_retry_scheduled_for,
      p_client_attempt_id,
      p_grade,
      v_correct,
      GREATEST(0, p_ms_spent),
      COALESCE(p_user_answer, ''),
      COALESCE(p_expected, '{}'),
      v_p_pred,
      v_delta_hours,
      v_hl_before,
      v_hl_new
    );
  EXCEPTION
    WHEN unique_violation THEN
      IF p_client_attempt_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.review_events
        WHERE user_id = v_uid
          AND client_attempt_id = p_client_attempt_id
      ) THEN
        RETURN QUERY
        SELECT
          uw.user_id,
          uw.word_id,
          uw.status,
          uw.half_life_hours,
          uw.target_p,
          uw.last_review_at,
          uw.due_at,
          uw.reps,
          uw.lapses,
          uw.ewma_surprise,
          uw.ewma_abs_surprise,
          uw.ewma_accuracy
        FROM public.user_words uw
        WHERE uw.user_id = v_uid
          AND uw.word_id = p_word_id;
        RETURN;
      END IF;
      RAISE;
  END;

  RETURN QUERY
  SELECT
    uw.user_id,
    uw.word_id,
    uw.status,
    uw.half_life_hours,
    uw.target_p,
    uw.last_review_at,
    uw.due_at,
    uw.reps,
    uw.lapses,
    uw.ewma_surprise,
    uw.ewma_abs_surprise,
    uw.ewma_accuracy
  FROM public.user_words uw
  WHERE uw.user_id = v_uid
    AND uw.word_id = p_word_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
