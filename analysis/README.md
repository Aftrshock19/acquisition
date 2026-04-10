# Evaluation Analysis Pipeline

Reproducible analysis workflow that consumes the app's JSON export and produces
dissertation-ready figures, tables, and a summary report.

## Prerequisites

- Python 3.10+
- pip

## Setup

```bash
cd analysis
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Obtaining the export

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

## Running the pipeline

```bash
cd analysis
python build_report.py <path-to-export.json>
```

Example:

```bash
python build_report.py data/export.json
```

## Outputs

### Figures (`analysis/figures/`)

All saved as PNG at 150 DPI with academic-style formatting:

| File | Description |
|---|---|
| sessions_started_vs_completed.png | Daily sessions started vs. completed |
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
| daily_aggregates.csv | Full daily aggregates table |
| metric_definitions.md | Data dictionary from the export bundle |
| summary.md | Text summary report with key metrics and data quality notes |

## Validation

The pipeline validates the export schema on load. If required columns are missing
(e.g., after an export format change), the pipeline exits immediately with a
clear error message listing the missing columns.

## Multi-user / cohort support

The current pipeline processes single-user exports. The analysis logic is
structured so that multi-user support can be added by:

1. Implementing a cohort export endpoint that returns the same JSON structure
   with data from multiple users (each row already includes `anonymous_user_id`).
2. Concatenating multiple single-user export files and adding a user grouping
   column.
3. Adjusting the plot functions to facet or overlay by user.

No changes to the core loading, validation, or metric computation logic are
needed. The `anonymous_user_id` field is already present in every exported dataset.

## Cohort export — extension path

The app currently has no admin role system, protected admin routes, or
service-role access patterns. Implementing a cohort-level export would require:

1. **Auth:** Add an admin role (e.g., via a `user_roles` table or Supabase
   custom claims) and a middleware/guard that checks the role.
2. **Endpoint:** Create `/api/admin/export` that reuses `getUserAnalyticsBundle`
   and `buildJsonExport` for each user in the cohort, wrapping results in a
   multi-user envelope.
3. **Anonymisation:** The existing `anonymizeUserId` function already produces
   stable, salted hashes. Use it unchanged.
4. **Logging:** Extend `export_runs` or create an `admin_export_runs` table.
5. **Analysis:** Update `load_export.py` to accept the multi-user envelope
   and split into per-user `ExportBundle` instances.

This was intentionally deferred because adding admin auth infrastructure for a
single-user study is premature, and forcing it risks introducing security issues
with no testing infrastructure to catch them.
