-- Onboarding entry mode.
-- Distinguishes how a user finished first-run onboarding:
--   beginner_default  — user said they were new to Spanish; no baseline taken
--   baseline          — user completed the adaptive baseline placement test
--   self_certified    — user chose a CEFR level themselves
--
-- self_certified_cefr_level records the picked CEFR label when applicable.
-- Adaptive recalibration may still update current_frontier_rank over time;
-- this column is only a record of the user's stated starting point.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS onboarding_entry_mode text NULL,
  ADD COLUMN IF NOT EXISTS self_certified_cefr_level text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_onboarding_entry_mode_check'
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_onboarding_entry_mode_check
      CHECK (
        onboarding_entry_mode IS NULL
        OR onboarding_entry_mode IN ('beginner_default','baseline','self_certified')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_self_certified_cefr_level_check'
  ) THEN
    ALTER TABLE public.user_settings
      ADD CONSTRAINT user_settings_self_certified_cefr_level_check
      CHECK (
        self_certified_cefr_level IS NULL
        OR self_certified_cefr_level IN ('A1','A2','B1','B2','C1')
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
