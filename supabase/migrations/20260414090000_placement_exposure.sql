-- Placement exposure control v1.
--
-- Adds the minimum schema needed for retake-aware item selection. The picker
-- excludes (and penalizes) items the user has seen in prior diagnostic
-- attempts; we record per-response evidence so retakes can be audited and so
-- analytics/export can report when reuse was forced by sparse pools.

ALTER TABLE public.baseline_test_responses
  ADD COLUMN IF NOT EXISTS previous_attempt_seen boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reuse_due_to_pool_exhaustion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selection_seed text NULL;

-- Fast lookup of all items a user has seen across prior attempts.
CREATE INDEX IF NOT EXISTS baseline_test_responses_user_item_idx
  ON public.baseline_test_responses (user_id, item_bank_id, answered_at DESC);

NOTIFY pgrst, 'reload schema';
