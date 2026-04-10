-- Workload policy: priority-ordered reviews + p_exclude_word_ids for continuation
-- ---------------------------------------------------------------------------
-- Replaces get_daily_queue with a version that:
--   1. Orders due reviews by forgetting-risk priority score (highest first).
--   2. Accepts p_exclude_word_ids to skip already-seen words in continuation calls.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_daily_queue(text, integer, integer);
DROP FUNCTION IF EXISTS public.get_daily_queue(text, integer, integer, uuid[]);

CREATE OR REPLACE FUNCTION public.get_daily_queue(
  p_lang              text,
  p_new_limit         int,
  p_review_limit      int,
  p_exclude_word_ids  uuid[]  DEFAULT '{}'
)
RETURNS TABLE (
  word_id             uuid,
  lemma               text,
  rank                int,
  kind                text,
  pos                 text,
  translation         text,
  definition_es       text,
  definition_en       text,
  example_sentence    text,
  example_sentence_en text,
  definition          text
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
  -- Due reviews: priority-ordered by forgetting risk score
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
      COALESCE(w.translation, d.translation, d.definition_en, d.definition_es) AS definition
   FROM public.user_words uw
   JOIN public.words      w  ON w.id = uw.word_id
   LEFT JOIN public.definitions d ON d.id = w.id
   WHERE uw.user_id = v_uid
     AND uw.next_due <= now()
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

  -- New words: lowest rank first (most frequent / foundational)
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
      COALESCE(w.translation, d.translation, d.definition_en, d.definition_es) AS definition
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
