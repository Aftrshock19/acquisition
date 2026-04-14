# Baseline vs. learning analytics — separation and joins

Short, authoritative reference for anyone running analysis on this project.
The baseline (placement) test and the SRS flashcard loop are intentionally
kept in different tables. Treat them as two datasets, not one stream.

## Datasets

| Table | Produced by | Row meaning |
|---|---|---|
| `baseline_test_runs` | Placement test | One row per run (start/complete/skip/abandon) |
| `baseline_test_responses` | Placement test | One row per diagnostic item answered |
| `review_events` | Flashcard SRS loop (`record_review` RPC) | One row per flashcard attempt (incl. retries) |
| `user_words` | Flashcard SRS loop | Current SRS state per (user, word) |
| `daily_sessions` | Daily workload builder | One row per (user, session_date) |
| `exposure_events` | Reading/listening exposure | One row per exposure to a word in context |
| `user_settings` | Onboarding + recalibration | Includes `current_frontier_rank`, `baseline_test_run_id`, `placement_status` |

Two invariants that hold today:

1. **Baseline never writes to `review_events` or `user_words`.** A baseline
   answer is recorded in `baseline_test_responses` and nothing else in the
   SRS path. The only crossover is `user_settings.current_frontier_rank`,
   which is a scalar used by the new-word picker.
2. **`record_review` is the single writer of SRS scheduling fields.** No
   other code path mutates `next_due`, `stability_days`, `difficulty`,
   `reps`, `lapses`, `last_reviewed_at`, or `srs_state`.

## Do not sum baseline and learning accuracy

`flashcard_accuracy` in exports is derived from `review_events` only.
Diagnostic item accuracy lives in `baseline_test_responses.is_correct`
and is exported separately. They are not comparable:

- Baseline items are sampled by frequency band with recognition/recall
  prompts; they probe a *prior*, not ongoing learning.
- Flashcard reviews use cloze / MCQ / typing with SRS-scheduled spacing.

If you need a combined measure, compute it explicitly and call it out in
the methods section. Never fold baseline responses into review_events.

## Day-1-post-baseline joins

To isolate the first flashcard session after placement:

```sql
-- Baseline completion timestamp lives on user_settings (snapshot of the
-- latest completed run) and on baseline_test_runs.completed_at.
select
  ds.*,
  (ds.session_date = (btr.completed_at at time zone 'utc')::date)
    as is_post_baseline_day_one
from daily_sessions ds
join user_settings us on us.user_id = ds.user_id
left join baseline_test_runs btr
  on btr.id = us.baseline_test_run_id
where ds.user_id = :user_id
order by ds.session_date;
```

Relevant fields for this join:

- `user_settings.baseline_test_run_id` — the run whose frontier is currently
  active.
- `user_settings.current_frontier_rank` / `_low` / `_high` — the frontier in
  effect at read time (may have been recalibrated; see
  `placement_last_recalibrated_at` and `placement_recalibration_trace`).
- `baseline_test_runs.completed_at` — canonical baseline completion time.

## Recalibration semantics

`lib/placement/recalibrate.ts` (`recalibratePlacementForUser`) runs at
session completion and can overwrite `current_frontier_rank`. It requires
≥8 review events or ≥3 reading-question attempts in the last 10 days.
Immediately after placement there is no evidence, so the frontier on day
1 is always the baseline estimate. Analysts should expect the frontier
column to evolve over the first week.

## Retry semantics in review_events

In-session retries after an incorrect answer are persisted with
`queue_source = 'retry'` and `first_try = false`. Accuracy aggregates that
want "one attempt per card per session" should filter to `first_try = true`.
The retry budget is bounded by `MAX_RETRIES` (see `lib/srs/retryQueue.ts`);
pending retries survive page refresh via `localStorage` but are never
written to the database until the user actually submits the retry.

## Quick checklist before exporting

- Are you filtering `review_events` to exclude `queue_source = 'retry'` when
  computing first-try accuracy? If not, disclose that you used all attempts.
- Are you excluding runs with `status in ('skipped', 'abandoned')` from
  placement analyses?
- Are you handling users with no completed baseline (placement may be
  skipped) separately? `user_settings.placement_source = 'usage_only'`
  marks them.
