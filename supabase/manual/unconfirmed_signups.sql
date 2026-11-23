-- READ-ONLY. Run by hand in the Supabase SQL editor; nothing runs this automatically.
--
-- Sign-ups since 2026-04-26 that never confirmed their email, by week.
--
-- Columns:
--   week_starting              Monday of the week the account was created
--                              (Europe/London, the app's session time zone).
--                              The last row is the TOTAL.
--   unconfirmed_signups        auth.users rows created in that week with
--                              email_confirmed_at IS NULL.
--   without_user_settings_row  how many of those have no row in
--                              public.user_settings.
--   all_signups                every account created in that week, confirmed
--                              or not, to put the first number in proportion.
--
-- public.user_settings is the app's per-user table (one row per user, keyed by
-- user_id). There is no profiles table and no trigger on auth.users: the row
-- is created by the app the first time a signed-in user reaches onboarding or
-- saves settings. So "no row" means the person never got into the app, which
-- is what you would expect for an unconfirmed account. An unconfirmed account
-- WITH a row (unconfirmed_signups - without_user_settings_row) got in anyway.
--
-- "Since 2026-04-26" is taken as 2026-04-26 00:00 Europe/London.

WITH signups AS (
  SELECT
    u.id,
    date_trunc('week', u.created_at AT TIME ZONE 'Europe/London')::date AS week_starting,
    u.email_confirmed_at IS NULL AS unconfirmed,
    NOT EXISTS (
      SELECT 1 FROM public.user_settings s WHERE s.user_id = u.id
    ) AS no_settings_row
  FROM auth.users u
  WHERE u.created_at >= (timestamp '2026-04-26 00:00:00' AT TIME ZONE 'Europe/London')
)
SELECT
  COALESCE(week_starting::text, 'TOTAL') AS week_starting,
  count(*) FILTER (WHERE unconfirmed) AS unconfirmed_signups,
  count(*) FILTER (WHERE unconfirmed AND no_settings_row) AS without_user_settings_row,
  count(*) AS all_signups
FROM signups
GROUP BY GROUPING SETS ((week_starting), ())
ORDER BY signups.week_starting NULLS LAST;
