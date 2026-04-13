-- Add topic column to texts table for passage topic metadata
ALTER TABLE public.texts
  ADD COLUMN IF NOT EXISTS topic text;

COMMENT ON COLUMN public.texts.topic IS 'Human-readable topic/theme of the passage (e.g. "a day at the beach")';
