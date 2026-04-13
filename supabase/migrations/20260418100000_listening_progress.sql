-- Persistent per-user per-asset listening progress (survives across daily sessions)
CREATE TABLE IF NOT EXISTS public.listening_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.audio(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id)
);

-- RLS
ALTER TABLE public.listening_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own listening progress"
  ON public.listening_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own listening progress"
  ON public.listening_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own listening progress"
  ON public.listening_progress FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for querying all progress for a user (recommendation exclusion + visual state)
CREATE INDEX IF NOT EXISTS idx_listening_progress_user
  ON public.listening_progress (user_id, status);

COMMENT ON TABLE public.listening_progress IS 'Persistent per-user listening progress that survives across daily sessions';
