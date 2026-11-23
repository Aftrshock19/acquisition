-- Dose analysis export: one row per participant, same columns (and order) as
-- dose_analysis_export_v3.csv, rebuilt from the production tables.
--
-- READ-ONLY: a single WITH ... SELECT, no writes.  Run it in the Supabase SQL
-- editor (or psql), download the result as CSV, then compare with v3:
--
--   python analysis/build_results.py emit-sql dose_analysis_export_v3.csv
--       -> analysis/output/dose_analysis_export_filled.sql (this file with the
--          intervention windows filled in; run that one)
--   python analysis/build_results.py diff-dose <result.csv> dose_analysis_export_v3.csv
--
-- To rebuild the published tables with a different completion count, splice
-- only that column into v3 (the other columns here are best-effort, below):
--
--   python analysis/build_results.py build dose_analysis_export_v3.csv \
--       --completed-from <result.csv> --compare-dir public/results
--
-- sessions_completed uses the research loop_completed rule (contract B, as in
-- analysis/metrics.py and lib/analytics/service.ts isLoopCompleted):
--
--   loop_completed := completed_at IS NOT NULL
--                     OR (reading_done AND listening_done
--                         AND (flashcards_completed_at IS NOT NULL
--                              OR flashcard_attempts_count >= assigned_flashcard_count))
--
-- Three diagnostic columns are appended after the v3 columns so the diff shows
-- which definition v3 used: sessions_completed_raw_flag (completed = true),
-- sessions_completed_at_present (completed_at IS NOT NULL) and
-- days_with_started_session.
--
-- The v3 generator is not in the repository.  Columns other than
-- sessions_completed are a best reconstruction from the app's analytics
-- definitions (lib/analytics/service.ts) and may differ from v3; the diff
-- will show where.  Known/likely differences:
--   * new_cards_introduced: here, distinct words with a queue_kind='new'
--     review event in the window.  v3 reports 1 for P018 and P083, who have no
--     review events at all, which looks like a count(*) over an outer join.
--   * days_active: here, the app definition (a review event, a reader-saved
--     word, reading_done or listening_done on that date).  In v3 it equals
--     sessions_started for every participant; compare with
--     days_with_started_session.
--   * total_reading_time_minutes is blank for everyone in v3; here it is
--     sum(daily_sessions.reading_time_seconds) / 60.
--   * reading_passages_completed / listening_tracks_completed come from
--     reading_progress / listening_progress (completed_at in the window).  Those
--     rows are upserted on every completion and deleted on "undo", so they
--     count distinct texts as of now, not completion events.
--   * placement_*: completed baseline_test_runs, dated by completed_at in the
--     app time zone, ranked into substages with lib/recommendation/substages.ts.
--     "first" is the earliest run up to the window end; "last" is the latest
--     run inside the window.
--
-- Intervention windows are not stored in the database (they come from the
-- study schedule), so they are supplied in the `windows` list below.

WITH
params AS (
  SELECT
    'default'::text       AS cohort_key,
    'Europe/London'::text AS tz  -- APP_SESSION_TIME_ZONE (lib/analytics/date.ts)
),

windows (participant_id, intervention_start, intervention_end) AS (
  VALUES
    (NULL::text, NULL::date, NULL::date)  -- typing row, filtered out below
    -- BEGIN WINDOWS
    -- , ('P000', DATE '2026-04-27', DATE '2026-05-12')
    -- END WINDOWS
),

participants AS (
  SELECT
    w.participant_id,
    e.user_id,
    w.intervention_start,
    w.intervention_end,
    (w.intervention_end - w.intervention_start + 1) AS intervention_days
  FROM windows w
  LEFT JOIN public.study_enrollments e
    ON e.participant_id = w.participant_id
   AND e.cohort_key = (SELECT cohort_key FROM params)
  WHERE w.participant_id IS NOT NULL
),

-- daily_sessions.session_date is already an app-time-zone date.
sessions AS (
  SELECT
    p.participant_id,
    ds.session_date,
    ds.started_at,
    ds.completed,
    ds.completed_at,
    ds.reading_done,
    ds.listening_done,
    ds.reading_time_seconds,
    ds.listening_time_seconds,
    (
      ds.completed_at IS NOT NULL
      OR (
        ds.reading_done
        AND ds.listening_done
        AND (
          ds.flashcards_completed_at IS NOT NULL
          OR ds.flashcard_attempts_count >= ds.assigned_flashcard_count
        )
      )
    ) AS loop_completed
  FROM participants p
  JOIN public.daily_sessions ds
    ON ds.user_id = p.user_id
   AND ds.session_date BETWEEN p.intervention_start AND p.intervention_end
),

session_agg AS (
  SELECT
    participant_id,
    count(*) FILTER (WHERE started_at IS NOT NULL)       AS sessions_started,
    count(*) FILTER (WHERE loop_completed)               AS sessions_completed,
    count(*) FILTER (WHERE completed)                    AS sessions_completed_raw_flag,
    count(*) FILTER (WHERE completed_at IS NOT NULL)     AS sessions_completed_at_present,
    count(DISTINCT session_date) FILTER (WHERE started_at IS NOT NULL) AS days_with_started_session,
    sum(GREATEST(reading_time_seconds, 0))               AS reading_seconds,
    sum(GREATEST(listening_time_seconds, 0))             AS listening_seconds
  FROM sessions
  GROUP BY participant_id
),

-- Same filter as the app's analytics: review_events.session_date in range.
reviews AS (
  SELECT
    p.participant_id,
    re.session_date,
    re.word_id,
    re.queue_kind,
    re.ms_spent
  FROM participants p
  JOIN public.review_events re
    ON re.user_id = p.user_id
   AND re.session_date BETWEEN p.intervention_start AND p.intervention_end
),

review_agg AS (
  SELECT
    participant_id,
    count(*)                                              AS total_reviews,
    count(DISTINCT word_id) FILTER (WHERE queue_kind = 'new') AS new_cards_introduced,
    count(DISTINCT word_id)                               AS unique_lemmas_reviewed
  FROM reviews
  GROUP BY participant_id
),

-- Flashcard time is rounded to whole seconds per day, as in buildDailyAggregates.
flashcard_seconds AS (
  SELECT participant_id, sum(day_seconds) AS flashcard_seconds
  FROM (
    SELECT participant_id, session_date,
           round(sum(GREATEST(ms_spent, 0))::numeric / 1000) AS day_seconds
    FROM reviews
    GROUP BY participant_id, session_date
  ) per_day
  GROUP BY participant_id
),

reader_saves AS (
  SELECT p.participant_id, udw.session_date
  FROM participants p
  JOIN public.user_deck_words udw
    ON udw.user_id = p.user_id
   AND udw.added_via = 'reader'
   AND udw.session_date BETWEEN p.intervention_start AND p.intervention_end
),

active_days AS (
  SELECT participant_id, count(DISTINCT d) AS days_active
  FROM (
    SELECT participant_id, session_date AS d FROM reviews
    UNION ALL
    SELECT participant_id, session_date FROM reader_saves
    UNION ALL
    SELECT participant_id, session_date FROM sessions WHERE reading_done OR listening_done
  ) any_activity
  GROUP BY participant_id
),

reading_done_texts AS (
  SELECT p.participant_id, count(*) AS reading_passages_completed
  FROM participants p
  CROSS JOIN params prm
  JOIN public.reading_progress rp
    ON rp.user_id = p.user_id
   AND rp.status = 'completed'
   AND (rp.completed_at AT TIME ZONE prm.tz)::date
       BETWEEN p.intervention_start AND p.intervention_end
  GROUP BY p.participant_id
),

listening_done_tracks AS (
  SELECT p.participant_id, count(*) AS listening_tracks_completed
  FROM participants p
  CROSS JOIN params prm
  JOIN public.listening_progress lp
    ON lp.user_id = p.user_id
   AND lp.status = 'completed'
   AND (lp.completed_at AT TIME ZONE prm.tz)::date
       BETWEEN p.intervention_start AND p.intervention_end
  GROUP BY p.participant_id
),

-- lib/recommendation/substages.ts SUBSTAGE_TABLE (rankToSubstageIndex:
-- null or <= 0 -> 1, above 35000 -> 30).
substages (stage_index, substage, rank_max) AS (
  VALUES
    (1, 'A1--', 150), (2, 'A1-', 350), (3, 'A1', 650), (4, 'A1+', 1050),
    (5, 'A1++', 1500), (6, 'A2--', 1900), (7, 'A2-', 2400), (8, 'A2', 2980),
    (9, 'A2+', 3620), (10, 'A2++', 4300), (11, 'B1--', 5050), (12, 'B1-', 5900),
    (13, 'B1', 6900), (14, 'B1+', 8000), (15, 'B1++', 9200), (16, 'B2--', 10500),
    (17, 'B2-', 11950), (18, 'B2', 13550), (19, 'B2+', 15250), (20, 'B2++', 17000),
    (21, 'C1--', 18900), (22, 'C1-', 21000), (23, 'C1', 23200), (24, 'C1+', 25400),
    (25, 'C1++', 27500), (26, 'C2--', 29200), (27, 'C2-', 30900), (28, 'C2', 32500),
    (29, 'C2+', 33900), (30, 'C2++', 35000)
),

placement_runs AS (
  SELECT
    p.participant_id,
    p.intervention_start,
    p.intervention_end,
    COALESCE(r.completed_at, r.started_at, r.created_at) AS attempt_at,
    (COALESCE(r.completed_at, r.started_at, r.created_at) AT TIME ZONE prm.tz)::date AS attempt_date,
    COALESCE(s.stage_index, 30)    AS stage_index,
    COALESCE(s.substage, 'C2++')   AS substage
  FROM participants p
  CROSS JOIN params prm
  JOIN public.baseline_test_runs r
    ON r.user_id = p.user_id
   AND r.status = 'completed'
  LEFT JOIN LATERAL (
    SELECT st.stage_index, st.substage
    FROM substages st
    WHERE GREATEST(COALESCE(r.estimated_frontier_rank, 0), 0) <= st.rank_max
    ORDER BY st.stage_index
    LIMIT 1
  ) s ON true
),

placement_first AS (
  SELECT DISTINCT ON (participant_id)
    participant_id, attempt_date, substage, stage_index
  FROM placement_runs
  WHERE attempt_date <= intervention_end
  ORDER BY participant_id, attempt_at
),

placement_last AS (
  SELECT DISTINCT ON (participant_id)
    participant_id, attempt_date, substage, stage_index
  FROM placement_runs
  WHERE attempt_date BETWEEN intervention_start AND intervention_end
  ORDER BY participant_id, attempt_at DESC
),

placement_in_window AS (
  SELECT participant_id, count(*) AS attempts_in_window
  FROM placement_runs
  WHERE attempt_date BETWEEN intervention_start AND intervention_end
  GROUP BY participant_id
)

SELECT
  p.participant_id,
  to_char(p.intervention_start, 'YYYY-MM-DD')                     AS intervention_start,
  to_char(p.intervention_end, 'YYYY-MM-DD')                       AS intervention_end,
  p.intervention_days,
  COALESCE(sa.sessions_started, 0)                                AS sessions_started,
  COALESCE(sa.sessions_completed, 0)                              AS sessions_completed,
  COALESCE(ad.days_active, 0)                                     AS days_active,
  round(
    (COALESCE(fs.flashcard_seconds, 0)
     + COALESCE(sa.reading_seconds, 0)
     + COALESCE(sa.listening_seconds, 0)) / 60.0,
    1
  )                                                               AS total_active_time_minutes,
  COALESCE(ra.total_reviews, 0)                                   AS total_reviews,
  COALESCE(ra.new_cards_introduced, 0)                            AS new_cards_introduced,
  COALESCE(ra.unique_lemmas_reviewed, 0)                          AS unique_lemmas_reviewed,
  COALESCE(rd.reading_passages_completed, 0)                      AS reading_passages_completed,
  COALESCE(ld.listening_tracks_completed, 0)                      AS listening_tracks_completed,
  round(COALESCE(sa.listening_seconds, 0) / 60.0, 1)              AS total_listening_time_minutes,
  round(COALESCE(sa.reading_seconds, 0) / 60.0, 1)                AS total_reading_time_minutes,
  COALESCE(ra.total_reviews, 0) - COALESCE(ra.unique_lemmas_reviewed, 0) AS repeat_review_count,
  to_char(pf.attempt_date, 'YYYY-MM-DD')                          AS placement_first_attempt_date,
  pf.substage                                                     AS placement_first_substage,
  pf.stage_index                                                  AS placement_first_stage_index,
  to_char(pl.attempt_date, 'YYYY-MM-DD')                          AS placement_last_attempt_date,
  pl.substage                                                     AS placement_last_substage,
  pl.stage_index                                                  AS placement_last_stage_index,
  COALESCE(pw.attempts_in_window, 0)                              AS placement_attempts_in_window,
  pl.stage_index - pf.stage_index                                 AS placement_stage_change,
  -- diagnostics (not in v3)
  COALESCE(sa.sessions_completed_raw_flag, 0)                     AS sessions_completed_raw_flag,
  COALESCE(sa.sessions_completed_at_present, 0)                   AS sessions_completed_at_present,
  COALESCE(sa.days_with_started_session, 0)                       AS days_with_started_session,
  (p.user_id IS NOT NULL)                                         AS enrolled
FROM participants p
LEFT JOIN session_agg sa           ON sa.participant_id = p.participant_id
LEFT JOIN review_agg ra            ON ra.participant_id = p.participant_id
LEFT JOIN flashcard_seconds fs     ON fs.participant_id = p.participant_id
LEFT JOIN active_days ad           ON ad.participant_id = p.participant_id
LEFT JOIN reading_done_texts rd    ON rd.participant_id = p.participant_id
LEFT JOIN listening_done_tracks ld ON ld.participant_id = p.participant_id
LEFT JOIN placement_first pf       ON pf.participant_id = p.participant_id
LEFT JOIN placement_last pl        ON pl.participant_id = p.participant_id
LEFT JOIN placement_in_window pw   ON pw.participant_id = p.participant_id
ORDER BY p.participant_id;
