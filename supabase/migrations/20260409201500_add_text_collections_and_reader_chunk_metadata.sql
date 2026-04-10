CREATE TABLE IF NOT EXISTS public.text_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  lang text NOT NULL,
  author text,
  description text,
  collection_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS text_collections_updated_at ON public.text_collections;
CREATE TRIGGER text_collections_updated_at
BEFORE UPDATE ON public.text_collections
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.texts
  ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES public.text_collections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_index integer,
  ADD COLUMN IF NOT EXISTS section_number integer,
  ADD COLUMN IF NOT EXISTS word_count integer,
  ADD COLUMN IF NOT EXISTS estimated_minutes integer,
  ADD COLUMN IF NOT EXISTS difficulty_cefr text;

ALTER TABLE public.texts
  DROP CONSTRAINT IF EXISTS texts_word_count_nonnegative,
  DROP CONSTRAINT IF EXISTS texts_estimated_minutes_positive;

ALTER TABLE public.texts
  ADD CONSTRAINT texts_word_count_nonnegative CHECK (word_count IS NULL OR word_count >= 0),
  ADD CONSTRAINT texts_estimated_minutes_positive CHECK (estimated_minutes IS NULL OR estimated_minutes > 0);

CREATE INDEX IF NOT EXISTS text_collections_lang_idx
  ON public.text_collections (lang);

CREATE INDEX IF NOT EXISTS texts_collection_id_idx
  ON public.texts (collection_id);

CREATE INDEX IF NOT EXISTS texts_collection_order_idx
  ON public.texts (collection_id, order_index NULLS LAST, created_at);

UPDATE public.texts
SET word_count = CASE
      WHEN btrim(content) = '' THEN 0
      ELSE array_length(regexp_split_to_array(btrim(content), E'\\s+'), 1)
    END
WHERE word_count IS NULL;

UPDATE public.texts
SET estimated_minutes = GREATEST(1, CEIL(word_count / 180.0)::integer)
WHERE estimated_minutes IS NULL
  AND word_count IS NOT NULL;

ALTER TABLE public.text_collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read text_collections" ON public.text_collections;

CREATE POLICY "Allow read text_collections"
ON public.text_collections
FOR SELECT
USING (true);

NOTIFY pgrst, 'reload schema';
