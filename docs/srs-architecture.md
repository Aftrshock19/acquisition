# SRS v2 Architecture

## Source of truth

The **`record_review` Postgres RPC** (in `supabase/migrations/`) is the only
authoritative scheduler at runtime. No TypeScript code independently re-derives
scheduling decisions.

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
| `difficulty` | `[0.15, 0.95]` | Word-specific difficulty (default 0.55) |
| `stability_days` | `>= 0, capped at 365` | Expected retention horizon in days |
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

| Value | When |
|-------|------|
| `first_clean_success` | First-ever correct answer on first try (word was `new`) |
| `second_clean_success` | Second consecutive first-try correct (big stability jump) |
| `later_clean_review` | Any subsequent first-try correct (multiplicative growth) |
| `rescued_success` | Correct after at least one same-session retry (modest growth) |
| `incorrect_lapse` | Wrong answer (stability shrinks, difficulty increases) |

Historical rows (before this column was added) have `scheduler_outcome = NULL`.

---

## Same-session retries vs. cross-day scheduling

**Same-session retries** are managed entirely in the client by `RetryQueue`
(`lib/srs/retryQueue.ts`):
- Incorrect cards reappear after `RETRY_GAP = 5` other answer events.
- Maximum `MAX_RETRIES = 2` same-session retries per card.
- The retry queue uses an answer *count*, not a wall-clock timer.
- Retries are recorded with `queue_source = 'retry'` and do **not** increment
  the daily flashcard completion counter.
- A rescued card (`first_try = false`) gets a smaller stability boost than a
  clean first-try success.

**Cross-day scheduling** is the interval stored in `next_due`, computed by
the `record_review` RPC. The next session loads cards whose `next_due <= now()`.

---

## Interval growth and caps

| Path | Stability change | next_due |
|------|-----------------|----------|
| first_clean_success | set to max(current, 2 days) | now + 2 days |
| second_clean_success | max(6, stability × 3), capped 365 | now + stability |
| later_clean_review | stability × (1.8 + 0.8×(1−difficulty) [+ 0.15 streak bonus]), capped 365 | now + stability |
| rescued_success | stability × 1.2, capped 365, min 1 | now + 1 day |
| incorrect_lapse | stability × 0.35, min 0.5 | now + 1 day |

Hard cap: `MAX_STABILITY_DAYS = 365`. No card is ever scheduled more than a
year out. A guardrail ensures `next_due >= now + 1 hour` in all cases.

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
  `20260410160002`.
- The reference TS scheduler (`processReview`) and the SQL RPC must be kept in
  sync manually. A divergence will be caught by the test suite but not at
  build time.
