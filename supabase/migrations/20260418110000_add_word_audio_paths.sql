-- Add word-level audio path fields for Chirp-generated lemma and sentence audio.
--
-- Storage convention:
--   audio/es-ES/words/<word_id>/lemma.mp3
--   audio/es-ES/words/<word_id>/lemma-sentence.mp3

ALTER TABLE public.words
  ADD COLUMN IF NOT EXISTS lemma_audio_path text,
  ADD COLUMN IF NOT EXISTS lemma_sentence_audio_path text;

NOTIFY pgrst, 'reload schema';
