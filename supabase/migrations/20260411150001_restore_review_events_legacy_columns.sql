-- Restore legacy review_events instrumentation columns that exist in the
-- declared schema (20260226120000_srs.sql) but are missing on the remote
-- database. The current record_review (15-arg cleanup variant and the
-- 18-arg adaptive variant) both INSERT into these columns; without them
-- every record_review call fails with 42703.
--
-- The columns are kept nullable so historical rows that were written
-- before the originals were lost remain valid.

ALTER TABLE public.review_events
  ADD COLUMN IF NOT EXISTS grade            text,
  ADD COLUMN IF NOT EXISTS p_pred           numeric,
  ADD COLUMN IF NOT EXISTS delta_hours      numeric,
  ADD COLUMN IF NOT EXISTS half_life_before numeric,
  ADD COLUMN IF NOT EXISTS half_life_after  numeric;

ALTER TABLE public.review_events
  DROP CONSTRAINT IF EXISTS review_events_grade_check;

ALTER TABLE public.review_events
  ADD CONSTRAINT review_events_grade_check
    CHECK (grade IS NULL OR grade IN ('again', 'hard', 'good', 'easy'));
