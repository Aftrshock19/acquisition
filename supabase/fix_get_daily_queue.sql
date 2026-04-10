-- Hotfix: restore correct get_daily_queue signature (uses next_due, not due_at)
DROP FUNCTION IF EXISTS public.get_daily_queue(text, integer, integer);
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
     AND uw.next_due <= now()
   ORDER BY uw.next_due ASC
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
       SELECT 1 FROM public.user_words uw
       WHERE uw.user_id = v_uid AND uw.word_id = w.id
     )
   ORDER BY w.rank ASC
   LIMIT p_new_limit);
END;
$$;

NOTIFY pgrst, 'reload schema';
