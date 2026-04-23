ALTER TABLE daily_sessions
  ADD COLUMN initial_assigned_flashcard_count integer;

COMMENT ON COLUMN daily_sessions.initial_assigned_flashcard_count IS
  'Frozen at session creation. Equals assigned_flashcard_count at the moment the session row was first inserted. Never updated. Used for dissertation analysis of commitment vs extension behaviour. assigned_flashcard_count may grow via extendFlashcardsSession; this column does not.';
