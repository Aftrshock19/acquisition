-- Placement baseline system: adaptive receptive-vocabulary onboarding test
-- Adds: baseline_item_bank, baseline_test_runs, baseline_test_responses,
-- and placement columns on user_settings.

-- =====================================================================
-- 1. baseline_item_bank
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.baseline_item_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  language text NOT NULL,
  word_id uuid NULL REFERENCES public.words(id) ON DELETE SET NULL,
  lemma text NOT NULL,
  frequency_rank integer NOT NULL,
  pos text NULL,
  item_type text NOT NULL,
  prompt_sentence text NULL,
  prompt_stem text NOT NULL,
  correct_answer text NOT NULL,
  accepted_answers jsonb NULL,
  options jsonb NULL,
  distractor_word_ids jsonb NULL,
  band_start integer NOT NULL,
  band_end integer NOT NULL,
  ambiguity_flag boolean NOT NULL DEFAULT false,
  quality_status text NOT NULL DEFAULT 'approved',
  source text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT baseline_item_bank_type_check
    CHECK (item_type IN ('recognition','recall')),
  CONSTRAINT baseline_item_bank_quality_check
    CHECK (quality_status IN ('approved','pending','rejected')),
  CONSTRAINT baseline_item_bank_band_check
    CHECK (band_start >= 1 AND band_end >= band_start)
);

CREATE INDEX IF NOT EXISTS baseline_item_bank_lang_band_type_idx
  ON public.baseline_item_bank (language, band_start, item_type)
  WHERE quality_status = 'approved';

CREATE INDEX IF NOT EXISTS baseline_item_bank_freq_rank_idx
  ON public.baseline_item_bank (language, frequency_rank);

CREATE UNIQUE INDEX IF NOT EXISTS baseline_item_bank_unique_item_idx
  ON public.baseline_item_bank (language, lemma, item_type, prompt_stem);

ALTER TABLE public.baseline_item_bank ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "baseline_item_bank_select_all" ON public.baseline_item_bank;
CREATE POLICY "baseline_item_bank_select_all"
  ON public.baseline_item_bank
  FOR SELECT
  USING (true);

DROP TRIGGER IF EXISTS baseline_item_bank_updated_at ON public.baseline_item_bank;
CREATE TRIGGER baseline_item_bank_updated_at
  BEFORE UPDATE ON public.baseline_item_bank
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 2. baseline_test_runs
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.baseline_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  language text NOT NULL,
  status text NOT NULL DEFAULT 'not_started',
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  skipped_at timestamptz NULL,
  algorithm_version text NOT NULL DEFAULT 'v1',
  recognition_items_answered integer NOT NULL DEFAULT 0,
  recall_items_answered integer NOT NULL DEFAULT 0,
  estimated_frontier_rank integer NULL,
  estimated_frontier_rank_low integer NULL,
  estimated_frontier_rank_high integer NULL,
  estimated_receptive_vocab integer NULL,
  confidence_score numeric NULL,
  raw_recognition_accuracy numeric NULL,
  raw_recall_accuracy numeric NULL,
  placement_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  item_selection_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT baseline_test_runs_status_check
    CHECK (status IN ('not_started','in_progress','completed','abandoned','skipped'))
);

CREATE INDEX IF NOT EXISTS baseline_test_runs_user_idx
  ON public.baseline_test_runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS baseline_test_runs_user_status_idx
  ON public.baseline_test_runs (user_id, status);

ALTER TABLE public.baseline_test_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "baseline_test_runs_select_own" ON public.baseline_test_runs;
CREATE POLICY "baseline_test_runs_select_own"
  ON public.baseline_test_runs
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "baseline_test_runs_insert_own" ON public.baseline_test_runs;
CREATE POLICY "baseline_test_runs_insert_own"
  ON public.baseline_test_runs
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "baseline_test_runs_update_own" ON public.baseline_test_runs;
CREATE POLICY "baseline_test_runs_update_own"
  ON public.baseline_test_runs
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS baseline_test_runs_updated_at ON public.baseline_test_runs;
CREATE TRIGGER baseline_test_runs_updated_at
  BEFORE UPDATE ON public.baseline_test_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 3. baseline_test_responses
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.baseline_test_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.baseline_test_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word_id uuid NULL REFERENCES public.words(id) ON DELETE SET NULL,
  item_bank_id uuid NULL REFERENCES public.baseline_item_bank(id) ON DELETE SET NULL,
  sequence_index integer NOT NULL,
  item_type text NOT NULL,
  band_start integer NOT NULL,
  band_end integer NOT NULL,
  prompt_stem text NOT NULL,
  prompt_sentence text NULL,
  options jsonb NULL,
  chosen_option_index integer NULL,
  chosen_text text NULL,
  normalized_response text NULL,
  is_correct boolean NOT NULL DEFAULT false,
  used_idk boolean NOT NULL DEFAULT false,
  latency_ms integer NULL,
  score_weight numeric NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  answered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT baseline_test_responses_type_check
    CHECK (item_type IN ('recognition','recall')),
  CONSTRAINT baseline_test_responses_unique_seq
    UNIQUE (run_id, sequence_index)
);

CREATE INDEX IF NOT EXISTS baseline_test_responses_run_idx
  ON public.baseline_test_responses (run_id, sequence_index);

CREATE INDEX IF NOT EXISTS baseline_test_responses_user_idx
  ON public.baseline_test_responses (user_id, answered_at DESC);

ALTER TABLE public.baseline_test_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "baseline_test_responses_select_own" ON public.baseline_test_responses;
CREATE POLICY "baseline_test_responses_select_own"
  ON public.baseline_test_responses
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "baseline_test_responses_insert_own" ON public.baseline_test_responses;
CREATE POLICY "baseline_test_responses_insert_own"
  ON public.baseline_test_responses
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- =====================================================================
-- 4. user_settings placement state columns
-- =====================================================================
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS current_frontier_rank integer NULL,
  ADD COLUMN IF NOT EXISTS current_frontier_rank_low integer NULL,
  ADD COLUMN IF NOT EXISTS current_frontier_rank_high integer NULL,
  ADD COLUMN IF NOT EXISTS placement_confidence numeric NULL,
  ADD COLUMN IF NOT EXISTS baseline_test_run_id uuid NULL REFERENCES public.baseline_test_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS placement_last_recalibrated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS placement_source text NULL,
  ADD COLUMN IF NOT EXISTS placement_status text NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS placement_recalibration_trace jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_placement_source_check'
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_placement_source_check
      CHECK (placement_source IS NULL OR placement_source IN ('baseline_only','baseline_plus_usage','usage_only'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_placement_status_check'
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_placement_status_check
      CHECK (placement_status IS NULL OR placement_status IN ('unknown','estimated','calibrating','stable'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
