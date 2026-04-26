-- Near-frontier new-word picker, server-side.
-- ---------------------------------------------------------------------------
-- The JS picker previously fetched the entire [low, high] rank window into
-- the application and ran the seen / baseline / excluded exclusion in code.
-- That meant `.in("word_id", ids)` calls with thousands of UUIDs against
-- user_words and baseline_test_responses, and a paginated read of the words
-- table to get past PostgREST's 1000-row response cap. Both are brittle.
--
-- This RPC keeps the candidate pool inside Postgres. It mirrors the JS
-- reference policy in lib/placement/newWordPicker.ts:selectFromCandidates:
--
--   * primary  = words in [p_low, p_high]
--                  AND NOT EXISTS user_words for auth.uid()
--                  AND NOT (id = ANY p_exclude_word_ids)
--                  AND NOT EXISTS baseline_test_responses for auth.uid()
--   * relaxed  = same minus the baseline filter (baseline-tested rows
--                included). Used as a starvation backstop.
--   * combined = primary ∪ (relaxed \ primary), tagged with `pref` so primary
--                rows sort ahead of relaxed rows at equal distance.
--   * order    = pref ASC, abs(rank - p_target_rank) ASC, rank ASC.
--
-- Returns up to p_limit rows; capped at 1000 to stay within the API row cap
-- in case a caller passes an absurd limit.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pick_new_words_near_frontier(
  p_low               int,
  p_high              int,
  p_target_rank       int,
  p_exclude_word_ids  uuid[]  DEFAULT '{}',
  p_limit             int     DEFAULT 10
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
  IF v_uid IS NULL
     OR p_low IS NULL
     OR p_high IS NULL
     OR p_target_rank IS NULL
     OR p_low > p_high
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT
      w.id,
      w.rank,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM public.baseline_test_responses bt
          WHERE bt.user_id = v_uid AND bt.word_id = w.id
        )
        THEN 1   -- baseline-tested → only used if primary pool is short
        ELSE 0   -- primary
      END AS pref
    FROM public.words w
    WHERE w.rank BETWEEN p_low AND p_high
      AND NOT EXISTS (
        SELECT 1 FROM public.user_words uw
        WHERE uw.user_id = v_uid AND uw.word_id = w.id
      )
      AND NOT (w.id = ANY(p_exclude_word_ids))
  )
  SELECT e.id, e.rank
  FROM eligible e
  ORDER BY
    e.pref ASC,
    abs(e.rank - p_target_rank) ASC,
    e.rank ASC
  LIMIT GREATEST(0, LEAST(p_limit, 1000));
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.pick_new_words_near_frontier(int, int, int, uuid[], int)
  TO authenticated;
