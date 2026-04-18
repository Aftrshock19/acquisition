ALTER TABLE public.reading_questions
  DROP CONSTRAINT IF EXISTS reading_questions_type_valid;

ALTER TABLE public.reading_questions
  ADD CONSTRAINT reading_questions_type_valid
  CHECK (question_type IN ('gist', 'detail', 'inferential', 'attitude', 'vocabulary'));
