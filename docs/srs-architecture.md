# SRS v2 Architecture

## Source of truth

The **`record_review` Postgres RPC** (in `supabase/migrations/`) is the only
authoritative scheduler at runtime. No TypeScript code independently re-derives
scheduling decisions.

The live definition is the one in the **newest** migration that creates the
function (currently
`20261102120000_daily_loop_completion_and_scheduler_outcome.sql`). The SQL
parity tests locate that file automatically (`lib/srs/migrationSql.testSupport.ts`)
rather than reading a fixed, possibly superseded, migration.

`lib/srs/scheduler.ts` contains:
- Named constants (shared with the SQL migration — keep in sync).
- A **reference implementation** (`processReview`) used only in tests to
  document and guard expected behaviour. It is never called at runtime.

When updating scheduling logic, change the SQL first, then sync the constants
and reference implementation so the test suite catches regressions.

---

## Hidden per-word state (`user_words`)

| Column | Type | Meaning |
|--------|------|---------|
| `srs_state` | `new / learning / review` | Stage in the acquisition lifecycle |
| `difficulty` | `[0.15, 0.95]` | Word-specific difficulty (column default 0.5; the RPC falls back to 0.55 only for NULL) |
| `stability_days` | `>= 0, capped at 730` | Expected retention horizon in days |
| `learned_level` | `integer >= 0` | Ladder proxy for acquisition depth |
| `successful_first_try_reviews` | integer | Correct-on-first-try review count |
| `consecutive_first_try_correct` | integer | Current clean-review streak |
| `last_was_first_try` | boolean | Whether the last review was first-try |
| `last_result` | `correct / incorrect / null` | Most recent outcome |
| `next_due` | timestamptz | When to next show this card |

`due_at` is kept in sync with `next_due` for backward compatibility.

---

## Scheduler outcomes (`review_events.scheduler_outcome`)

Every review event records which scheduling path fired:

| Value | When (live `record_review` branch) |
|-------|------|
| `first_clean_success` | `correct AND first_try` and the word was `new` (first-ever clean answer) |
| `second_clean_success` | `correct AND first_try`, `consecutive_first_try_correct = 1` and the previous review was first-try |
| `later_clean_review` | Any other `correct AND first_try` (multiplicative growth) |
| `rescued_success` | `correct AND NOT first_try` (same-session retry answered correctly) |
| `incorrect_lapse` | Every other answer (wrong answer: stability shrinks, difficulty increases) |

The allowed values are enforced by `review_events_scheduler_outcome_check`
(added in `20260410160002`).

**Gap in the pilot data.** `20260410160002` added the column and wrote it,
but the adaptive redefinition of `record_review` in `20260411140000` (copied
verbatim by `20260428130000`) dropped the assignment. Every review from
2026-04-11 until `20261102120000` was applied therefore has
`scheduler_outcome = NULL`. `20261102120000` writes it again on every branch.

The missing values can be recovered exactly, because the live RPC stores
`difficulty_before`, `difficulty_after` and `baseline_interval_days` from the
same transaction and each branch moves difficulty by its own rule (see the
header of `lib/srs/schedulerOutcome.ts` for the proof, including the three
difficulty values where two clean rules coincide). The one case the row
cannot decide (second vs later clean at difficulty 0.22 with baseline >= 6)
is decided by the word's two preceding events; if those were not written by
a v2 scheduler the row stays `NULL`. The backfill is
`supabase/manual/backfill_scheduler_outcome.sql`: it is **not** a migration,
runs a dry-run first, only touches `scheduler_outcome IS NULL` rows and ends
in `ROLLBACK` until switched to `COMMIT` by hand. `deriveSchedulerOutcome` in
`lib/srs/schedulerOutcome.ts` is the tested TS mirror.

Rows written before `20260410160002`, or by any RPC that did not store
`difficulty_before`/`difficulty_after`/`baseline_interval_days`, stay `NULL`.

---

## Same-session retries vs. cross-day scheduling

**Same-session retries** are managed entirely in the client by `RetryQueue`
(`lib/srs/retryQueue.ts`):
- Incorrect cards reappear after `RETRY_GAP = 5` other answer events.
- Maximum `MAX_RETRIES = 2` same-session retries per card.
- The retry queue uses an answer *count*, not a wall-clock timer.
- Retries are recorded with `queue_source = 'retry'`. They increment
  `daily_sessions.flashcard_attempts_count` and `flashcard_retry_count` but
  not `flashcard_completed_count` (main queue only). The daily target is
  measured in attempts, so retries count towards it (see below).
- A rescued card (`first_try = false`) gets a smaller stability boost than a
  clean first-try success.

**Cross-day scheduling** is the interval stored in `next_due`, computed by
the `record_review` RPC. The next session loads cards whose `next_due <= now()`.

---

## Interval growth and caps

| Path | Stability change | next_due |
|------|-----------------|----------|
| first_clean_success | set to max(current, 2 days) | now + stability (2 days for a new word) |
| second_clean_success | max(6, stability × 3), capped 730 | now + stability |
| later_clean_review | max(stability + 1, stability × (1.8 + 0.8×(1−difficulty) [+ 0.15 streak bonus])), capped 730 | now + stability |
| rescued_success | max(1, stability × 1.2), capped 730 | now + 1 day |
| incorrect_lapse | stability × 0.35, min 0.5 | now + 1 day |

Hard cap: `MAX_STABILITY_DAYS = 730` (two years). This is what the live RPC
has used since `20260411140000` and therefore what the pilot ran with;
`20260410160002` briefly used 365, but that definition was replaced the next
day.

In the `adaptive` scheduler variant, clean paths then multiply the stability
by `clamp(learner_factor × item_factor, 0.80, 1.20)` and clamp the result to
`[0.5, 730]`; `review_events.baseline_interval_days` stores the value before
the multiplier and `effective_interval_days` the interval actually scheduled.
The live RPC has no separate one-hour `next_due` guardrail (that existed only
in `20260410160002`).

---

## Daily loop stage (`daily_sessions`)

The SQL `record_review` CASE and the TS `resolveDailySessionStage`
(`lib/loop/dailySessionStage.ts`, used by every `daily_sessions` writer in
`app/actions/srs.ts`) implement the same rule:

```
flashcards_pending := flashcard_attempts_count < assigned_flashcard_count
                      AND flashcards_skipped_at IS NULL
stage := 'flashcards' if flashcards_pending
         else 'reading'   if NOT reading_done
         else 'listening' if NOT listening_done
         else 'completed'
completed := (stage = 'completed')
```

- **Units are attempts** (main + retry), matching the client session cap in
  `TodaySession`. Before `20261102120000` the server compared main-queue
  completions only, so a day with mistakes could stay `stage='flashcards'`,
  `completed=false` after the client had ended the session.
- **Client cap = stored target.** `getTodayFlashcards` returns the stored
  `assigned_flashcard_count` as `dailyLimit`, so the client ends the sitting
  exactly when the server leaves `flashcards` (in recommended mode the stored
  target is the queue actually assigned, often below `effectiveDailyLimit`).
  The in-session "Do more flashcards" raises only that sitting's cap.
- **`flashcards_completed_at`** is set the first time flashcards stop being
  pending (including via skip); **`completed_at`** the first time the stage
  reaches `completed`. Neither is ever cleared.
- **Skip** ("No more words available → Continue to reading") sets
  `flashcards_skipped_at` (and `flashcards_completed_at` if unset). Writing
  only `stage` was undone by the `/today` re-render, which re-derives the
  stage from the counters. `TodaySession` persists the same skip
  (`skipFlashcardsAfterSession`) when a sitting reaches its practice-complete
  screen below the target with nothing left to load, e.g. a manual target
  larger than the word supply; its "Go to reading" link would otherwise leave
  the day pending.
- **Do more flashcards** clears `flashcards_skipped_at` and raises
  `assigned_flashcard_count` to `max(assigned, attempts) + count`, which sets
  `stage='flashcards'` and `completed=false` for routing only. After a skip
  the target is re-based to `attempts + count`, so only `count` more are owed.
  It keeps `flashcards_completed_at` and `completed_at`. In manual mode the
  new target is mirrored into `user_settings.manual_daily_card_limit` only if
  it raises it.
- **Manual targets** store the full target in `assigned_flashcard_count`
  (e.g. 100), not the first 50-card load chunk.
- **Session date.** The client passes the `session_date` of the row it loaded
  as `p_session_date`; the RPC accepts only today or yesterday in the app
  session time zone (`Europe/London`, `APP_SESSION_TIME_ZONE`) and otherwise
  uses today, so one sitting never splits across midnight.

For research metrics use the derived `loop_completed` definition in
`lib/analytics/metricDefinitions.ts`, not the live `completed` flag, which
steps back to `false` while an extended day is in progress.

---

## Workload policy

`lib/srs/workloadPolicy.ts` computes how many cards to show each session.

### Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `NORMAL_REVIEW_BUDGET_MS` | 360 000 | Target session length in ms (6 min) |
| `COMEBACK_REVIEW_BUDGET_MS` | 480 000 | Comeback session budget (8 min) |
| `P50_FALLBACK_MS` | 18 000 | Assumed review speed when no history |
| `CONTINUATION_REVIEW_CHUNK` | 12 | Extra reviews per "load more" click |
| `CONTINUATION_NEW_CHUNK` | 5 | Extra new words per "load more" click |
| `COMEBACK_DAYS_THRESHOLD` | 7 | Days absent before comeback mode triggers |

### Batch sizing

`p50ReviewMs` is the median of the last 200 correct review `ms_spent` values.

```
normalBatch   = clamp(floor(360 000 / p50), 12, 30)
comebackBatch = clamp(floor(480 000 / p50), 18, 40)
```

### Comeback mode

Triggers when **either**:
- `daysSinceLastSession >= 7`, or
- `overdueCount >= 3 × normalBatch`

In comeback mode:
- `recommendedReviews = comebackBatch`
- `recommendedNewWords = min(scheduledNewCount, 3)` — new words throttled

### Priority ordering (SQL)

Due reviews are ordered by forgetting-risk score (highest first):

```sql
(
  GREATEST(0, EXTRACT(epoch FROM (now() - next_due)) / 86400.0)
    / GREATEST(1, stability_days)
    * (0.75 + difficulty)
    * CASE WHEN srs_state = 'learning' THEN 1.35 ELSE 1.0 END
  + CASE WHEN last_result = 'incorrect' THEN 0.25 ELSE 0 END
  + CASE WHEN last_was_first_try = false AND last_result = 'correct' THEN 0.15 ELSE 0 END
) DESC, word_id ASC
```

### Continuation

After the recommended batch is finished, the UI shows "Load more" buttons. Each
click calls `loadMoreReviewChunk` or `loadMoreNewWordsChunk` (server actions),
which call `get_daily_queue` with `p_exclude_word_ids` set to all word IDs
already seen in the session. There is **no hard ceiling** — users can always
keep going.

---

## Known limitations

- The `retryDelaySeconds` DB column still exists but is a no-op. The UI no
  longer surfaces it. It can be removed in a future migration once confirmed
  safe to drop.
- `scheduler_outcome` is `NULL` for all events recorded before migration
  `20260410160002`, and for events from 2026-04-11 until `20261102120000`
  unless `supabase/manual/backfill_scheduler_outcome.sql` has been run.
- The reference TS scheduler (`processReview`) and the SQL RPC must be kept in
  sync manually. A divergence will be caught by the test suite but not at
  build time.
