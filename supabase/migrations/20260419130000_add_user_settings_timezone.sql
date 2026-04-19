ALTER TABLE public.user_settings
  ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';
