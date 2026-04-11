-- Placement fairness v3 (floor-based, cognate/morphology-aware).
--
-- Adds the columns needed by the v3 adaptive engine:
--   - item bank: cognate_class, morphology_class, is_inflected_form,
--     lemma_rank, effective_diagnostic_rank
--   - responses: floor_index, floor_sequence, cognate_class,
--     morphology_class, is_inflected_form, lemma_rank,
--     effective_diagnostic_rank, lexical_weight, morphology_weight
--   - runs: highest_cleared_floor_index, highest_tentative_floor_index,
--     total_floors_visited, floor_outcomes (jsonb),
--     frontier_evidence_quality, non_cognate_support_present,
--     cognate_heavy_estimate, morphology_heavy_estimate
--
-- All columns are additive and nullable or defaulted, so existing rows
-- continue to work under the legacy engine path (which falls back to
-- non_cognate / base / 1.0 weights).

ALTER TABLE public.baseline_item_bank
  ADD COLUMN IF NOT EXISTS cognate_class text NOT NULL DEFAULT 'non_cognate',
  ADD COLUMN IF NOT EXISTS morphology_class text NOT NULL DEFAULT 'base',
  ADD COLUMN IF NOT EXISTS is_inflected_form boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lemma_rank integer NULL,
  ADD COLUMN IF NOT EXISTS effective_diagnostic_rank integer NULL,
  ADD COLUMN IF NOT EXISTS cognate_similarity real NULL;

ALTER TABLE public.baseline_item_bank
  ADD CONSTRAINT baseline_item_bank_cognate_class_chk
    CHECK (cognate_class IN ('non_cognate', 'weak_cognate', 'strong_cognate')) NOT VALID;
ALTER TABLE public.baseline_item_bank
  VALIDATE CONSTRAINT baseline_item_bank_cognate_class_chk;

ALTER TABLE public.baseline_item_bank
  ADD CONSTRAINT baseline_item_bank_morphology_class_chk
    CHECK (morphology_class IN ('base', 'common_inflection', 'regular_inflection', 'irregular_or_marked_inflection')) NOT VALID;
ALTER TABLE public.baseline_item_bank
  VALIDATE CONSTRAINT baseline_item_bank_morphology_class_chk;

CREATE INDEX IF NOT EXISTS baseline_item_bank_effective_rank_idx
  ON public.baseline_item_bank (language, item_type, effective_diagnostic_rank)
  WHERE quality_status = 'approved';

ALTER TABLE public.baseline_test_responses
  ADD COLUMN IF NOT EXISTS floor_index integer NULL,
  ADD COLUMN IF NOT EXISTS floor_sequence integer NULL,
  ADD COLUMN IF NOT EXISTS cognate_class text NOT NULL DEFAULT 'non_cognate',
  ADD COLUMN IF NOT EXISTS morphology_class text NOT NULL DEFAULT 'base',
  ADD COLUMN IF NOT EXISTS is_inflected_form boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lemma_rank integer NULL,
  ADD COLUMN IF NOT EXISTS effective_diagnostic_rank integer NULL,
  ADD COLUMN IF NOT EXISTS lexical_weight real NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS morphology_weight real NOT NULL DEFAULT 1.0;

ALTER TABLE public.baseline_test_runs
  ADD COLUMN IF NOT EXISTS highest_cleared_floor_index integer NULL,
  ADD COLUMN IF NOT EXISTS highest_tentative_floor_index integer NULL,
  ADD COLUMN IF NOT EXISTS total_floors_visited integer NULL,
  ADD COLUMN IF NOT EXISTS floor_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS frontier_evidence_quality text NULL,
  ADD COLUMN IF NOT EXISTS non_cognate_support_present boolean NULL,
  ADD COLUMN IF NOT EXISTS cognate_heavy_estimate boolean NULL,
  ADD COLUMN IF NOT EXISTS morphology_heavy_estimate boolean NULL;

ALTER TABLE public.baseline_test_runs
  ADD CONSTRAINT baseline_test_runs_frontier_quality_chk
    CHECK (frontier_evidence_quality IS NULL
           OR frontier_evidence_quality IN ('low', 'medium', 'high')) NOT VALID;
ALTER TABLE public.baseline_test_runs
  VALIDATE CONSTRAINT baseline_test_runs_frontier_quality_chk;

NOTIFY pgrst, 'reload schema';
