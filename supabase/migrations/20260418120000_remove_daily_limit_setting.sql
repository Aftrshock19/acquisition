-- Add remove_daily_limit setting and widen manual_daily_card_limit constraint
-- to support advanced users who want targets above 200.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS remove_daily_limit boolean NOT NULL DEFAULT false;

-- Widen the DB constraint to 9999. The application layer enforces the 200 cap
-- when remove_daily_limit is false; the DB constraint prevents nonsensical values.
ALTER TABLE public.user_settings
  DROP CONSTRAINT IF EXISTS user_settings_manual_daily_card_limit_check;

ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_manual_daily_card_limit_check
    CHECK (manual_daily_card_limit BETWEEN 10 AND 9999);

NOTIFY pgrst, 'reload schema';
