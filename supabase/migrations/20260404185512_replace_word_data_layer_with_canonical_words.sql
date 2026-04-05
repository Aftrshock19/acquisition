CREATE OR REPLACE FUNCTION public.normalize_word_pos(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR btrim(p_value) = '' THEN 'other'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) IN ('article', 'art') THEN 'art'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) IN ('determiner', 'det') THEN 'det'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) IN ('pronoun', 'pron') THEN 'pron'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) IN ('preposition', 'prep') THEN 'prep'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) IN ('conjunction', 'conj') THEN 'conj'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) IN ('adverb', 'adv') THEN 'adv'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) IN ('verb', 'v') THEN 'verb'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) IN ('noun', 'n') THEN 'noun'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) IN ('adjective', 'adj') THEN 'adj'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) IN ('interjection', 'intj') THEN 'intj'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) IN ('number', 'numeral', 'num') THEN 'num'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) IN ('proper noun', 'prop') THEN 'prop'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) = 'phrase' THEN 'phrase'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) = 'contraction' THEN 'contraction'
    WHEN lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g')) = 'none' THEN 'other'
    ELSE lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g'))
  END;
$$;

DROP TABLE IF EXISTS public.stg_words_spa;

CREATE TABLE IF NOT EXISTS public.words_import_raw (
  rank integer,
  lemma text,
  original_lemma text,
  translation text,
  definitions text,
  english_definition text,
  pos text,
  sentence text,
  english_sentence text
);

DO $$
BEGIN
  IF to_regclass('public.words') IS NULL THEN
    CREATE TABLE public.words (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rank integer NOT NULL,
      lemma text NOT NULL,
      original_lemma text NOT NULL,
      translation text,
      definition_es text,
      definition_en text,
      pos text NOT NULL,
      example_sentence text,
      example_sentence_en text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  ELSE
    ALTER TABLE public.words
      ADD COLUMN IF NOT EXISTS id uuid,
      ADD COLUMN IF NOT EXISTS rank integer,
      ADD COLUMN IF NOT EXISTS lemma text,
      ADD COLUMN IF NOT EXISTS original_lemma text,
      ADD COLUMN IF NOT EXISTS translation text,
      ADD COLUMN IF NOT EXISTS definition_es text,
      ADD COLUMN IF NOT EXISTS definition_en text,
      ADD COLUMN IF NOT EXISTS pos text,
      ADD COLUMN IF NOT EXISTS example_sentence text,
      ADD COLUMN IF NOT EXISTS example_sentence_en text,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

    UPDATE public.words
    SET id = COALESCE(id, gen_random_uuid())
    WHERE id IS NULL;

    UPDATE public.words
    SET original_lemma = COALESCE(NULLIF(original_lemma, ''), NULLIF(lemma, ''))
    WHERE original_lemma IS NULL OR btrim(original_lemma) = '';

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'words' AND column_name = 'definition'
    ) THEN
      EXECUTE $sql$
        UPDATE public.words
        SET translation = COALESCE(NULLIF(translation, ''), NULLIF(definition, '')),
            definition_en = COALESCE(NULLIF(definition_en, ''), NULLIF(definition, ''))
        WHERE translation IS NULL
           OR definition_en IS NULL
      $sql$;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'words' AND column_name = 'extra'
    ) THEN
      EXECUTE $sql$
        UPDATE public.words
        SET translation = COALESCE(
              NULLIF(translation, ''),
              NULLIF(extra ->> 'translation', ''),
              NULLIF(extra ->> 'definition', '')
            ),
            definition_en = COALESCE(
              NULLIF(definition_en, ''),
              NULLIF(extra ->> 'definition_en', ''),
              NULLIF(extra ->> 'definition', '')
            ),
            definition_es = COALESCE(
              NULLIF(definition_es, ''),
              NULLIF(extra ->> 'definition_es', '')
            ),
            example_sentence = COALESCE(
              NULLIF(example_sentence, ''),
              NULLIF(extra ->> 'example_sentence', ''),
              NULLIF(extra ->> 'sentence', '')
            ),
            example_sentence_en = COALESCE(
              NULLIF(example_sentence_en, ''),
              NULLIF(extra ->> 'example_sentence_en', ''),
              NULLIF(extra ->> 'example_translation', ''),
              NULLIF(extra ->> 'translation', '')
            )
      $sql$;
    END IF;

    UPDATE public.words
    SET pos = public.normalize_word_pos(pos)
    WHERE pos IS NOT NULL;

    UPDATE public.words
    SET original_lemma = lemma
    WHERE original_lemma IS NULL OR btrim(original_lemma) = '';

    UPDATE public.words
    SET pos = 'other'
    WHERE pos IS NULL OR btrim(pos) = '';

    UPDATE public.words
    SET created_at = now()
    WHERE created_at IS NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'words' AND column_name = 'lang'
  ) THEN
    IF to_regclass('public.user_words') IS NOT NULL THEN
      EXECUTE $sql$
        WITH ranked AS (
          SELECT
            id,
            rank,
            row_number() OVER (
              PARTITION BY rank
              ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
            ) AS rn,
            first_value(id) OVER (
              PARTITION BY rank
              ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
            ) AS keep_id
          FROM public.words
          WHERE rank IS NOT NULL
        ),
        duplicates AS (
          SELECT id AS old_id, keep_id
          FROM ranked
          WHERE rn > 1
        )
        DELETE FROM public.user_words uw
        USING duplicates d
        WHERE uw.word_id = d.old_id
          AND EXISTS (
            SELECT 1
            FROM public.user_words uw_keep
            WHERE uw_keep.user_id = uw.user_id
              AND uw_keep.word_id = d.keep_id
          )
      $sql$;
    END IF;

    IF to_regclass('public.user_deck_words') IS NOT NULL THEN
      EXECUTE $sql$
        WITH ranked AS (
          SELECT
            id,
            rank,
            row_number() OVER (
              PARTITION BY rank
              ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
            ) AS rn,
            first_value(id) OVER (
              PARTITION BY rank
              ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
            ) AS keep_id
          FROM public.words
          WHERE rank IS NOT NULL
        ),
        duplicates AS (
          SELECT id AS old_id, keep_id
          FROM ranked
          WHERE rn > 1
        )
        DELETE FROM public.user_deck_words udw
        USING duplicates d
        WHERE udw.word_id = d.old_id
          AND EXISTS (
            SELECT 1
            FROM public.user_deck_words udw_keep
            WHERE udw_keep.user_id = udw.user_id
              AND udw_keep.deck_id = udw.deck_id
              AND udw_keep.word_id = d.keep_id
          )
      $sql$;
    END IF;

    IF to_regclass('public.user_words') IS NOT NULL THEN
      EXECUTE $sql$
        WITH ranked AS (
          SELECT
            id,
            rank,
            row_number() OVER (
              PARTITION BY rank
              ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
            ) AS rn,
            first_value(id) OVER (
              PARTITION BY rank
              ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
            ) AS keep_id
          FROM public.words
          WHERE rank IS NOT NULL
        ),
        duplicates AS (
          SELECT id AS old_id, keep_id
          FROM ranked
          WHERE rn > 1
        )
        UPDATE public.user_words uw
        SET word_id = d.keep_id
        FROM duplicates d
        WHERE uw.word_id = d.old_id
      $sql$;
    END IF;

    IF to_regclass('public.review_events') IS NOT NULL THEN
      EXECUTE $sql$
        WITH ranked AS (
          SELECT
            id,
            rank,
            row_number() OVER (
              PARTITION BY rank
              ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
            ) AS rn,
            first_value(id) OVER (
              PARTITION BY rank
              ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
            ) AS keep_id
          FROM public.words
          WHERE rank IS NOT NULL
        ),
        duplicates AS (
          SELECT id AS old_id, keep_id
          FROM ranked
          WHERE rn > 1
        )
        UPDATE public.review_events re
        SET word_id = d.keep_id
        FROM duplicates d
        WHERE re.word_id = d.old_id
      $sql$;
    END IF;

    IF to_regclass('public.exposure_events') IS NOT NULL THEN
      EXECUTE $sql$
        WITH ranked AS (
          SELECT
            id,
            rank,
            row_number() OVER (
              PARTITION BY rank
              ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
            ) AS rn,
            first_value(id) OVER (
              PARTITION BY rank
              ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
            ) AS keep_id
          FROM public.words
          WHERE rank IS NOT NULL
        ),
        duplicates AS (
          SELECT id AS old_id, keep_id
          FROM ranked
          WHERE rn > 1
        )
        UPDATE public.exposure_events ee
        SET word_id = d.keep_id
        FROM duplicates d
        WHERE ee.word_id = d.old_id
      $sql$;
    END IF;

    IF to_regclass('public.user_deck_words') IS NOT NULL THEN
      EXECUTE $sql$
        WITH ranked AS (
          SELECT
            id,
            rank,
            row_number() OVER (
              PARTITION BY rank
              ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
            ) AS rn,
            first_value(id) OVER (
              PARTITION BY rank
              ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
            ) AS keep_id
          FROM public.words
          WHERE rank IS NOT NULL
        ),
        duplicates AS (
          SELECT id AS old_id, keep_id
          FROM ranked
          WHERE rn > 1
        )
        UPDATE public.user_deck_words udw
        SET word_id = d.keep_id
        FROM duplicates d
        WHERE udw.word_id = d.old_id
      $sql$;
    END IF;

    EXECUTE $sql$
      WITH ranked AS (
        SELECT
          id,
          rank,
          row_number() OVER (
            PARTITION BY rank
            ORDER BY CASE WHEN lang = 'es' THEN 0 ELSE 1 END, created_at NULLS LAST, id
          ) AS rn
        FROM public.words
        WHERE rank IS NOT NULL
      )
      DELETE FROM public.words w
      USING ranked r
      WHERE w.id = r.id
        AND r.rn > 1
    $sql$;
  END IF;
END
$$;

ALTER TABLE public.words
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN rank SET NOT NULL,
  ALTER COLUMN lemma SET NOT NULL,
  ALTER COLUMN original_lemma SET NOT NULL,
  ALTER COLUMN pos SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

DROP TRIGGER IF EXISTS words_updated_at ON public.words;
DROP INDEX IF EXISTS public.words_lang_lemma_unique;
DROP INDEX IF EXISTS public.words_lang_rank;

ALTER TABLE public.words
  DROP CONSTRAINT IF EXISTS words_lang_rank_unique;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'words_rank_positive'
      AND conrelid = 'public.words'::regclass
  ) THEN
    ALTER TABLE public.words
      ADD CONSTRAINT words_rank_positive CHECK (rank > 0);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'words_rank_unique'
      AND conrelid = 'public.words'::regclass
  ) THEN
    ALTER TABLE public.words
      ADD CONSTRAINT words_rank_unique UNIQUE (rank);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS words_lemma_idx
  ON public.words (lemma);

CREATE INDEX IF NOT EXISTS words_original_lemma_idx
  ON public.words (original_lemma);

CREATE INDEX IF NOT EXISTS words_pos_idx
  ON public.words (pos);

ALTER TABLE public.words
  DROP COLUMN IF EXISTS lang,
  DROP COLUMN IF EXISTS definition,
  DROP COLUMN IF EXISTS surface,
  DROP COLUMN IF EXISTS freq,
  DROP COLUMN IF EXISTS extra,
  DROP COLUMN IF EXISTS updated_at;

ALTER TABLE public.word_forms
  ADD COLUMN IF NOT EXISTS word_id uuid REFERENCES public.words(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS word_forms_word_id_idx
  ON public.word_forms (word_id);

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
      w.definition_es,
      w.definition_en,
      w.example_sentence,
      w.example_sentence_en,
      COALESCE(w.translation, w.definition_en, w.definition_es) AS definition
   FROM public.user_words uw
   JOIN public.words w ON w.id = uw.word_id
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
      w.definition_es,
      w.definition_en,
      w.example_sentence,
      w.example_sentence_en,
      COALESCE(w.translation, w.definition_en, w.definition_es) AS definition
   FROM public.words w
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

NOTIFY pgrst, 'reload schema';
