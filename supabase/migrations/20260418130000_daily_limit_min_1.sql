-- Lower the minimum manual_daily_card_limit from 10 to 1
ALTER TABLE public.user_settings
  DROP CONSTRAINT IF EXISTS user_settings_manual_daily_card_limit_check;

ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_manual_daily_card_limit_check
    CHECK (manual_daily_card_limit BETWEEN 1 AND 9999);

NOTIFY pgrst, 'reload schema';
