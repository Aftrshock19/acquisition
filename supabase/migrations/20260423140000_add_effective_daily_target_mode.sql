ALTER TABLE daily_sessions
  ADD COLUMN effective_daily_target_mode text
    CHECK (effective_daily_target_mode IN ('recommended', 'manual'));

COMMENT ON COLUMN daily_sessions.effective_daily_target_mode IS
  'Null by default. Set to ''manual'' when the user''s completion exceeds recommended_target_at_creation while user_settings.daily_plan_mode is ''recommended''. Used by /settings to disable the recommended radio for the remainder of the day, and by dissertation analysis to measure override behaviour. Resets with each new daily_sessions row at midnight.';
