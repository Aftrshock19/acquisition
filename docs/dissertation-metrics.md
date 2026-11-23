# Dissertation Metrics

This app exports a reproducible metrics bundle for the guided daily learning loop:

1. flashcards (SRS-scheduled new-card and review-card attempts)
2. reading (interactive reader with word-save capability)
3. listening (audio playback with optional transcript)
4. session complete

## Changed 2026-11-02

Two metric definitions were corrected, and the export `format_version` changed from `dissertation-metrics-v1` to `dissertation-metrics-v2`.

1. **Completion.** Sessions completed, the daily session completion rate, the "fully completed" stage milestone and the per-day `session_completed` column now use `loop_completed` (defined under [Metric definitions](#metric-definitions)) instead of the raw `completed` flag. The "flashcards completed" milestone now counts retries (`flashcard_attempts_count`) instead of first attempts only. The raw flag under-counted the participants who practised most: anyone whose session had retries, and anyone who pressed "Do more flashcards" after finishing.
2. **Retention proxy.** Review-card correctness (summary and per day) and the mean inter-review interval (`average_delta_hours`) now use only `queue_kind='review' AND queue_source='main'`. They previously included same-session retries, whose correctness comes minutes after a miss and whose `delta_hours` is minutes rather than days.

Recompute any reported number that came from a v1 export, from the raw `completed` flag, or from all `queue_kind='review'` events. Both can be recomputed from the raw datasets of a v1 export without touching the database. Derive `loop_completed` from the `sessions` dataset, which contains every column the rule needs. Derive the proxy and mean interval from the `review_events` dataset filtered to `queue_source='main'`. This also applies to the published results CSVs (for example `engagement_profile.csv`, which has `sessions_completed` and `completion_percent`). The per-participant ones were taken off the site after the study and are now only in git history at `988806c`; `analysis/build_results.py` restores and rebuilds them (see `analysis/README.md`), but cannot show which completion field the published `sessions_completed` used.

## Sources of truth

- `daily_sessions`
  Stores daily loop lifecycle state, assigned flashcard workload counts, stage progression flags, reading/listening milestone timestamps, and client-recorded reading/listening active seconds.
- `review_events`
  Canonical append-only flashcard attempt log. Each row records one submitted attempt with queue kind (`new` or `review`), queue source (`main` or `retry`), `shown_at`, `submitted_at`, correctness, and a stable `client_attempt_id` for deduplication.
- `user_deck_words`
  Canonical saved-word event source. Reader saves record `session_date`, `daily_session_id`, `text_id`, and `added_via` source. Append-only: duplicate saves of the same word are silently ignored.
- `export_runs`
  Logs each authenticated export request with the anonymized user identifier used in the exported file.

## Metric definitions

The implementation source of truth for metric names, formulas, and limitations is [`lib/analytics/metricDefinitions.ts`](../lib/analytics/metricDefinitions.ts).

For dissertation-ready prose definitions with explicit numerators, denominators, and wording rationale, see [`docs/evaluation-metric-wording.md`](./evaluation-metric-wording.md).

Completion is defined once and used for every completion metric (sessions completed, completion rate, the "fully completed" stage milestone, and the per-day `session_completed` / `loop_completed` columns):

```
loop_completed := completed_at IS NOT NULL
                  OR (reading_done AND listening_done
                      AND (flashcards_completed_at IS NOT NULL
                           OR flashcard_attempts_count >= assigned_flashcard_count))
```

The raw `daily_sessions.completed` flag is not used for research metrics. "Do more flashcards" sets it back to `false` on a finished day, and during the pilot it stayed `false` on days the participant finished, because the server counted only first attempts towards the flashcard target while the client also counted retries. "Do more flashcards" keeps `completed_at`. Two actions during the pilot cleared it: un-marking the listening step (`uncompleteListeningStep`), which also sets `listening_done` back to `false`; and raising the daily flashcard target in Settings above the day's `flashcard_completed_count` (`app/actions/settings.ts`), which also cleared `flashcards_completed_at`, set `completed=false` and raised `assigned_flashcard_count`, while leaving `reading_done` and `listening_done` true (see [Known limitations](#known-limitations)). The rule uses only columns that exist on historical rows, so it applies to pilot data as recorded. It is implemented in `isLoopCompleted` in [`lib/analytics/service.ts`](../lib/analytics/service.ts) and must stay identical in `analysis/`.

The stage-level "flashcards completed" milestone is `flashcards_completed_at IS NOT NULL OR flashcard_attempts_count >= assigned_flashcard_count`. Retries count towards the target, as they do in the client.

Core derived metrics:

- **Daily session completion rate:** Proportion of sessions with a recorded `started_at` where `loop_completed` is true. Excludes auto-created sessions that were never opened.
- **Flashcard attempt accuracy (all queues):** Correct attempts divided by all submitted attempts, including retries.
- **New-card main-queue attempts per day:** `review_events` where `queue_source='main'` and `queue_kind='new'`. Counts submitted attempts, not unique words.
- **Review-card main-queue attempts per day:** `review_events` where `queue_source='main'` and `queue_kind='review'`. Counts submitted attempts, not unique words.
- **Total flashcard attempts per day:** All `review_events` including retries.
- **Retry-queue attempts per day:** `review_events` where `queue_source='retry'`. Counts submitted retry attempts only.
- **Logged active time per day:** Sum of submitted-attempt `ms_spent` (converted to seconds) plus client-recorded `reading_time_seconds` and `listening_time_seconds`. Does not include idle time, navigation time, or abandoned views.
- **Reading stage completions per day:** Sessions where `reading_done=true`. Binary flag per session.
- **Listening stage completions per day:** Sessions where `listening_done=true`. Binary flag per session.
- **Reader-saved words per day:** `user_deck_words` where `added_via='reader'`.
- **Sessions reaching each stage milestone:** Count of sessions reaching each milestone (started, flashcards completed as defined above, reading done, listening done with a listening asset, `loop_completed`).
- **Stage drop-off:** Sessions reaching stage N minus sessions reaching stage N+1. Listening drop-off denominator is sessions with reading complete AND a listening asset assigned.
- **Review-card correctness (retention proxy):** Correctness on main-queue review-card attempts (`queue_kind='review' AND queue_source='main'`). Same-session retries are excluded: they follow a miss by a few minutes, so they say nothing about spaced recall. This is a behavioural proxy, not a direct retention measure.
- **Mean inter-review interval:** Mean `delta_hours` over the same main-queue review-card attempts as the retention proxy (retries excluded).
- **Days with recorded activity:** Distinct session dates with any flashcard attempt, saved word, reading completion, or listening completion.

## Aggregation logic

- Session dates use the app session time zone from `APP_SESSION_TIME_ZONE`, defaulting to `Europe/London`.
- The reusable server aggregation layer lives in [`lib/analytics/service.ts`](../lib/analytics/service.ts).
- The progress page, export route, and consistency checks all read from the same derived analytics bundle so the UI and exported totals are guaranteed to match.

## Export formats

- Route: `/api/progress/export`
- Query params:
  - `format=json|csv`
  - `dataset=all|daily_aggregates|sessions|review_events|reading_events|listening_events|saved_words|reading_question_attempts|export_runs`
  - `from=YYYY-MM-DD`
  - `to=YYYY-MM-DD`
- JSON:
  - Full bundle: metadata, metric definitions, summary metrics, today snapshot, and all dataset arrays.
- CSV:
  - One dataset per file with stable column names for pandas, R, or spreadsheet import.
- Completion columns:
  - `daily_aggregates.loop_completed` and `daily_aggregates.session_completed`: both carry `loop_completed` (from `format_version` `dissertation-metrics-v2`). In v1 exports `session_completed` was the raw `completed` flag.
  - `sessions.completed`: the raw database flag, unchanged.
  - `sessions.loop_completed`: `loop_completed` derived for that row.

## Reproducible analysis pipeline

The `analysis/` directory contains a Python pipeline that consumes the JSON export and produces dissertation-ready figures, tables, and a summary report. See [`analysis/README.md`](../analysis/README.md) for setup and usage instructions.

## Evaluation chapter support

Dissertation-chapter-ready support documents are available in `docs/`:

- [`dissertation-evaluation-measures.md`](./dissertation-evaluation-measures.md) — Operationalised measure definitions
- [`dissertation-analysis-procedure.md`](./dissertation-analysis-procedure.md) — Export, validation, and analysis procedure
- [`dissertation-results-scaffold.md`](./dissertation-results-scaffold.md) — Results section scaffold with placeholders
- [`dissertation-figure-table-captions.md`](./dissertation-figure-table-captions.md) — Draft captions for all generated figures and tables
- [`dissertation-threats-to-validity.md`](./dissertation-threats-to-validity.md) — Threats-to-validity mapping

## Consistency checks

- Protected debug page: `/progress/debug`
- Implemented checks:
  - duplicate review attempt IDs
  - missing review session links
  - impossible session stage/state combinations (a row back at `stage='flashcards'` with reading/listening done is not flagged when `completed_at` is set, because that is extra practice after a completed loop)
  - missing completion timestamps
  - workload completed greater than workload assigned
  - impossible review timing values
  - session date drift against the configured app time zone
  - anonymized export ID mismatches
  - duplicate export runs

## Known limitations

- Flashcard time is recorded for submitted attempts only. Abandoned card views (shown but not answered) are intentionally not persisted.
- Reader-saved words are append-only at the row level: duplicate saves of the same word are ignored after the first event.
- The review-correctness metric is a behavioural proxy derived from in-app response correctness. It does not measure recall outside the app, transfer to naturalistic contexts, or long-term retention beyond the SRS schedule.
- Logged active time is a lower bound on engagement time. It excludes idle time, navigation, and backgrounded app states.
- Older rows created before the instrumentation migration (20260410140000) may lack full queue/source metadata.
- During the pilot each answer was dated when it was submitted, so a sitting that ran past local midnight was split across two session dates. `loop_completed` cannot rejoin such a sitting.
- During the pilot, "Do more flashcards" cleared `flashcards_completed_at` and raised `assigned_flashcard_count`. An extended day left unfinished therefore counts as `loop_completed` (through `completed_at`) but not as "flashcards completed", so the stage-milestone counts are not strictly decreasing for those rows.
- During the pilot (from 2026-04-23), raising the daily target in Settings on a finished day re-opened the flashcard stage: it cleared `completed_at` and `flashcards_completed_at`, set `completed=false` and raised `assigned_flashcard_count`. Unless the participant then reached the raised target (`flashcard_attempts_count >= assigned_flashcard_count`), `loop_completed` does not recover that day. Completion is therefore under-counted for these days, which again affects the most active participants. They also appear in the consistency check as `stage='flashcards'` with reading/listening done and no `completed_at`. `initial_assigned_flashcard_count` (frozen at session creation since migration `20260423120000`) would allow them to be recovered, but the rule does not use it yet.

## Cohort export

Cohort-level export is implemented via a researcher-protected admin layer:

- **Enrollment:** `study_enrollments` table with stable participant IDs (`P001`, `P002`, ...) assigned at enrollment time.
- **Access control:** `RESEARCHER_EMAILS` env-var allowlist + `SUPABASE_SERVICE_ROLE_KEY` for cross-user queries.
- **Export route:** `/api/admin/progress/export?format=json&cohort=default&from=...&to=...`
- **Researcher ops page:** `/admin/study` shows cohort status and activity summaries.
- **Enrollment API:** `POST /api/admin/enroll` enrolls participants by email.

The cohort export reuses the same `getUserAnalyticsBundle` and `buildJsonExport` functions as the single-user export, looping over enrolled participants. The analysis pipeline (`analysis/build_report.py`) automatically detects cohort exports and produces both per-participant and aggregate outputs.

For full operational procedures, see [`docs/study-operations.md`](./study-operations.md).
