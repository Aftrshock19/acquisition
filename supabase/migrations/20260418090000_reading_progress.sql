-- Persistent per-user per-text reading progress (survives across daily sessions)
CREATE TABLE IF NOT EXISTS public.reading_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text_id uuid NOT NULL REFERENCES public.texts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, text_id)
);

-- RLS
ALTER TABLE public.reading_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reading progress"
  ON public.reading_progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reading progress"
  ON public.reading_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reading progress"
  ON public.reading_progress FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for querying all progress for a user (recommendation exclusion)
CREATE INDEX IF NOT EXISTS idx_reading_progress_user
  ON public.reading_progress (user_id, status);

COMMENT ON TABLE public.reading_progress IS 'Persistent per-user reading progress that survives across daily sessions';
