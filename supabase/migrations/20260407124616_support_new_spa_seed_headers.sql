ALTER TABLE IF EXISTS public.words_import_raw
ADD COLUMN IF NOT EXISTS tags text;
