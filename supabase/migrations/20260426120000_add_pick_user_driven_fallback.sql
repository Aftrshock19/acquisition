-- Explicit user-driven fallback for the daily queue.
-- ---------------------------------------------------------------------------
-- When the user has explicitly asked for more cards (manual mode, override,
-- or extended past the recommended target) and pickNewWordsNearFrontier
-- exhausts its rank window, the application must not silently fall back to
-- the rank-ASC list produced by get_daily_queue (which serves rank-1 beginner
-- words to a learner whose frontier may be in the thousands).
--
-- Instead it calls this RPC to walk the entire bank ordered by absolute
-- distance to the user's current frontier rank and return the closest
-- unseen, non-excluded words. Ordering and exclusion are both done in
-- Postgres so the API max-row cap (1000) does not truncate the candidate
-- pool before the distance sort runs.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pick_user_driven_fallback(
  p_frontier_rank      int,
  p_exclude_word_ids   uuid[]  DEFAULT '{}',
  p_limit              int     DEFAULT 10
)
RETURNS TABLE (
  id    uuid,
  rank  int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_frontier_rank IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT w.id, w.rank
  FROM public.words w
  WHERE NOT EXISTS (
      SELECT 1 FROM public.user_words uw
      WHERE uw.user_id = v_uid AND uw.word_id = w.id
    )
    AND NOT (w.id = ANY(p_exclude_word_ids))
  ORDER BY abs(w.rank - p_frontier_rank) ASC, w.rank ASC
  LIMIT GREATEST(0, LEAST(p_limit, 1000));
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.pick_user_driven_fallback(int, uuid[], int)
  TO authenticated;
