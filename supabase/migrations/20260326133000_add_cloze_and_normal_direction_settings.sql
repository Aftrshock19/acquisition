ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS include_cloze_en_to_es boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS include_cloze_es_to_en boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS include_normal_en_to_es boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS include_normal_es_to_en boolean NOT NULL DEFAULT false;

UPDATE public.user_settings
SET
  include_cloze_en_to_es = COALESCE(include_cloze_en_to_es, include_cloze, true),
  include_cloze_es_to_en = COALESCE(include_cloze_es_to_en, false),
  include_normal_en_to_es = COALESCE(include_normal_en_to_es, include_normal, true),
  include_normal_es_to_en = COALESCE(include_normal_es_to_en, false);

NOTIFY pgrst, 'reload schema';
