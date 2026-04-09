ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS hide_translation_sentences boolean NOT NULL DEFAULT false;
