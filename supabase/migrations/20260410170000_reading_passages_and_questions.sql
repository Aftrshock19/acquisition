-- Reading passages: graded reading content organized by stage and mode.
-- Each passage comes from the reading_passages/ JSON files and includes
-- vocabulary metadata and comprehension questions.

-- ────────────────────────────────────────────────────────────
-- 1. reading_passages
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reading_passages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lang            text        NOT NULL DEFAULT 'es',
  stage           text        NOT NULL,   -- 'stage_00' .. 'stage_30'
  stage_index     smallint    NOT NULL,   -- 0..30  (for sorting)
  display_label   text        NOT NULL,   -- 'Pre-A1', 'A1-', 'B2+', etc.
  mode            text        NOT NULL,   -- 'short' | 'medium' | 'long' | 'very_long'
  passage_number  smallint    NOT NULL,   -- 1-based ordinal within stage+mode
  title           text        NOT NULL,
  topic           text,
  scenario_seed   text,
  passage_text    text        NOT NULL,
  word_count      integer     NOT NULL DEFAULT 0,
  focus_words     text[]      NOT NULL DEFAULT '{}',
  stretch_words   text[]      NOT NULL DEFAULT '{}',
  extra_words     text[]      NOT NULL DEFAULT '{}',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reading_passages_unique_stage_mode_number
    UNIQUE (stage, mode, passage_number),

  CONSTRAINT reading_passages_stage_index_range
    CHECK (stage_index >= 0 AND stage_index <= 30),

  CONSTRAINT reading_passages_mode_valid
    CHECK (mode IN ('short', 'medium', 'long', 'very_long')),

  CONSTRAINT reading_passages_word_count_nonneg
    CHECK (word_count >= 0)
);

DROP TRIGGER IF EXISTS reading_passages_updated_at ON public.reading_passages;
CREATE TRIGGER reading_passages_updated_at
BEFORE UPDATE ON public.reading_passages
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS reading_passages_stage_mode_idx
  ON public.reading_passages (stage_index, mode, passage_number);

CREATE INDEX IF NOT EXISTS reading_passages_label_idx
  ON public.reading_passages (display_label);

-- ────────────────────────────────────────────────────────────
-- 2. reading_questions
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reading_questions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passage_id            uuid        NOT NULL
                        REFERENCES public.reading_passages(id) ON DELETE CASCADE,
  question_index        smallint    NOT NULL,   -- 1-based, matches JSON "id"
  question_type         text        NOT NULL,   -- 'gist' | 'detail'
  question_en           text        NOT NULL,
  options_en            text[]      NOT NULL,
  correct_option_index  smallint    NOT NULL,   -- 0-based index into options_en

  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reading_questions_unique_per_passage
    UNIQUE (passage_id, question_index),

  CONSTRAINT reading_questions_type_valid
    CHECK (question_type IN ('gist', 'detail', 'inferential')),

  CONSTRAINT reading_questions_correct_index_valid
    CHECK (correct_option_index >= 0)
);

CREATE INDEX IF NOT EXISTS reading_questions_passage_idx
  ON public.reading_questions (passage_id, question_index);

-- ────────────────────────────────────────────────────────────
-- 3. RLS policies — passages and questions are readable by all
--    authenticated users; writes are service-role only (import).
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.reading_passages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read reading_passages" ON public.reading_passages;
CREATE POLICY "Allow read reading_passages"
ON public.reading_passages
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Allow read reading_questions" ON public.reading_questions;
CREATE POLICY "Allow read reading_questions"
ON public.reading_questions
FOR SELECT
USING (true);

NOTIFY pgrst, 'reload schema';
