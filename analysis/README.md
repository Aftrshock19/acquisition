# Evaluation Analysis Pipeline

Reproducible analysis workflow that consumes the app's JSON export and produces
dissertation-ready figures, tables, and a summary report. It also rebuilds the
published engagement tables from a dose export (`build_results.py`).

## Prerequisites

- Python 3.10+
- pip

## Setup

```bash
cd analysis
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt   # pandas, matplotlib, scipy, pytest
```

## Obtaining the export

Single user:

1. Sign in to the app.
2. Navigate to `/progress`.
3. Set the desired date range.
4. Click "Download JSON bundle".
5. Save the file (e.g., `analysis/data/export.json`).

Or use curl against the running app:

```bash
# Replace the cookie/auth header with your session credentials
curl -o analysis/data/export.json \
  "http://localhost:3000/api/progress/export?dataset=all&format=json&from=2026-03-27&to=2026-04-10"
```

Cohort (researcher only, see `docs/study-operations.md`):

```bash
curl -o analysis/data/cohort.json \
  "http://localhost:3000/api/admin/progress/export?format=json&cohort=default&from=2026-04-27&to=2026-05-18"
```

`analysis/data/` is gitignored.

## Running the pipeline

```bash
cd analysis
python build_report.py <path-to-export.json>
```

Single-user and cohort exports are both accepted; a cohort export is detected
by its top-level `participants` array.

## Research definitions (applied at read time)

`metrics.py` holds the definitions used for every reported completion and
retention figure. They mirror `lib/analytics/service.ts`
(`isFlashcardStageCompleted`, `isLoopCompleted`, `isRetentionProxyEvent`);
keep the two in sync.

| Concept | Definition |
|---|---|
| Flashcard stage completed | `flashcards_completed_at IS NOT NULL OR flashcard_attempts_count >= assigned_flashcard_count` (retries count towards the target) |
| Loop completed (`loop_completed`) | `completed_at IS NOT NULL OR (reading_done AND listening_done AND <flashcard stage completed>)` |
| Retention-proxy events | `review_events` with `queue_kind = 'review' AND queue_source = 'main'` |

- "Sessions completed", the completion rate, the per-day completed bars, the
  per-participant table and the "fully completed" stage bucket all use
  `loop_completed`. The raw `daily_sessions.completed` flag is **not** used: it
  is reset by "Do more flashcards", and on pilot rows where the server counted
  only first attempts it stayed `false` after reading and listening were done.
- Review-card correctness (retention proxy) and the mean inter-review interval
  (`delta_hours`) use main-queue review cards only. Same-session retries follow
  a miss minutes earlier and are not spaced recall.
- Flashcard attempt accuracy is unchanged: all attempts, retries included.

The definitions use only columns that exist on historical rows, so they work
on pilot data without any backfill. If an export carries a `loop_completed`
column (format `dissertation-metrics-v2` and later), that value is used where
it is set; otherwise it is computed. On load, `ExportBundle.summary` is
recomputed from the raw rows; the summary as exported is kept in
`ExportBundle.exported_summary`. Exports in format `dissertation-metrics-v1`
used the raw flag and included retries in the proxy, so their own summary
numbers differ from the report's. `summary.md` warns when sessions count as
completed under `loop_completed` but have `completed = false`.

## Cohort pipeline

`load_export.py` merges all participants' datasets into combined DataFrames
with an `anonymous_user_id` column (the study participant ID). Then:

- The cohort summary is computed from the merged raw rows: accuracy is total
  correct attempts over total attempts, and the retention proxy and stage
  totals are counts summed over participants. Per-participant rates are never
  averaged.
- `per_participant_summary.csv` lists each participant's totals.
- For the per-day figures, participant-days are summed by date. Accuracy and
  retention proxy per day are recomputed from the summed count columns
  (`flashcard_correct_count`, `review_proxy_attempts`, `review_proxy_correct`),
  which `metrics.annotate_daily_aggregates` adds from the raw review events.
- Day counts and per-day means in `summary.md`, `summary_metrics.*` and
  `chapter_support_summary.md` are over participant-days (one row per
  participant per date), e.g. "activity on 5 of 6 participant-days" and
  "mean per active participant-day". They are not over the per-date cohort
  rows used for the figures.

Earlier versions crashed on any non-empty cohort export (`KeyError` in
`_plot_session_completion_rate`, which used the per-day *count* of started
sessions as a boolean mask). They also reported cohort accuracy as
participant count / attempts because of an operator-precedence bug
(`round(acc or 0 * n)`), and left the retention proxy and stage totals out of
the cohort summary.

## Outputs

### Figures (`analysis/figures/`)

All saved as PNG at 150 DPI with academic-style formatting:

| File | Description |
|---|---|
| sessions_started_vs_completed.png | Daily sessions started vs. completed (`loop_completed`) |
| session_completion_rate.png | Cumulative session completion rate |
| flashcard_accuracy.png | Flashcard attempt accuracy over time |
| new_card_attempts.png | New-card main-queue attempts per day |
| review_card_attempts.png | Review-card main-queue attempts per day |
| total_attempts.png | Total flashcard attempts per day (with retries) |
| retry_attempts.png | Retry-queue attempts per day |
| logged_active_time.png | Logged active time stacked by modality |
| reading_completions.png | Reading stage completions per day |
| listening_completions.png | Listening stage completions per day |
| saved_words.png | Reader-saved words per day |
| days_active_rolling.png | 7-day rolling window of active days |
| stage_completion.png | Sessions reaching each stage milestone |
| review_correctness_proxy.png | Review-card correctness (retention proxy) trend |

### Tables (`analysis/output/`)

| File | Description |
|---|---|
| summary_metrics.csv | One-row-per-metric summary table |
| summary_metrics.md | Same table in Markdown |
| daily_aggregates.csv | Daily aggregates; `session_completed` as exported, `loop_completed` as used |
| per_participant_summary.csv | Cohort exports only: per-participant totals |
| metric_definitions.md | Data dictionary from the export bundle |
| summary.md | Text summary report with key metrics and data quality notes |
| chapter_support_summary.md | Chapter-ready summary with values filled in |

## Rebuilding the published engagement tables (`build_results.py`)

`engagement_profile.csv` and `engagement_outcome_associations.csv` were
published in `public/results/` without the code that made them.
`build_results.py` rebuilds both from a per-participant dose export plus
`h1_participant_scores.csv`, and writes to `analysis/output/` (never to
`public/results/`).

After the study ended, the per-participant tables were taken off the site, so
only the aggregate CSVs remain in `public/results/`. All seven published CSVs
are still in git history at commit `988806c`. `restore-published` copies them
into `analysis/data/published/` (gitignored), which is where `build` looks for
the H1 scores by default:

```bash
python analysis/build_results.py restore-published
python analysis/build_results.py build dose_analysis_export_v3.csv --compare-dir analysis/data/published
```

Run on the local `dose_analysis_export_v3.csv`, both files come out
byte-identical to the published ones. The transformations are:

- Profile participants: those with H1 outcome scores (10), in that file's order.
- `intervention_window_days` = `intervention_days` (end - start + 1).
- `completion_percent` = `sessions_completed / sessions_started` x 100, rounded
  half up; 0 if nothing was started.
- `total_listening_time_minutes` to 1 dp; other columns copied unchanged.
- Associations: the same participants minus P083 (excluded because the
  engagement logs were inconsistent with interview evidence of app use; see
  `/appendix/h2-sensitivity`), so n = 9. Each rate is a count divided by
  `intervention_days` (days active, sessions completed, total reviews, reading
  passages completed, listening tracks completed), correlated with the matching
  gain using Spearman's rho (`scipy.stats.spearmanr`: average ranks, two-sided
  t-approximation p). rho is given to 2 dp and p to 3 dp.
- `engagement_outcome_associations_detail.csv` adds n, the participants, the
  exclusions, and unrounded rho and p.

The script reproduces the tables from v3 but cannot show how v3's
`sessions_completed` was computed. That is what the SQL below is for.
`--completed-from <csv>` takes `sessions_completed` from another CSV (normally
the SQL export result), matched on `participant_id`, and keeps every other
column from the dose file given first. `--completed-column` picks the column
to take: `sessions_completed` (`loop_completed`, the default),
`sessions_completed_raw_flag` or `sessions_completed_at_present`.

## Dose export SQL (`sql/dose_analysis_export.sql`)

A read-only `WITH ... SELECT` that rebuilds the columns of
`dose_analysis_export_v3.csv` from the production tables, with
`sessions_completed` under `loop_completed`. Three diagnostic columns follow
the v3 columns: `sessions_completed_raw_flag`, `sessions_completed_at_present`
and `days_with_started_session`. Intervention windows are not stored in the
database, so they are filled into the query from a dose export:

```bash
python analysis/build_results.py emit-sql dose_analysis_export_v3.csv
#   -> analysis/output/dose_analysis_export_filled.sql (gitignored)
# Run that file in the Supabase SQL editor, download the result as CSV, then:
python analysis/build_results.py diff-dose <result.csv> dose_analysis_export_v3.csv
```

`diff-dose` lists every differing cell. It also says which definition v3's
`sessions_completed` matches for how many participants: `loop_completed`, the
raw flag, or `completed_at`. If v3 matches the raw flag and the
`loop_completed` counts differ, splice the corrected counts into v3 and
rebuild:

```bash
python analysis/build_results.py build dose_analysis_export_v3.csv \
  --completed-from <result.csv> --compare-dir analysis/data/published
```

This prints each participant whose `sessions_completed` changes and every
published cell that differs. Only `sessions_completed`, `completion_percent`
and the Completed-loop association can change; every other value still comes
from v3.

Do not run `build` on the SQL result itself. Its other columns are best-effort
reconstructions that differ from v3 for reasons unrelated to completion: for
example, `new_cards_introduced` comes out 0 rather than v3's 1 for P083, who
has no reviews, and
`days_active` follows the app's activity rule, whereas v3's equals
`sessions_started`. Rebuilding from it would silently change other profile
cells and the Active-day, Reading and Listening associations. The header of
the SQL file lists these columns (`new_cards_introduced`, `days_active`,
reading and listening completions, placement fields).

## Tests

```bash
cd analysis
python -m pytest tests
```

- `tests/test_cohort_pipeline.py` builds a synthetic two-participant cohort
  export (`tests/synthetic_export.py`, v1-shaped like the pilot exports) and
  runs the cohort and single-user paths end to end. It checks cohort accuracy,
  `loop_completed` (including the "retries met the target" and "Do more
  flashcards" cases), the exported-column override, and the main-queue-only
  retention proxy.
- `tests/test_build_results.py` covers the profile and association
  transformations, `emit-sql` and `diff-dose`, and that the SQL contains only
  a read. It also checks that `--completed-from` changes only
  `sessions_completed`, `completion_percent` and the Completed-loop row. If
  the local `dose_analysis_export_v3.csv` exists, it also checks
  that the published tables are reproduced byte for byte; otherwise that test
  is skipped.

## Validation

The pipeline validates the export schema on load. If required columns are missing
(e.g., after an export format change), the pipeline exits immediately with a
clear error message listing the missing columns.
