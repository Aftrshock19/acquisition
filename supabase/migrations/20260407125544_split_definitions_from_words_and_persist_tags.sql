ALTER TABLE IF EXISTS public.words_import_raw
ADD COLUMN IF NOT EXISTS tags text;

ALTER TABLE public.words
ADD COLUMN IF NOT EXISTS tags text[];

UPDATE public.words
SET tags = ARRAY[]::text[]
WHERE tags IS NULL;

ALTER TABLE public.words
ALTER COLUMN tags SET DEFAULT ARRAY[]::text[],
ALTER COLUMN tags SET NOT NULL;

CREATE INDEX IF NOT EXISTS words_tags_idx
  ON public.words
  USING gin (tags);

CREATE TABLE IF NOT EXISTS public.definitions (
  id uuid PRIMARY KEY,
  rank integer,
  lemma text,
  translation text,
  definition_es text,
  definition_en text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.definitions
  ADD COLUMN IF NOT EXISTS rank integer,
  ADD COLUMN IF NOT EXISTS lemma text,
  ADD COLUMN IF NOT EXISTS translation text,
  ADD COLUMN IF NOT EXISTS definition_es text,
  ADD COLUMN IF NOT EXISTS definition_en text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'words' AND column_name = 'definition_es'
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'words' AND column_name = 'definition_en'
  ) THEN
    EXECUTE $sql$
      INSERT INTO public.definitions (
        id,
        rank,
        lemma,
        translation,
        definition_es,
        definition_en,
        created_at
      )
      SELECT
        w.id,
        w.rank,
        w.lemma,
        w.translation,
        w.definition_es,
        w.definition_en,
        COALESCE(w.created_at, now())
      FROM public.words w
      ON CONFLICT (id) DO UPDATE
      SET
        rank = EXCLUDED.rank,
        lemma = EXCLUDED.lemma,
        translation = EXCLUDED.translation,
        definition_es = EXCLUDED.definition_es,
        definition_en = EXCLUDED.definition_en
    $sql$;
  ELSE
    INSERT INTO public.definitions (
      id,
      rank,
      lemma,
      translation,
      created_at
    )
    SELECT
      w.id,
      w.rank,
      w.lemma,
      w.translation,
      COALESCE(w.created_at, now())
    FROM public.words w
    ON CONFLICT (id) DO UPDATE
    SET
      rank = EXCLUDED.rank,
      lemma = EXCLUDED.lemma,
      translation = EXCLUDED.translation;
  END IF;
END
$$;

UPDATE public.definitions d
SET
  rank = w.rank,
  lemma = w.lemma,
  translation = w.translation,
  created_at = COALESCE(d.created_at, w.created_at, now())
FROM public.words w
WHERE d.id = w.id;

DELETE FROM public.definitions d
WHERE NOT EXISTS (
  SELECT 1
  FROM public.words w
  WHERE w.id = d.id
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'definitions_id_fkey'
      AND conrelid = 'public.definitions'::regclass
  ) THEN
    ALTER TABLE public.definitions
      ADD CONSTRAINT definitions_id_fkey
      FOREIGN KEY (id) REFERENCES public.words(id) ON DELETE CASCADE;
  END IF;
END
$$;

UPDATE public.definitions
SET created_at = now()
WHERE created_at IS NULL;

ALTER TABLE public.definitions
  ALTER COLUMN rank SET NOT NULL,
  ALTER COLUMN lemma SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'definitions_rank_positive'
      AND conrelid = 'public.definitions'::regclass
  ) THEN
    ALTER TABLE public.definitions
      ADD CONSTRAINT definitions_rank_positive CHECK (rank > 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'definitions_rank_unique'
      AND conrelid = 'public.definitions'::regclass
  ) THEN
    ALTER TABLE public.definitions
      ADD CONSTRAINT definitions_rank_unique UNIQUE (rank);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS definitions_lemma_idx
  ON public.definitions (lemma);

ALTER TABLE public.definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read definitions" ON public.definitions;
CREATE POLICY "Allow read definitions"
  ON public.definitions FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION public.get_daily_queue(p_lang text, p_new_limit int, p_review_limit int)
RETURNS TABLE (
  word_id uuid,
  lemma text,
  rank int,
  kind text,
  pos text,
  translation text,
  definition_es text,
  definition_en text,
  example_sentence text,
  example_sentence_en text,
  definition text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lang text := COALESCE(NULLIF(trim(p_lang), ''), 'es');
BEGIN
  IF v_uid IS NULL OR v_lang <> 'es' THEN
    RETURN;
  END IF;

  RETURN QUERY
  (SELECT
      w.id AS word_id,
      w.lemma,
      w.rank,
      'review'::text AS kind,
      w.pos,
      w.translation,
      d.definition_es,
      d.definition_en,
      w.example_sentence,
      w.example_sentence_en,
      COALESCE(w.translation, d.translation, d.definition_en, d.definition_es) AS definition
   FROM public.user_words uw
   JOIN public.words w ON w.id = uw.word_id
   LEFT JOIN public.definitions d ON d.id = w.id
   WHERE uw.user_id = v_uid
     AND uw.due_at <= now()
   ORDER BY uw.due_at ASC
   LIMIT p_review_limit)
  UNION ALL
  (SELECT
      w.id AS word_id,
      w.lemma,
      w.rank,
      'new'::text AS kind,
      w.pos,
      w.translation,
      d.definition_es,
      d.definition_en,
      w.example_sentence,
      w.example_sentence_en,
      COALESCE(w.translation, d.translation, d.definition_en, d.definition_es) AS definition
   FROM public.words w
   LEFT JOIN public.definitions d ON d.id = w.id
   WHERE NOT EXISTS (
       SELECT 1
       FROM public.user_words uw
       WHERE uw.user_id = v_uid
         AND uw.word_id = w.id
     )
   ORDER BY w.rank ASC
   LIMIT p_new_limit);
END;
$$;

ALTER TABLE public.words
  DROP COLUMN IF EXISTS definition_es,
  DROP COLUMN IF EXISTS definition_en;

NOTIFY pgrst, 'reload schema';
