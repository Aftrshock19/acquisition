ALTER TABLE public.daily_sessions
  ADD COLUMN IF NOT EXISTS reading_text_id uuid REFERENCES public.texts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reading_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS listening_asset_id uuid REFERENCES public.audio(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS listening_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS listening_max_position_seconds integer,
  ADD COLUMN IF NOT EXISTS listening_required_seconds integer,
  ADD COLUMN IF NOT EXISTS listening_transcript_opened boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS listening_playback_rate numeric;

ALTER TABLE public.daily_sessions
  DROP CONSTRAINT IF EXISTS daily_sessions_listening_max_position_nonnegative,
  DROP CONSTRAINT IF EXISTS daily_sessions_listening_required_positive,
  DROP CONSTRAINT IF EXISTS daily_sessions_listening_playback_rate_positive;

ALTER TABLE public.daily_sessions
  ADD CONSTRAINT daily_sessions_listening_max_position_nonnegative
    CHECK (
      listening_max_position_seconds IS NULL
      OR listening_max_position_seconds >= 0
    ),
  ADD CONSTRAINT daily_sessions_listening_required_positive
    CHECK (
      listening_required_seconds IS NULL
      OR listening_required_seconds > 0
    ),
  ADD CONSTRAINT daily_sessions_listening_playback_rate_positive
    CHECK (
      listening_playback_rate IS NULL
      OR listening_playback_rate > 0
    );

CREATE INDEX IF NOT EXISTS daily_sessions_listening_asset_id_idx
  ON public.daily_sessions (listening_asset_id)
  WHERE listening_asset_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
