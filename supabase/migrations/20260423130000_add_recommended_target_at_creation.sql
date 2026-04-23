ALTER TABLE daily_sessions
  ADD COLUMN recommended_target_at_creation integer;

COMMENT ON COLUMN daily_sessions.recommended_target_at_creation IS
  'Frozen at session creation. Equals the recommender output at the moment the session row was first inserted. Never updated. Serves two purposes: (1) user-facing — when a user switches to recommended mode mid-day, the target reverts to this value rather than recomputing; (2) research — captures recommender output per session for dissertation analysis of how recommendations evolved across a pilot user''s history.';
