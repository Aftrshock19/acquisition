# Analysis Procedure

This section describes the data collection, export, validation, and analysis procedure used to produce the evaluation results. It is written for direct adaptation into a methodology or evaluation chapter.

---

## Data collection

All usage data was collected automatically by the application during normal use. No separate data-collection instrument was deployed. The application recorded events in three canonical database tables:

- **`daily_sessions`** recorded the lifecycle of each daily learning session, including when the session was first opened (`started_at`), which stages were completed, timestamps for each stage milestone, the assigned and completed flashcard workload, and client-recorded reading and listening time in seconds.
- **`review_events`** recorded each submitted flashcard attempt as an append-only log entry, including the word being reviewed, the user's response, whether the response was correct, the queue kind (`new` or `review`), the queue source (`main` or `retry`), the time between card display and response submission (`ms_spent`), and a stable client-generated attempt identifier for deduplication.
- **`user_deck_words`** recorded each word saved from the interactive reader, including the session date, the text being read, and the source of the save action.

Session dates were determined using the configured application time zone (`Europe/London` by default), ensuring that a session started late in the evening was attributed to the correct calendar date regardless of the server's UTC clock.

---

## Export procedure

The application provides an authenticated export endpoint at `/api/progress/export`. The endpoint accepts query parameters for format (`json` or `csv`), dataset selection, and date range. For this evaluation, the full JSON bundle was exported using the `dataset=all` parameter, which includes all raw datasets, pre-computed daily aggregates, summary metrics, and the machine-readable metric definitions used to produce them.

The export route and the application's progress page both read from the same server-side analytics service (`lib/analytics/service.ts`), which derives daily aggregates and summary metrics from the canonical database tables. This shared derivation path ensures that the values shown in the application's UI and the values present in the exported data are identical.

Each export request is logged in an `export_runs` table with the anonymised user identifier, the export format, the dataset requested, and the date range, providing an audit trail for reproducibility.

User identifiers in exported data are replaced with a salted SHA-256 hash (truncated to 16 hex characters) using a configurable salt. The original user identifier does not appear in any exported file.

---

## Schema validation

Before analysis, the exported JSON bundle is validated by the analysis pipeline (`analysis/load_export.py`). The validator checks that:

1. All required datasets are present.
2. Each dataset contains the minimum set of required columns (e.g., `session_date`, `correct`, `queue_kind` for review events).
3. The export metadata includes a format version identifier, an anonymised user identifier, and a complete date range.

If any validation check fails, the pipeline exits immediately with a clear error message listing the specific missing columns or metadata fields. This prevents the analysis from silently producing incorrect outputs if the export schema changes between application versions.

---

## Analysis pipeline

The analysis is performed by a Python script (`analysis/build_report.py`) that consumes the validated JSON bundle and produces all figures, tables, and the summary report in a single deterministic run. The pipeline uses only two dependencies: `pandas` for data manipulation and `matplotlib` for figure generation. No statistical modelling, machine learning, or interactive dashboards are used.

The pipeline proceeds as follows:

1. **Load and validate** the JSON export bundle.
2. **Parse dates** from ISO 8601 strings into Python date objects.
3. **Generate 14 figures** covering session completion, flashcard performance, stage usage, saved-word behaviour, logged active time, and the review-correctness proxy. All figures use an academic-style format with serif fonts, minimal axis decoration, and neutral colour palettes. Figures are saved as PNG files at 150 DPI.
4. **Generate summary tables** as both CSV (for further analysis or appendix inclusion) and Markdown (for draft chapter text).
5. **Run data quality checks** on the loaded data, including detection of flashcard completion counts exceeding assigned counts, missing queue metadata on pre-instrumentation review events, and review events without linked daily sessions.
6. **Write a summary report** (`analysis/output/summary.md`) containing key metric values, proxy and measurement notes, data quality warnings, and a list of generated outputs.

All outputs are written to predictable directories (`analysis/figures/` for figures, `analysis/output/` for tables and the summary report). The pipeline is deterministic: given the same input JSON file, it produces identical outputs.

---

## Reproducibility

Reproducibility is ensured through four mechanisms:

1. **Single-source derivation.** The application's server-side analytics service is the sole implementation of metric computation. The analysis pipeline consumes pre-computed aggregates from the export rather than re-implementing metric formulas, eliminating the risk of divergence between the application and the analysis.
2. **Schema validation.** The pipeline validates the export schema before proceeding, so changes to the export format cause an immediate, visible failure rather than silent data corruption.
3. **Deterministic rendering.** The matplotlib backend is set to `Agg` (non-interactive), and all figure parameters (size, DPI, font, colour) are fixed in the script. No random seeds, sampling, or interactive adjustments are involved.
4. **Version-stamped exports.** Each export includes a `format_version` field (`dissertation-metrics-v1`) and an `exported_at` timestamp, allowing the analysis outputs to be traced back to the exact export that produced them.

To reproduce the analysis:

```
cd analysis
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python build_report.py <path-to-export.json>
```

---

## Date handling and time zone stability

Session dates are computed using the `Intl.DateTimeFormat` API with the configured application time zone (defaulting to `Europe/London`). This ensures that a flashcard attempt submitted at 23:30 BST is attributed to the same session date as one submitted at 08:00 BST on the same calendar day, regardless of the server's internal clock.

The analysis pipeline preserves this by reading session dates as pre-computed strings from the export and parsing them into Python date objects without applying any additional time zone conversion. No date arithmetic is performed on raw timestamps; all date grouping uses the pre-computed `session_date` field.

---

## Consistency checks

The application includes an in-app consistency check page (`/progress/debug`) that runs a suite of automated checks on the analytics bundle. These checks detect:

- Duplicate review attempt identifiers (indicating potential deduplication failures).
- Review events without a linked daily session (indicating orphaned records).
- Impossible session state combinations (e.g., a session marked as at the flashcards stage after a later stage has been completed).
- Missing completion timestamps where completion flags are set.
- Flashcard completion counts exceeding assigned counts.
- Review timing values outside the expected range (e.g., negative `ms_spent` or single-attempt times exceeding 30 minutes).
- Session date drift (where the stored session date does not match the date derived from the session's `started_at` timestamp in the configured time zone).
- Anonymised export identifier mismatches (indicating a change in the export anonymisation salt).
- Duplicate export runs triggered within the same minute.

These checks run on the same analytics bundle used by the progress page and export route. Any issues detected are reported in the summary output and should be noted in the evaluation as data quality observations.

---

## Metric computation location

A deliberate design decision was made to compute all derived metrics (daily aggregates, summary statistics, and the review-correctness proxy) on the server side within the application's analytics service, rather than in the analysis script. The analysis script consumes these pre-computed values directly. This means:

- There is no risk of the analysis script computing a metric differently from the application.
- The analysis script does not need access to the database or any application secrets.
- The same metric values that the user sees on the progress page during the study are the values that appear in the evaluation.

The analysis script does perform its own data quality checks on the exported data, but it does not re-derive any metric that the application already computes.
