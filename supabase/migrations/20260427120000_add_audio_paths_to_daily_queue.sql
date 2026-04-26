-- Surface per-word audio paths through the daily queue RPC.
--
-- The `words` table already carries `lemma_audio_path` and
-- `lemma_sentence_audio_path` (see 20260418110000_add_word_audio_paths.sql),
-- pointing at storage objects under the `listening-audio` bucket. Until now
-- the RPC dropped those columns, so the SRS audio flashcard had no real audio
-- URL to play and fell back to browser TTS of the example sentence. Add the
-- two columns to the RETURNS TABLE and to both branches (review + new-word)
-- so the client can build the public storage URL.
--
-- Identical to 20260426140000_add_word_suspend.sql except for the two new
-- selected columns.
--
-- The RETURNS TABLE shape changes, so CREATE OR REPLACE is rejected
-- (SQLSTATE 42P13). Drop both historical signatures first, mirroring the
-- pattern in 20260410160003_workload_policy.sql.

DROP FUNCTION IF EXISTS public.get_daily_queue(text, integer, integer);
DROP FUNCTION IF EXISTS public.get_daily_queue(text, integer, integer, uuid[]);

CREATE OR REPLACE FUNCTION public.get_daily_queue(
  p_lang              text,
  p_new_limit         int,
  p_review_limit      int,
  p_exclude_word_ids  uuid[]  DEFAULT '{}'
)
RETURNS TABLE (
  word_id                   uuid,
  lemma                     text,
  rank                      int,
  kind                      text,
  pos                       text,
  translation               text,
  definition_es             text,
  definition_en             text,
  example_sentence          text,
  example_sentence_en       text,
  definition                text,
  lemma_audio_path          text,
  lemma_sentence_audio_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_lang text := COALESCE(NULLIF(trim(p_lang), ''), 'es');
BEGIN
  IF v_uid IS NULL OR v_lang <> 'es' THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- Due reviews: priority-ordered by forgetting risk score.
  -- Suspended rows are excluded; new-word selection still excludes them
  -- because they exist in user_words (NOT EXISTS guard).
  (SELECT
      w.id                                                                    AS word_id,
      w.lemma,
      w.rank,
      'review'::text                                                          AS kind,
      w.pos,
      w.translation,
      d.definition_es,
      d.definition_en,
      w.example_sentence,
      w.example_sentence_en,
      COALESCE(w.translation, d.translation, d.definition_en, d.definition_es) AS definition,
      w.lemma_audio_path,
      w.lemma_sentence_audio_path
   FROM public.user_words uw
   JOIN public.words      w  ON w.id = uw.word_id
   LEFT JOIN public.definitions d ON d.id = w.id
   WHERE uw.user_id = v_uid
     AND uw.next_due <= now()
     AND uw.last_review_at IS NOT NULL
     AND COALESCE(uw.status, 'new') <> 'suspended'
     AND NOT (uw.word_id = ANY(p_exclude_word_ids))
   ORDER BY (
     -- Forgetting-risk priority score (higher = show first)
     GREATEST(0, EXTRACT(epoch FROM (now() - uw.next_due)) / 86400.0)
       / GREATEST(1, uw.stability_days)
       * (0.75 + uw.difficulty)
       * CASE WHEN uw.srs_state = 'learning' THEN 1.35 ELSE 1.0 END
       + CASE WHEN uw.last_result   = 'incorrect'                             THEN 0.25 ELSE 0 END
       + CASE WHEN uw.last_was_first_try = false AND uw.last_result = 'correct' THEN 0.15 ELSE 0 END
   ) DESC,
   uw.word_id ASC
   LIMIT p_review_limit)

  UNION ALL

  -- New words: lowest rank first (most frequent / foundational).
  -- Unchanged from prior version: NOT EXISTS already covers suspended rows.
  (SELECT
      w.id                                                                    AS word_id,
      w.lemma,
      w.rank,
      'new'::text                                                             AS kind,
      w.pos,
      w.translation,
      d.definition_es,
      d.definition_en,
      w.example_sentence,
      w.example_sentence_en,
      COALESCE(w.translation, d.translation, d.definition_en, d.definition_es) AS definition,
      w.lemma_audio_path,
      w.lemma_sentence_audio_path
   FROM public.words w
   LEFT JOIN public.definitions d ON d.id = w.id
   WHERE NOT EXISTS (
       SELECT 1 FROM public.user_words uw2
       WHERE uw2.user_id = v_uid AND uw2.word_id = w.id
     )
     AND NOT (w.id = ANY(p_exclude_word_ids))
   ORDER BY w.rank ASC
   LIMIT p_new_limit);
END;
$$;

NOTIFY pgrst, 'reload schema';
