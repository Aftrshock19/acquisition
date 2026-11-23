-- MANUAL, NOT A MIGRATION. Never applied by `supabase db push` / CI.
-- ---------------------------------------------------------------------------
-- Backfill review_events.scheduler_outcome for rows written while the live
-- record_review did not store it (from 20260411140000_adaptive_scheduling_layer
-- until 20261102120000_daily_loop_completion_and_scheduler_outcome).
--
-- Only rows WHERE scheduler_outcome IS NULL are ever updated, and only when
-- the outcome can be derived exactly. Everything else stays NULL.
--
-- How to run (SQL editor, as the project owner):
--   1. Run STEP 1 on its own and review the counts and the unresolved rows.
--   2. Run STEP 2. It ends in ROLLBACK; change that to COMMIT only once the
--      verification counts match STEP 1.
--
-- Derivation (TS mirror + tests: lib/srs/schedulerOutcome.ts). The 18-param
-- record_review writes difficulty_before / difficulty_after /
-- baseline_interval_days in the same transaction as the branch it took, and
-- each branch moves difficulty by its own rule:
--
--   incorrect_lapse       correct=false             after = LEAST(0.95, d + 0.08)
--   rescued_success       correct, first_try=false  after = GREATEST(0.20, d - 0.01)
--   first_clean_success   correct, first_try        after = GREATEST(0.30, d - 0.08), baseline = 2
--   second_clean_success  correct, first_try        after = GREATEST(0.20, d - 0.05), baseline >= 6
--   later_clean_review    correct, first_try        after = GREATEST(0.15, d - 0.02)
--
-- Clean rules coincide only at d = 0.35 (first|second: baseline 2 vs >= 6),
-- d = 0.32 (first|later: later can never store exactly 2, because
-- s * 2.344 = 2 or s * 2.494 = 2 has no finite numeric solution and s = 1
-- gives 2.344) and d = 0.22 (second|later). For d = 0.22 with baseline >= 6
-- the word's two preceding events decide it: second_clean_success needs
-- consecutive_first_try_correct = 1 AND last_was_first_try beforehand, i.e.
-- previous event clean and the one before it not clean. Both must have been
-- written by a v2 scheduler (difficulty_before or scheduler_outcome set),
-- otherwise the row stays NULL. Arithmetic is exact numeric throughout.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- STEP 1: DRY RUN (read-only; the temp view disappears with the session)
-- ===========================================================================

CREATE OR REPLACE TEMP VIEW scheduler_outcome_backfill_preview AS
WITH row_level AS (
  SELECT
    re.id,
    re.user_id,
    re.word_id,
    re.created_at,
    re.submitted_at,
    re.scheduler_outcome,
    CASE
      WHEN re.difficulty_before IS NULL
        OR re.difficulty_after IS NULL
        OR re.baseline_interval_days IS NULL
        OR re.correct IS NULL
        OR re.first_try IS NULL
        THEN NULL
      WHEN NOT re.correct THEN
        CASE WHEN re.difficulty_after = LEAST(0.95, re.difficulty_before + 0.08)
             THEN 'incorrect_lapse' END
      WHEN NOT re.first_try THEN
        CASE WHEN re.difficulty_after = GREATEST(0.20, re.difficulty_before - 0.01)
             THEN 'rescued_success' END
      WHEN re.difficulty_after = GREATEST(0.30, re.difficulty_before - 0.08)
           AND re.baseline_interval_days = 2
        THEN 'first_clean_success'
      WHEN re.difficulty_after = GREATEST(0.20, re.difficulty_before - 0.05)
           AND re.baseline_interval_days >= 6
           AND re.difficulty_after = GREATEST(0.15, re.difficulty_before - 0.02)
        THEN 'second_or_later'
      WHEN re.difficulty_after = GREATEST(0.20, re.difficulty_before - 0.05)
           AND re.baseline_interval_days >= 6
        THEN 'second_clean_success'
      WHEN re.difficulty_after = GREATEST(0.15, re.difficulty_before - 0.02)
        THEN 'later_clean_review'
      ELSE NULL
    END AS row_level_outcome
  FROM public.review_events re
),
classified AS (
  SELECT
    r.*,
    CASE
      WHEN r.scheduler_outcome IN ('first_clean_success', 'second_clean_success', 'later_clean_review')
        THEN 'clean'
      WHEN r.scheduler_outcome IN ('rescued_success', 'incorrect_lapse')
        THEN 'not_clean'
      WHEN r.row_level_outcome IN ('first_clean_success', 'second_clean_success', 'later_clean_review', 'second_or_later')
        THEN 'clean'
      WHEN r.row_level_outcome IN ('rescued_success', 'incorrect_lapse')
        THEN 'not_clean'
      ELSE 'unknown'
    END AS path_class
  FROM row_level r
),
with_history AS (
  SELECT
    c.*,
    LAG(c.path_class, 1) OVER w AS prev_class,
    LAG(c.path_class, 2) OVER w AS prev2_class
  FROM classified c
  WINDOW w AS (
    PARTITION BY c.user_id, c.word_id
    ORDER BY c.created_at, c.submitted_at NULLS FIRST, c.id
  )
)
SELECT
  h.id,
  h.user_id,
  h.word_id,
  h.created_at,
  h.scheduler_outcome,
  h.row_level_outcome,
  h.prev_class,
  h.prev2_class,
  CASE
    WHEN h.row_level_outcome IS DISTINCT FROM 'second_or_later' THEN h.row_level_outcome
    WHEN h.prev_class = 'not_clean' THEN 'later_clean_review'
    WHEN h.prev_class = 'clean' AND h.prev2_class = 'not_clean' THEN 'second_clean_success'
    WHEN h.prev_class = 'clean' AND h.prev2_class = 'clean' THEN 'later_clean_review'
    ELSE NULL
  END AS derived_outcome
FROM with_history h;

-- 1a. What would be written, and what stays NULL (and why).
SELECT
  CASE
    WHEN derived_outcome IS NOT NULL THEN derived_outcome
    WHEN row_level_outcome IS NULL THEN '(stays NULL: not written by the 18-param RPC, or columns contradict every branch)'
    ELSE '(stays NULL: second vs later undecidable from history)'
  END AS backfill_result,
  count(*) AS row_count,
  min(created_at) AS first_created_at,
  max(created_at) AS last_created_at
FROM scheduler_outcome_backfill_preview
WHERE scheduler_outcome IS NULL
GROUP BY 1
ORDER BY 2 DESC;

-- 1b. Sanity check on rows that already have a stored outcome (written by the
--     20260410160002 RPC or by the post-fix RPC): the derivation should agree
--     wherever it applies. Expect zero mismatches.
SELECT scheduler_outcome, derived_outcome, count(*) AS row_count
FROM scheduler_outcome_backfill_preview
WHERE scheduler_outcome IS NOT NULL
  AND derived_outcome IS NOT NULL
  AND derived_outcome <> scheduler_outcome
GROUP BY 1, 2;

-- 1c. Live-era rows that will stay NULL, for manual inspection.
SELECT p.id, p.user_id, p.word_id, p.created_at, p.row_level_outcome,
       p.prev_class, p.prev2_class,
       re.correct, re.first_try, re.difficulty_before, re.difficulty_after,
       re.baseline_interval_days
FROM scheduler_outcome_backfill_preview p
JOIN public.review_events re ON re.id = p.id
WHERE p.scheduler_outcome IS NULL
  AND p.derived_outcome IS NULL
  AND re.difficulty_before IS NOT NULL
ORDER BY p.created_at
LIMIT 200;


-- ===========================================================================
-- STEP 2: WRITE (review STEP 1 first). Safe by default: ends in ROLLBACK.
-- ===========================================================================

BEGIN;

-- Returns per-outcome counts of the rows actually updated; they must equal
-- the non-NULL rows of STEP 1a.
WITH updated AS (
  UPDATE public.review_events re
  SET scheduler_outcome = p.derived_outcome
  FROM scheduler_outcome_backfill_preview p
  WHERE re.id = p.id
    AND re.scheduler_outcome IS NULL
    AND p.derived_outcome IS NOT NULL
  RETURNING re.scheduler_outcome
)
SELECT scheduler_outcome, count(*) AS row_count
FROM updated
GROUP BY 1
ORDER BY 2 DESC;

ROLLBACK;  -- change to COMMIT once the counts above match STEP 1a
