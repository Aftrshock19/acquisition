-- User settings for flashcard behavior (matches Supabase SQL Editor snippets)
-- Run in order: table → RLS → drop policies → create policies → trigger → notify

-- 1. create_user_settings_table
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  learning_lang text NOT NULL DEFAULT 'es',

  daily_plan_mode text NOT NULL DEFAULT 'recommended',
  manual_daily_card_limit int NOT NULL DEFAULT 30,

  flashcard_selection_mode text NOT NULL DEFAULT 'recommended',
  include_cloze boolean NOT NULL DEFAULT true,
  include_normal boolean NOT NULL DEFAULT true,
  include_audio boolean NOT NULL DEFAULT false,
  include_mcq boolean NOT NULL DEFAULT false,
  include_sentences boolean NOT NULL DEFAULT false,

  retry_delay_seconds int NOT NULL DEFAULT 90,
  show_pos_hint boolean NOT NULL DEFAULT true,
  show_definition_first boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_settings_daily_plan_mode_check
    CHECK (daily_plan_mode IN ('recommended', 'manual')),

  CONSTRAINT user_settings_flashcard_selection_mode_check
    CHECK (flashcard_selection_mode IN ('recommended', 'manual')),

  CONSTRAINT user_settings_manual_daily_card_limit_check
    CHECK (manual_daily_card_limit BETWEEN 10 AND 200),

  CONSTRAINT user_settings_retry_delay_seconds_check
    CHECK (retry_delay_seconds BETWEEN 10 AND 3600)
);

-- 2. enable_rls_on_user_settings
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- 3. drop_existing_user_settings_policies
DROP POLICY IF EXISTS "user_settings_select_own" ON public.user_settings;
DROP POLICY IF EXISTS "user_settings_insert_own" ON public.user_settings;
DROP POLICY IF EXISTS "user_settings_update_own" ON public.user_settings;
DROP POLICY IF EXISTS "user_settings_upsert_own" ON public.user_settings;

-- 4. create_user_settings_select_policy
CREATE POLICY "user_settings_select_own"
ON public.user_settings
FOR SELECT
USING (user_id = auth.uid());

-- 5. create_user_settings_insert_policy
CREATE POLICY "user_settings_insert_own"
ON public.user_settings
FOR INSERT
WITH CHECK (user_id = auth.uid());

-- 6. create_user_settings_update_policy
CREATE POLICY "user_settings_update_own"
ON public.user_settings
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 7. create_set_updated_at_function_if_missing
DO $outer$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_updated_at'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.set_updated_at()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = public
      AS $body$
      BEGIN
        NEW.updated_at := now();
        RETURN NEW;
      END;
      $body$
    $fn$;
  END IF;
END
$outer$;

-- 8. drop_user_settings_updated_at_trigger_if_exists
DROP TRIGGER IF EXISTS user_settings_updated_at ON public.user_settings;

-- 9. create_user_settings_updated_at_trigger
CREATE TRIGGER user_settings_updated_at
BEFORE UPDATE ON public.user_settings
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- 10. reload_postgrest_schema_cache
NOTIFY pgrst, 'reload schema';
