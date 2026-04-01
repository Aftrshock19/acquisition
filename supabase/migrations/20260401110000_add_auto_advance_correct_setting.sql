ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS auto_advance_correct boolean NOT NULL DEFAULT true;

UPDATE public.user_settings
SET auto_advance_correct = COALESCE(auto_advance_correct, true);

NOTIFY pgrst, 'reload schema';
 