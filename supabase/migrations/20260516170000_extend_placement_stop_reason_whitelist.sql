-- Extend baseline_test_runs_stop_reason_check to whitelist the v3 stop
-- reasons emitted by the floor-based adaptive engine. Without these,
-- the UPDATE in submitPlacementAnswer that finalises a run is rejected
-- by the CHECK constraint, the error is swallowed, and the run is
-- silently stuck in_progress. Confirmed against run
-- 33108969-0a70-4f80-b0bd-a97bc2c19f10 (true beginner, failed floor 0).

alter table public.baseline_test_runs
  drop constraint if exists baseline_test_runs_stop_reason_check;

alter table public.baseline_test_runs
  add constraint baseline_test_runs_stop_reason_check
    check (
      stop_reason is null
      or stop_reason in (
        'in_progress',
        'precision_reached',
        'consecutive_wrong_ceiling',
        'max_items',
        'top_of_bank_reached',
        'floor_failed_at_bottom',
        'floor_unresolved'
      )
    );
