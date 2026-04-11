-- Adaptive placement v2 columns.
--
-- The diagnostic moves from a fixed 7-band linear sweep (capped at rank 5000)
-- to a checkpoint-based adaptive routing model that can place learners
-- anywhere up to the top of the words table (~rank 34000).
--
-- This migration adds the new persistence fields that the v2 estimator
-- writes to and that the result page reads. Existing v1 columns are kept
-- intact for back-compat with already-completed runs.

ALTER TABLE public.baseline_test_runs
  ADD COLUMN IF NOT EXISTS confirmed_floor_rank integer NULL,
  ADD COLUMN IF NOT EXISTS top_of_bank_reached boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stop_reason text NULL,
  ADD COLUMN IF NOT EXISTS estimate_status text NULL,
  ADD COLUMN IF NOT EXISTS bracket_low_index integer NULL,
  ADD COLUMN IF NOT EXISTS bracket_high_index integer NULL,
  ADD COLUMN IF NOT EXISTS max_consecutive_wrong integer NULL,
  ADD COLUMN IF NOT EXISTS total_items_administered integer NULL;

-- Soft check on stop_reason values (not a hard constraint so older rows
-- that lack a stop_reason remain valid).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'baseline_test_runs_stop_reason_check'
  ) THEN
    ALTER TABLE public.baseline_test_runs
      ADD CONSTRAINT baseline_test_runs_stop_reason_check
      CHECK (
        stop_reason IS NULL
        OR stop_reason IN (
          'in_progress',
          'precision_reached',
          'consecutive_wrong_ceiling',
          'max_items',
          'top_of_bank_reached'
        )
      );
  END IF;
END $$;

-- Soft check on estimate_status values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'baseline_test_runs_estimate_status_check'
  ) THEN
    ALTER TABLE public.baseline_test_runs
      ADD CONSTRAINT baseline_test_runs_estimate_status_check
      CHECK (
        estimate_status IS NULL
        OR estimate_status IN ('early', 'provisional', 'medium', 'high')
      );
  END IF;
END $$;
