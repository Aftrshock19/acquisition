-- Corrective migration: move imported passages from reading_passages
-- into the canonical texts table and relink reading_questions.
--
-- Safe to run whether reading_passages has data or is empty.
-- The previous migration (20260410170000) created reading_passages and
-- reading_questions; this migration merges that data into texts and drops
-- the parallel tables.

-- ──────────────────────────────────────────────────────────
-- 1. Add passage metadata columns to texts
-- ──────────────────────────────────────────────────────────

ALTER TABLE public.texts
  ADD COLUMN IF NOT EXISTS stage          text,
  ADD COLUMN IF NOT EXISTS stage_index    smallint,
  ADD COLUMN IF NOT EXISTS display_label  text,
  ADD COLUMN IF NOT EXISTS passage_mode   text,
  ADD COLUMN IF NOT EXISTS passage_number smallint;

-- Unique constraint for idempotent passage imports.
-- NULLs are treated as distinct in Postgres UNIQUE, so existing
-- non-passage texts (stage IS NULL) are unaffected.
ALTER TABLE public.texts
  DROP CONSTRAINT IF EXISTS texts_passage_identity_unique;

ALTER TABLE public.texts
  ADD CONSTRAINT texts_passage_identity_unique
  UNIQUE (stage, passage_mode, passage_number);

-- ──────────────────────────────────────────────────────────
-- 2. Create one text_collection per stage from reading_passages
-- ──────────────────────────────────────────────────────────

INSERT INTO public.text_collections (title, lang, description, collection_type)
SELECT DISTINCT
  'Stage ' || rp.stage_index || ': ' || rp.display_label,
  'es',
  'Graded reading passages at ' || rp.display_label || ' level',
  'graded_passages'
FROM public.reading_passages rp
WHERE NOT EXISTS (
  SELECT 1 FROM public.text_collections tc
  WHERE tc.title = 'Stage ' || rp.stage_index || ': ' || rp.display_label
    AND tc.lang = 'es'
);

-- ──────────────────────────────────────────────────────────
-- 3. Backfill reading_passages rows into texts
--    difficulty_cefr = broad band (strip trailing -/+)
--    display_label   = fine label as-is (A1-, B2+, etc.)
--    order_index     = mode_rank * 100 + passage_number
--      short=0, medium=1, long=2, very_long=3
-- ──────────────────────────────────────────────────────────

INSERT INTO public.texts (
  lang, title, content, collection_id, order_index,
  word_count, estimated_minutes, difficulty_cefr,
  stage, stage_index, display_label, passage_mode, passage_number
)
SELECT
  rp.lang,
  rp.title,
  rp.passage_text,
  tc.id,
  (CASE rp.mode
    WHEN 'short'     THEN 0
    WHEN 'medium'    THEN 1
    WHEN 'long'      THEN 2
    WHEN 'very_long' THEN 3
  END) * 100 + rp.passage_number,
  rp.word_count,
  GREATEST(1, CEIL(rp.word_count / 180.0))::integer,
  CASE
    WHEN rp.display_label = 'Pre-A1' THEN 'Pre-A1'
    ELSE regexp_replace(rp.display_label, '[-+]$', '')
  END,
  rp.stage,
  rp.stage_index,
  rp.display_label,
  rp.mode,
  rp.passage_number
FROM public.reading_passages rp
JOIN public.text_collections tc
  ON tc.title = 'Stage ' || rp.stage_index || ': ' || rp.display_label
  AND tc.lang = 'es'
WHERE NOT EXISTS (
  SELECT 1 FROM public.texts t
  WHERE t.stage = rp.stage
    AND t.passage_mode = rp.mode
    AND t.passage_number = rp.passage_number
);

-- ──────────────────────────────────────────────────────────
-- 4. Save old questions with the new text_id mapping
--    Join through reading_passages to match on (stage, mode, number).
-- ──────────────────────────────────────────────────────────

CREATE TEMP TABLE _migrated_questions AS
SELECT
  t.id AS text_id,
  rq.question_index,
  rq.question_type,
  rq.question_en,
  rq.options_en,
  rq.correct_option_index
FROM public.reading_questions rq
JOIN public.reading_passages rp ON rp.id = rq.passage_id
JOIN public.texts t
  ON t.stage = rp.stage
  AND t.passage_mode = rp.mode
  AND t.passage_number = rp.passage_number;

-- ──────────────────────────────────────────────────────────
-- 5. Drop old tables (reading_questions first due to FK)
-- ──────────────────────────────────────────────────────────

DROP TABLE public.reading_questions;
DROP TABLE public.reading_passages;

-- ──────────────────────────────────────────────────────────
-- 6. Create new reading_questions linked to texts.id
-- ──────────────────────────────────────────────────────────

CREATE TABLE public.reading_questions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text_id               uuid        NOT NULL
                        REFERENCES public.texts(id) ON DELETE CASCADE,
  question_index        smallint    NOT NULL,
  question_type         text        NOT NULL,
  question_en           text        NOT NULL,
  options_en            text[]      NOT NULL,
  correct_option_index  smallint    NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reading_questions_unique_per_text
    UNIQUE (text_id, question_index),

  CONSTRAINT reading_questions_type_valid
    CHECK (question_type IN ('gist', 'detail', 'inferential')),

  CONSTRAINT reading_questions_correct_index_valid
    CHECK (correct_option_index >= 0)
);

CREATE INDEX reading_questions_text_idx
  ON public.reading_questions (text_id, question_index);

-- Restore migrated questions
INSERT INTO public.reading_questions (
  text_id, question_index, question_type, question_en,
  options_en, correct_option_index
)
SELECT
  text_id, question_index, question_type, question_en,
  options_en, correct_option_index
FROM _migrated_questions;

DROP TABLE _migrated_questions;

-- ──────────────────────────────────────────────────────────
-- 7. RLS on new reading_questions
-- ──────────────────────────────────────────────────────────

ALTER TABLE public.reading_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read reading_questions"
ON public.reading_questions
FOR SELECT
USING (true);

NOTIFY pgrst, 'reload schema';
