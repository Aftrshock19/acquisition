-- Restore public.upsert_user_word, which several record_review overloads
-- (including the adaptive 18-arg variant) PERFORM as a guard before reading
-- the user_words row. The function was missing on remote, causing every
-- record_review call to fail with 42883.

CREATE OR REPLACE FUNCTION public.upsert_user_word(p_word_id uuid, p_lang text DEFAULT NULL)
RETURNS SETOF public.user_words
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.user_words (user_id, word_id)
  VALUES (v_uid, p_word_id)
  ON CONFLICT (user_id, word_id) DO NOTHING;

  RETURN QUERY
    SELECT * FROM public.user_words
    WHERE user_id = v_uid AND word_id = p_word_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_user_word(uuid, text) TO authenticated;
