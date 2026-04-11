-- First-run intro onboarding flag.
-- Tracks whether the user has seen the multi-page welcome flow that leads
-- into the baseline placement check. Separate from placement_status so that
-- skipping or completing placement does not alone govern intro re-display.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS has_seen_intro boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz NULL;

NOTIFY pgrst, 'reload schema';
