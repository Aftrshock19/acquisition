-- Extend the audio table with production columns for the Chirp listening pipeline.
-- Adds variant tracking, provider metadata, deterministic storage paths,
-- and status management.  Keeps full backward compatibility with the
-- existing listening flow (url, title, transcript, duration_seconds stay).

-- 1. Add new columns
ALTER TABLE public.audio
  ADD COLUMN IF NOT EXISTS variant_type  text NOT NULL DEFAULT 'support',
  ADD COLUMN IF NOT EXISTS provider      text NOT NULL DEFAULT 'google_chirp',
  ADD COLUMN IF NOT EXISTS voice_name    text,
  ADD COLUMN IF NOT EXISTS language_code text NOT NULL DEFAULT 'es-ES',
  ADD COLUMN IF NOT EXISTS storage_path  text,
  ADD COLUMN IF NOT EXISTS mime_type     text NOT NULL DEFAULT 'audio/mpeg',
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS error_message text;

-- 2. Constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audio_variant_type_check'
  ) THEN
    ALTER TABLE public.audio
      ADD CONSTRAINT audio_variant_type_check
      CHECK (variant_type IN ('support', 'transfer'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audio_status_check'
  ) THEN
    ALTER TABLE public.audio
      ADD CONSTRAINT audio_status_check
      CHECK (status IN ('ready', 'pending', 'processing', 'failed'));
  END IF;
END $$;

-- 3. Unique constraint: one variant per text.
--    Clean up any smoke-test duplicates first.
DO $$
BEGIN
  -- Delete older duplicates if any exist (keep the newest)
  DELETE FROM public.audio a
  USING public.audio b
  WHERE a.text_id = b.text_id
    AND a.variant_type = b.variant_type
    AND a.created_at < b.created_at;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audio_text_variant_unique'
  ) THEN
    ALTER TABLE public.audio
      ADD CONSTRAINT audio_text_variant_unique UNIQUE (text_id, variant_type);
  END IF;
END $$;

-- 4. Index for asset lookup by status
CREATE INDEX IF NOT EXISTS audio_status_idx ON public.audio (status);
CREATE INDEX IF NOT EXISTS audio_variant_type_idx ON public.audio (variant_type);
