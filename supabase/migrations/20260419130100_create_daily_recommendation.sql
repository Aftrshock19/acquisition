CREATE TABLE public.daily_recommendation (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('reading','listening')),
  local_date    date NOT NULL,
  asset_id      uuid NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, local_date)
);

ALTER TABLE public.daily_recommendation ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_rec_select_own ON public.daily_recommendation
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY daily_rec_insert_own ON public.daily_recommendation
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY daily_rec_update_own ON public.daily_recommendation
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY daily_rec_delete_own ON public.daily_recommendation
  FOR DELETE USING (auth.uid() = user_id);
