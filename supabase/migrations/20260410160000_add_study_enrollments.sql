-- Study enrollments: tracks which users are enrolled in which study cohort.
-- Each enrollment gets a stable, pre-generated anonymised participant ID
-- that is independent of the export anonymisation salt.

CREATE TABLE IF NOT EXISTS public.study_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cohort_key text NOT NULL DEFAULT 'default',
  participant_id text NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_enrollments_user_cohort_unique UNIQUE (user_id, cohort_key),
  CONSTRAINT study_enrollments_cohort_participant_unique UNIQUE (cohort_key, participant_id)
);

CREATE INDEX IF NOT EXISTS study_enrollments_cohort_key_idx
  ON public.study_enrollments (cohort_key);

ALTER TABLE public.study_enrollments ENABLE ROW LEVEL SECURITY;

-- Participants can see their own enrollment (needed for the app to know if
-- they are in a study, if we ever surface that).
CREATE POLICY "study_enrollments_own_select"
ON public.study_enrollments
FOR SELECT
USING (user_id = auth.uid());

-- No user-facing insert/update/delete — enrollment is managed by the
-- researcher via the service-role client.

NOTIFY pgrst, 'reload schema';
