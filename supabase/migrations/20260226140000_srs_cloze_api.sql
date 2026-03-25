-- SRS API for cloze UX: get_daily_queue returns definition; record_review drops p_correct, derives correct from grade.

CREATE OR REPLACE FUNCTION public.get_daily_queue(p_lang text, p_new_limit int, p_review_limit int)
RETURNS TABLE (
  word_id uuid,
  lemma text,
  rank int,
  kind text,
  surface text,
  pos text,
  extra jsonb,
  definition text
)
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
  RETURN QUERY
  (SELECT w.id AS word_id, w.lemma, w.rank, 'review'::text AS kind, w.surface, w.pos, w.extra, (w.extra->>'definition')::text AS definition
   FROM public.user_words uw
   JOIN public.words w ON w.id = uw.word_id
   WHERE uw.user_id = v_uid AND uw.due_at <= now() AND w.lang = p_lang
   ORDER BY uw.due_at ASC
   LIMIT p_review_limit)
  UNION ALL
  (SELECT w.id AS word_id, w.lemma, w.rank, 'new'::text AS kind, w.surface, w.pos, w.extra, (w.extra->>'definition')::text AS definition
   FROM public.words w
   WHERE w.lang = p_lang
     AND NOT EXISTS (SELECT 1 FROM public.user_words uw WHERE uw.user_id = v_uid AND uw.word_id = w.id)
   ORDER BY w.rank ASC
   LIMIT p_new_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_review(
  p_word_id uuid,
  p_grade text,
  p_ms_spent int,
  p_user_answer text,
  p_expected text[]
)
RETURNS TABLE (
  user_id uuid,
  word_id uuid,
  status text,
  half_life_hours numeric,
  target_p numeric,
  last_review_at timestamptz,
  due_at timestamptz,
  reps int,
  lapses int,
  ewma_surprise numeric,
  ewma_abs_surprise numeric,
  ewma_accuracy numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.user_words%ROWTYPE;
  v_delta_hours numeric;
  v_p_pred numeric;
  v_r numeric;
  v_correct boolean;
  v_grade_factor numeric;
  v_surprise numeric;
  v_eta numeric;
  v_hl_new numeric;
  v_interval_hours numeric;
  v_min_hl numeric := 0.25;
  v_max_hl numeric := 17520;
  v_base_eta numeric := 0.4;
  v_k numeric := 0.2;
  v_eta_min numeric := 0.1;
  v_eta_max numeric := 1.0;
  v_alpha numeric := 0.3;
  v_hl_before numeric;
BEGIN
  IF v_uid IS NULL OR p_grade NOT IN ('again', 'hard', 'good', 'easy') THEN
    RETURN;
  END IF;
  v_correct := (p_grade <> 'again');

  PERFORM * FROM public.upsert_user_word(p_word_id, NULL);
  SELECT * INTO v_row FROM public.user_words WHERE user_words.user_id = v_uid AND user_words.word_id = p_word_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_hl_before := v_row.half_life_hours;
  IF v_row.last_review_at IS NULL THEN
    v_delta_hours := 0.1;
  ELSE
    v_delta_hours := EXTRACT(epoch FROM (now() - v_row.last_review_at)) / 3600.0;
  END IF;
  v_p_pred := power(2, -v_delta_hours / NULLIF(v_row.half_life_hours, 0));
  v_p_pred := GREATEST(LEAST(v_p_pred, 1), 0);

  v_r := CASE WHEN v_correct THEN 1.0 ELSE 0.0 END;
  v_grade_factor := CASE p_grade WHEN 'again' THEN 0.6 WHEN 'hard' THEN 0.85 WHEN 'good' THEN 1.0 WHEN 'easy' THEN 1.15 ELSE 1.0 END;
  v_surprise := v_r - v_p_pred;

  v_row.ewma_surprise := v_row.ewma_surprise * (1 - v_alpha) + v_surprise * v_alpha;
  v_row.ewma_abs_surprise := v_row.ewma_abs_surprise * (1 - v_alpha) + abs(v_surprise) * v_alpha;
  v_row.ewma_accuracy := v_row.ewma_accuracy * (1 - v_alpha) + v_r * v_alpha;

  v_eta := v_base_eta + v_k * v_row.ewma_abs_surprise;
  v_eta := GREATEST(v_eta_min, LEAST(v_eta_max, v_eta));
  v_hl_new := v_row.half_life_hours * exp(v_eta * (v_r - v_p_pred) * v_grade_factor);
  v_hl_new := GREATEST(v_min_hl, LEAST(v_max_hl, v_hl_new));

  v_row.half_life_hours := v_hl_new;
  v_row.last_review_at := now();

  IF v_correct THEN
    v_row.reps := v_row.reps + 1;
    v_interval_hours := v_hl_new * ln(1.0 / v_row.target_p) / ln(2);
    v_row.due_at := now() + (v_interval_hours || ' hours')::interval;
  ELSE
    v_row.lapses := v_row.lapses + 1;
    v_row.due_at := now() + interval '10 minutes';
  END IF;

  UPDATE public.user_words SET
    half_life_hours = v_row.half_life_hours,
    target_p = v_row.target_p,
    last_review_at = v_row.last_review_at,
    due_at = v_row.due_at,
    reps = v_row.reps,
    lapses = v_row.lapses,
    ewma_surprise = v_row.ewma_surprise,
    ewma_abs_surprise = v_row.ewma_abs_surprise,
    ewma_accuracy = v_row.ewma_accuracy
  WHERE user_words.user_id = v_uid AND user_words.word_id = p_word_id;

  INSERT INTO public.review_events (user_id, word_id, grade, correct, ms_spent, user_answer, expected, p_pred, delta_hours, half_life_before, half_life_after)
  VALUES (v_uid, p_word_id, p_grade, v_correct, p_ms_spent, COALESCE(p_user_answer, ''), COALESCE(p_expected, '{}'), v_p_pred, v_delta_hours, v_hl_before, v_hl_new);

  RETURN QUERY SELECT uw.user_id, uw.word_id, uw.status, uw.half_life_hours, uw.target_p, uw.last_review_at, uw.due_at, uw.reps, uw.lapses, uw.ewma_surprise, uw.ewma_abs_surprise, uw.ewma_accuracy
    FROM public.user_words uw WHERE uw.user_id = v_uid AND uw.word_id = p_word_id;
END;
$$;

-- Tell PostgREST to reload the schema so the new/updated RPCs are visible to the API
NOTIFY pgrst, 'reload schema';
