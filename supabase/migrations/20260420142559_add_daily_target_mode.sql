ALTER TABLE public.daily_sessions
  ADD COLUMN daily_target_mode text NOT NULL DEFAULT 'recommended'
    CHECK (daily_target_mode IN ('recommended', 'manual'));

COMMENT ON COLUMN public.daily_sessions.daily_target_mode IS
  'Captured at target-commit time. Distinguishes autopilot (recommended) from self-selected (manual) targets for research analysis. Preference at write time, not current user_settings.daily_plan_mode.';
