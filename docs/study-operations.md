# Study Operations Guide

This document covers the operational procedures for running a multi-participant study using the cohort export layer.

---

## Prerequisites

### Environment variables

Add the following to your server environment (e.g., `.env.local` or Vercel environment variables):

```env
# Comma-separated list of email addresses allowed to access researcher routes
RESEARCHER_EMAILS=researcher@university.ac.uk

# Supabase service role key (found in Supabase dashboard > Settings > API)
# NEVER expose this key to the client. It bypasses Row Level Security.
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Optional: salt for anonymising user IDs in exports (defaults to SUPABASE_URL)
EXPORT_ANONYMIZATION_SALT=your-study-salt
```

### Database migration

Apply the study enrollments migration:

```bash
supabase db push --linked
# or manually:
supabase db query --linked -f supabase/migrations/20260410160000_add_study_enrollments.sql
```

This creates the `study_enrollments` table with RLS policies. Participants can see their own enrollment; only the service role can insert/modify enrollments.

---

## Enrolling participants

### Via API

Enroll a participant by email. The researcher must be authenticated and listed in `RESEARCHER_EMAILS`.

```bash
# Enroll a participant (auto-generates sequential participant ID)
curl -X POST https://your-app.vercel.app/api/admin/enroll \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{"email": "participant@example.com"}'

# Response:
# { "enrolled": { "id": "...", "user_id": "...", "cohort_key": "default",
#                  "participant_id": "P001", "enrolled_at": "...",
#                  "email": "participant@example.com" } }

# Enroll with a specific participant ID or cohort
curl -X POST https://your-app.vercel.app/api/admin/enroll \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{"email": "participant@example.com", "participant_id": "P042", "cohort_key": "spring-2026"}'
```

### Listing enrollments

```bash
curl https://your-app.vercel.app/api/admin/enroll?cohort=default \
  -H "Cookie: <your-session-cookie>"
```

### Practical workflow

1. Have each participant create an account on the app (standard sign-up flow).
2. Collect their email addresses.
3. Enroll each via the API endpoint above.
4. Participant IDs (`P001`, `P002`, ...) are generated sequentially and are stable for the duration of the study.

---

## Researcher ops page

Navigate to `/admin/study` while authenticated as a researcher. This page shows:

- Cohort enrollment status
- Per-participant activity summary (sessions and review events in the last 14 days)
- Export URL templates

Use `?cohort=spring-2026` to view a specific cohort.

---

## Exporting cohort data

### Full JSON export

```bash
curl "https://your-app.vercel.app/api/admin/progress/export?format=json&cohort=default&from=2026-04-11&to=2026-05-11" \
  -H "Cookie: <your-session-cookie>" \
  -o cohort-export.json
```

The JSON export contains:
- `format_version`: Same version string as single-user exports
- `cohort_key`: The cohort identifier
- `participant_count`: Number of enrolled participants
- `metric_definitions`: Full metric data dictionary
- `participants[]`: Array of per-participant export bundles, each with:
  - `anonymous_user_id`: The stable `participant_id` (e.g., `P001`)
  - `summary`: Per-participant summary metrics
  - `datasets`: All dataset arrays (daily_aggregates, sessions, review_events, etc.)

### CSV export (per dataset)

```bash
curl "https://your-app.vercel.app/api/admin/progress/export?format=csv&dataset=daily_aggregates&cohort=default&from=2026-04-11&to=2026-05-11" \
  -H "Cookie: <your-session-cookie>" \
  -o cohort-daily-aggregates.csv
```

CSV exports merge all participants into a single file with an `anonymous_user_id` column. Available datasets:
- `daily_aggregates`
- `sessions`
- `review_events`
- `reading_events`
- `listening_events`
- `saved_words`
- `export_runs`

---

## Running the analysis pipeline

The analysis pipeline (`analysis/build_report.py`) automatically detects cohort exports and handles them:

```bash
cd analysis
python build_report.py ../cohort-export.json
```

For cohort exports, the pipeline:
1. Writes `per_participant_summary.csv` with per-participant totals
2. Aggregates daily data across participants for time-series figures
3. Generates the same set of dissertation-ready figures and tables

---

## Participant ID semantics

- **Participant IDs** (`P001`, `P002`, ...) are the stable identifiers used in exports and all research outputs. They are stored in `study_enrollments.participant_id` and used as the `anonymous_user_id` in cohort export datasets.
- These are **independent** of the single-user export's `anonymizeUserId()` function, which uses a SHA-256 hash of the real user ID. Cohort exports use the enrollment-assigned participant ID instead.
- Participant IDs are unique within a cohort and are assigned at enrollment time.

---

## Access control

- **Researcher access**: Controlled by the `RESEARCHER_EMAILS` environment variable. Only authenticated users whose email appears in this list can access `/api/admin/*` routes and the `/admin/study` page.
- **Service role**: The `SUPABASE_SERVICE_ROLE_KEY` is required for cross-user queries. It bypasses RLS and must never be exposed to the client.
- **Participant access**: Participants access the app normally. They cannot see other participants' data (RLS enforced). They can see their own enrollment record.

---

## Cohorts

The system supports multiple cohorts via the `cohort_key` field. The default cohort is `"default"`. To run multiple cohorts:

1. Enroll participants with different `cohort_key` values.
2. Export each cohort separately using the `?cohort=` query parameter.
3. The ops page shows one cohort at a time (`?cohort=spring-2026`).

---

## Troubleshooting

| Problem | Check |
|---|---|
| "RESEARCHER_EMAILS is not configured" | Set the `RESEARCHER_EMAILS` env var on your server |
| "SUPABASE_SERVICE_ROLE_KEY is not configured" | Set the service role key from Supabase dashboard |
| "Not authorised as a researcher" | Ensure your email matches one in `RESEARCHER_EMAILS` (case-insensitive) |
| "No user found with email" | The participant must have created an account first |
| "User is already enrolled" | Each user can only be enrolled once per cohort |
| Empty export | Check date range; participants may not have any activity in the requested period |
