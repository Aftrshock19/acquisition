# Dissertation Metrics

This app exports a reproducible metrics bundle for the guided daily learning loop:

1. flashcards (SRS-scheduled new-card and review-card attempts)
2. reading (interactive reader with word-save capability)
3. listening (audio playback with optional transcript)
4. session complete

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

Core derived metrics:

- **Daily session completion rate:** Proportion of sessions with a recorded `started_at` that reached `completed=true`. Excludes auto-created sessions that were never opened.
- **Flashcard attempt accuracy (all queues):** Correct attempts divided by all submitted attempts, including retries.
- **New-card main-queue attempts per day:** `review_events` where `queue_source='main'` and `queue_kind='new'`. Counts submitted attempts, not unique words.
- **Review-card main-queue attempts per day:** `review_events` where `queue_source='main'` and `queue_kind='review'`. Counts submitted attempts, not unique words.
- **Total flashcard attempts per day:** All `review_events` including retries.
- **Retry-queue attempts per day:** `review_events` where `queue_source='retry'`. Counts submitted retry attempts only.
- **Logged active time per day:** Sum of submitted-attempt `ms_spent` (converted to seconds) plus client-recorded `reading_time_seconds` and `listening_time_seconds`. Does not include idle time, navigation time, or abandoned views.
- **Reading stage completions per day:** Sessions where `reading_done=true`. Binary flag per session.
- **Listening stage completions per day:** Sessions where `listening_done=true`. Binary flag per session.
- **Reader-saved words per day:** `user_deck_words` where `added_via='reader'`.
- **Sessions reaching each stage milestone:** Count of sessions reaching each milestone (started, flashcards done, reading done, listening done, completed).
- **Stage drop-off:** Sessions reaching stage N minus sessions reaching stage N+1. Listening drop-off denominator is sessions with reading complete AND a listening asset assigned.
- **Review-card correctness (retention proxy):** Correctness on review-card attempts (`queue_kind='review'`). This is a behavioural proxy, not a direct retention measure.
- **Days with recorded activity:** Distinct session dates with any flashcard attempt, saved word, reading completion, or listening completion.

## Aggregation logic

- Session dates use the app session time zone from `APP_SESSION_TIME_ZONE`, defaulting to `Europe/London`.
- The reusable server aggregation layer lives in [`lib/analytics/service.ts`](../lib/analytics/service.ts).
- The progress page, export route, and consistency checks all read from the same derived analytics bundle so the UI and exported totals are guaranteed to match.

## Export formats

- Route: `/api/progress/export`
- Query params:
  - `format=json|csv`
  - `dataset=all|daily_aggregates|sessions|review_events|reading_events|listening_events|saved_words|export_runs`
  - `from=YYYY-MM-DD`
  - `to=YYYY-MM-DD`
- JSON:
  - Full bundle: metadata, metric definitions, summary metrics, today snapshot, and all dataset arrays.
- CSV:
  - One dataset per file with stable column names for pandas, R, or spreadsheet import.

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
  - impossible session stage/state combinations
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

## Cohort export

Cohort-level (multi-user) export is not currently implemented. The app has no admin role system or protected admin routes. See the "Cohort export" section in [`analysis/README.md`](../analysis/README.md) for the documented extension path.
