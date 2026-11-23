-- Fixed placement baseline timestamp for recalibration.
--
-- lib/placement/recalibrate.ts derives `daysSinceBaseline` (which drives the
-- gain decay and the 'stable' status gate) from a baseline timestamp. It used
-- to read placement_last_recalibrated_at, but every recalibration overwrites
-- that column, so for a learner practising daily daysSinceBaseline was ~1
-- forever: the gain never decayed and status never reached 'stable'.
--
-- placement_baseline_at records when the current starting estimate was
-- established (placement run completed, self-certified level, beginner start,
-- discarded result). Recalibration reads it but never writes it.
-- placement_last_recalibrated_at keeps its meaning as the "last ran" marker.
--
-- Backfill (config column only; no research rows are touched). Preference:
--   1. baseline_test_runs.completed_at for user_settings.baseline_test_run_id.
--      The app sets baseline_test_run_id only when a run completes and clears
--      it on self-certification / beginner start / discard, so when it is
--      non-null that run's completion is the latest baseline event.
--   2. onboarding_completed_at. Written by every baseline path (placement
--      completion, self-certification, beginner start) and never by
--      recalibration, so it is the latest baseline for non-placement users.
--   3. placement_last_recalibrated_at. Last resort; may be later than the
--      true baseline, which only errs towards the old (faster) gain.
-- Users with none of these have never been placed and stay NULL.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS placement_baseline_at timestamptz NULL;

UPDATE public.user_settings us
SET placement_baseline_at = COALESCE(
  (
    SELECT btr.completed_at
    FROM public.baseline_test_runs btr
    WHERE btr.id = us.baseline_test_run_id
  ),
  us.onboarding_completed_at,
  us.placement_last_recalibrated_at
)
WHERE us.placement_baseline_at IS NULL
  AND (
    us.baseline_test_run_id IS NOT NULL
    OR us.onboarding_completed_at IS NOT NULL
    OR us.placement_last_recalibrated_at IS NOT NULL
  );

NOTIFY pgrst, 'reload schema';
