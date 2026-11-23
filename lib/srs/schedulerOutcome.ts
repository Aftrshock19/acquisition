/**
 * Recover review_events.scheduler_outcome for rows written while the live
 * record_review did not store it (2026-04-11 until migration
 * 20261102120000_daily_loop_completion_and_scheduler_outcome.sql).
 *
 * TS mirror of supabase/manual/backfill_scheduler_outcome.sql. The SQL file is
 * authoritative (exact numeric arithmetic); this mirror exists so the rules
 * can be unit-tested and reused in analysis code that receives JS numbers.
 *
 * Which branch fired is a function of word state the event row does not
 * store (srs_state, reps, lapses, consecutive_first_try_correct,
 * last_was_first_try). It is nevertheless recoverable exactly, because the
 * 18-param record_review writes difficulty_before / difficulty_after /
 * baseline_interval_days in the same transaction, and each branch moves
 * difficulty by its own rule:
 *
 *   incorrect_lapse       correct=false             after = LEAST(0.95, d + 0.08)
 *   rescued_success       correct, first_try=false  after = GREATEST(0.20, d - 0.01)
 *   first_clean_success   correct, first_try        after = GREATEST(0.30, d - 0.08), baseline = 2
 *   second_clean_success  correct, first_try        after = GREATEST(0.20, d - 0.05), baseline >= 6
 *   later_clean_review    correct, first_try        after = GREATEST(0.15, d - 0.02)
 *
 * The three clean rules give the same difficulty_after only at
 * d = 0.35 (first|second), d = 0.32 (first|later) and d = 0.22 (second|later).
 *   - first vs second: first_clean_success always stores baseline exactly 2
 *     (srs_state='new' implies stability_days <= 0.08, so GREATEST(s, 2) = 2),
 *     second always stores >= 6.
 *   - first vs later at d = 0.32: later stores GREATEST(s + 1, s * g) with
 *     g = 2.344 or 2.494. s = 1 gives 2.344, and s * g = 2 would need
 *     s = 250/293 or 1000/1247, which no finite numeric can hold, so a
 *     baseline of exactly 2 can only be first_clean_success.
 *   - second vs later at d = 0.22 with baseline >= 6 is the one case the row
 *     cannot decide. second_clean_success requires
 *     consecutive_first_try_correct = 1 AND last_was_first_try before the
 *     review, i.e. the previous event for the word was clean and the one
 *     before it was not. Every v2 scheduler sets consec +1 on clean paths and
 *     0 otherwise, so the two preceding events decide it, provided both were
 *     written by a v2 scheduler (difficulty_before or scheduler_outcome set).
 *     Otherwise the outcome stays null.
 *
 * Rows the live RPC did not write (no difficulty_before / difficulty_after /
 * baseline_interval_days) and rows whose columns contradict every branch
 * return null: nothing is guessed.
 */

export type SchedulerOutcome =
  | "first_clean_success"
  | "second_clean_success"
  | "later_clean_review"
  | "rescued_success"
  | "incorrect_lapse";

export type SchedulerOutcomeEvidence = {
  correct: boolean | null;
  first_try: boolean | null;
  difficulty_before: number | null;
  difficulty_after: number | null;
  baseline_interval_days: number | null;
  scheduler_outcome?: SchedulerOutcome | null;
};

const CLEAN_OUTCOMES: ReadonlySet<SchedulerOutcome> = new Set([
  "first_clean_success",
  "second_clean_success",
  "later_clean_review",
]);

// Difficulties are 2-decimal numerics in Postgres; JS subtraction adds
// ~1e-16 noise. Any real difference is >= 0.01.
const DIFFICULTY_EPSILON = 1e-9;

function sameDifficulty(a: number, b: number): boolean {
  return Math.abs(a - b) < DIFFICULTY_EPSILON;
}

type RowLevel = SchedulerOutcome | "second_or_later" | null;

/** Branch implied by the row's own columns, before looking at history. */
function classifyRow(event: SchedulerOutcomeEvidence): RowLevel {
  const d = event.difficulty_before;
  const after = event.difficulty_after;
  const baseline = event.baseline_interval_days;
  if (
    d == null ||
    after == null ||
    baseline == null ||
    event.correct == null ||
    event.first_try == null
  ) {
    return null;
  }

  if (!event.correct) {
    return sameDifficulty(after, Math.min(0.95, d + 0.08)) ? "incorrect_lapse" : null;
  }

  if (!event.first_try) {
    return sameDifficulty(after, Math.max(0.2, d - 0.01)) ? "rescued_success" : null;
  }

  const first = sameDifficulty(after, Math.max(0.3, d - 0.08)) && baseline === 2;
  const second = sameDifficulty(after, Math.max(0.2, d - 0.05)) && baseline >= 6;
  const later = sameDifficulty(after, Math.max(0.15, d - 0.02));

  // first wins over later at d = 0.32 (see header); first and second are
  // mutually exclusive through the baseline.
  if (first) return "first_clean_success";
  if (second && later) return "second_or_later";
  if (second) return "second_clean_success";
  if (later) return "later_clean_review";
  return null;
}

type PathClass = "clean" | "not_clean" | "unknown";

function classifyPath(event: SchedulerOutcomeEvidence): PathClass {
  if (event.scheduler_outcome) {
    return CLEAN_OUTCOMES.has(event.scheduler_outcome) ? "clean" : "not_clean";
  }
  const row = classifyRow(event);
  if (row === null) return "unknown";
  if (row === "second_or_later" || CLEAN_OUTCOMES.has(row)) return "clean";
  return "not_clean";
}

/**
 * @param event the review_events row to classify
 * @param priorEvents earlier review_events rows for the same (user, word),
 *   oldest first, ordered by created_at, submitted_at, id. Only consulted for
 *   the d = 0.22 second-vs-later case.
 */
export function deriveSchedulerOutcome(
  event: SchedulerOutcomeEvidence,
  priorEvents: readonly SchedulerOutcomeEvidence[] = [],
): SchedulerOutcome | null {
  const row = classifyRow(event);
  if (row !== "second_or_later") return row;

  const prev = priorEvents[priorEvents.length - 1];
  const prev2 = priorEvents[priorEvents.length - 2];
  const prevClass = prev ? classifyPath(prev) : null;
  if (prevClass === "not_clean") return "later_clean_review"; // consec was 0
  if (prevClass !== "clean") return null;

  const prev2Class = prev2 ? classifyPath(prev2) : null;
  if (prev2Class === "not_clean") return "second_clean_success"; // consec was 1
  if (prev2Class === "clean") return "later_clean_review"; // consec was >= 2
  return null;
}
