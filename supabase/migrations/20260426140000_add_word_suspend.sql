-- Soft suspend for individual user words.
-- ---------------------------------------------------------------------------
-- The `user_words.status` CHECK constraint already permits 'suspended' (added
-- in 20260226120000_srs.sql), but no code path read or wrote the value. This
-- migration finishes the wiring:
--
--   1. Add `suspended_at` and `suspended_reason` columns so the suspend
--      decision is dated and (optionally) attributed.
--   2. Replace `get_daily_queue` so its review branch excludes suspended
--      rows. The new-word branch is unchanged: it already excludes any
--      existing user_words row via NOT EXISTS, which is the correct
--      semantic for suspended words too (they must NOT reappear as new).
--
-- Not touched: srs_state (scheduler private state), pick_new_words_near_frontier,
-- pick_user_driven_fallback, record_review (the application action layer
-- handles the stale-tab race; see app/actions/srs.ts:recordReview).
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_words
  ADD COLUMN IF NOT EXISTS suspended_at      timestamptz NULL,
  ADD COLUMN IF NOT EXISTS suspended_reason  text        NULL;

ALTER TABLE public.user_words
  DROP CONSTRAINT IF EXISTS user_words_suspended_reason_check;

ALTER TABLE public.user_words
  ADD CONSTRAINT user_words_suspended_reason_check
    CHECK (
      suspended_reason IS NULL
      OR suspended_reason IN (
        'already_known',
        'not_useful',
        'incorrect',
        'do_not_want',
        'other'
      )
    );

-- ---------------------------------------------------------------------------
-- Replace get_daily_queue. Identical to 20260419120000_fix_review_eligibility.sql
-- except for one added clause in the review branch:
--   AND COALESCE(uw.status, 'new') <> 'suspended'
-- The new-word branch and ordering are unchanged.
-- ---------------------------------------------------------------------------

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
      COALESCE(w.translation, d.translation, d.definition_en, d.definition_es) AS definition
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
