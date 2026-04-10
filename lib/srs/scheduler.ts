/**
 * SRS v2 reference implementation.
 *
 * ⚠️  RUNTIME AUTHORITY: The Postgres `record_review` RPC is the ONLY
 * authoritative scheduler at runtime.  This file exists for:
 *   1. Shared named constants (imported by both tests and the migration).
 *   2. A reference implementation used in tests to document and guard
 *      expected scheduling behaviour.  It is NOT called at runtime.
 *
 * When updating scheduling logic, change the SQL RPC first, then keep this
 * file in sync so the test suite catches regressions.
 *
 * See docs/srs-architecture.md for the full design rationale.
 */

import type { SrsWordState, SrsReviewOutcome, SrsSchedulerResult } from "./types";

// ---------------------------------------------------------------------------
// Named constants — shared with the SQL migration (keep in sync)
// ---------------------------------------------------------------------------

/** Default difficulty for a brand-new word */
export const DEFAULT_DIFFICULTY = 0.55;
export const DIFFICULTY_MIN = 0.15;
export const DIFFICULTY_MAX = 0.95;

/** After first-ever clean success: schedule 2 days out */
export const FIRST_CLEAN_STABILITY_DAYS = 2;
/** After second consecutive clean success: at least 6 days */
export const SECOND_CLEAN_MIN_STABILITY_DAYS = 6;
/** Multiplier for second consecutive clean success */
export const SECOND_CLEAN_STABILITY_MULTIPLIER = 3;

/** Base growth factor for later clean reviews */
export const REVIEW_GROWTH_BASE = 1.8;
/** Extra growth scaling by (1 - difficulty) */
export const REVIEW_GROWTH_DIFFICULTY_SCALE = 0.8;
/** Bonus for consecutive first-try streaks >= 2 */
export const STREAK_BONUS = 0.15;

/**
 * Hard upper cap for stability_days.
 * No card will be scheduled more than this many days out.
 * Keep in sync with LEAST(365, ...) in the SQL record_review function.
 */
export const MAX_STABILITY_DAYS = 365;

/** Rescued-correct stability multiplier (much less than clean) */
export const RESCUED_STABILITY_MULTIPLIER = 1.2;

/** Incorrect: shrink stability by this factor */
export const INCORRECT_STABILITY_SHRINK = 0.35;
/** Minimum stability after failure */
export const INCORRECT_MIN_STABILITY = 0.5;

// Difficulty deltas
export const DIFF_DELTA_FIRST_CLEAN = -0.08;
export const DIFF_DELTA_SECOND_CLEAN = -0.05;
export const DIFF_DELTA_LATER_CLEAN = -0.02;
export const DIFF_DELTA_RESCUED = -0.01;
export const DIFF_DELTA_INCORRECT = 0.08;

// Difficulty floors per outcome
export const DIFF_FLOOR_FIRST_CLEAN = 0.30;
export const DIFF_FLOOR_SECOND_CLEAN = 0.20;
export const DIFF_FLOOR_LATER_CLEAN = DIFFICULTY_MIN;
export const DIFF_FLOOR_RESCUED = 0.20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampDifficulty(d: number): number {
  return Math.max(DIFFICULTY_MIN, Math.min(DIFFICULTY_MAX, d));
}

function clampStability(s: number): number {
  return Math.max(0, Math.min(MAX_STABILITY_DAYS, s));
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function newWordState(): SrsWordState {
  return {
    srs_state: "new",
    difficulty: DEFAULT_DIFFICULTY,
    stability_days: 0,
    learned_level: 0,
    reps: 0,
    lapses: 0,
    successful_first_try_reviews: 0,
    consecutive_first_try_correct: 0,
    last_reviewed_at: null,
    next_due: new Date().toISOString(),
    last_result: null,
    last_was_first_try: false,
  };
}

// ---------------------------------------------------------------------------
// Reference implementation (used in tests only — NOT called at runtime)
// ---------------------------------------------------------------------------

/**
 * Reference implementation of the SRS v2 scheduler.
 *
 * This mirrors the logic in the `record_review` Postgres RPC.  Tests import
 * this to validate expected scheduling behaviour and to detect regressions
 * when the SQL logic changes.
 *
 * Do not call this from application code. Use `record_review` RPC instead.
 */
export function processReview(
  state: SrsWordState,
  outcome: SrsReviewOutcome,
  now: Date = new Date(),
): SrsSchedulerResult {
  const s: SrsWordState = { ...state };
  const nowIso = now.toISOString();

  if (outcome.correct) {
    if (outcome.first_try) {
      return handleCleanSuccess(s, now, nowIso);
    }
    return handleRescuedSuccess(s, now, nowIso);
  }

  return handleIncorrect(s, now, nowIso);
}

function handleCleanSuccess(
  s: SrsWordState,
  now: Date,
  nowIso: string,
): SrsSchedulerResult {
  const isFirstEver = s.srs_state === "new" || (s.reps === 0 && s.lapses === 0);
  const isSecondClean =
    !isFirstEver &&
    s.consecutive_first_try_correct === 1 &&
    s.last_was_first_try;

  if (isFirstEver) {
    s.difficulty = clampDifficulty(
      Math.max(DIFF_FLOOR_FIRST_CLEAN, s.difficulty + DIFF_DELTA_FIRST_CLEAN),
    );
    s.learned_level += 2;
    s.stability_days = Math.max(s.stability_days, FIRST_CLEAN_STABILITY_DAYS);
    s.srs_state = "review";
    s.consecutive_first_try_correct = (s.consecutive_first_try_correct ?? 0) + 1;
    s.successful_first_try_reviews = (s.successful_first_try_reviews ?? 0) + 1;
    s.reps += 1;
    s.last_result = "correct";
    s.last_was_first_try = true;
    s.last_reviewed_at = nowIso;
    s.next_due = addDays(now, FIRST_CLEAN_STABILITY_DAYS);
  } else if (isSecondClean) {
    s.difficulty = clampDifficulty(
      Math.max(DIFF_FLOOR_SECOND_CLEAN, s.difficulty + DIFF_DELTA_SECOND_CLEAN),
    );
    s.learned_level += 2;
    s.stability_days = clampStability(
      Math.max(
        SECOND_CLEAN_MIN_STABILITY_DAYS,
        s.stability_days * SECOND_CLEAN_STABILITY_MULTIPLIER,
      ),
    );
    s.srs_state = "review";
    s.consecutive_first_try_correct += 1;
    s.successful_first_try_reviews += 1;
    s.reps += 1;
    s.last_result = "correct";
    s.last_was_first_try = true;
    s.last_reviewed_at = nowIso;
    s.next_due = addDays(now, s.stability_days);
  } else {
    let growth = REVIEW_GROWTH_BASE + (1 - s.difficulty) * REVIEW_GROWTH_DIFFICULTY_SCALE;
    if (s.consecutive_first_try_correct >= 2) {
      growth += STREAK_BONUS;
    }
    s.stability_days = clampStability(
      Math.max(s.stability_days + 1, s.stability_days * growth),
    );
    s.difficulty = clampDifficulty(
      Math.max(DIFF_FLOOR_LATER_CLEAN, s.difficulty + DIFF_DELTA_LATER_CLEAN),
    );
    s.learned_level += 1;
    s.srs_state = "review";
    s.consecutive_first_try_correct += 1;
    s.successful_first_try_reviews += 1;
    s.reps += 1;
    s.last_result = "correct";
    s.last_was_first_try = true;
    s.last_reviewed_at = nowIso;
    s.next_due = addDays(now, s.stability_days);
  }

  return { state: s, next_due: s.next_due };
}

function handleRescuedSuccess(
  s: SrsWordState,
  now: Date,
  nowIso: string,
): SrsSchedulerResult {
  s.difficulty = clampDifficulty(
    Math.max(DIFF_FLOOR_RESCUED, s.difficulty + DIFF_DELTA_RESCUED),
  );
  if (s.learned_level > 0) {
    s.learned_level += 1;
  }
  s.stability_days = clampStability(
    Math.max(1, s.stability_days * RESCUED_STABILITY_MULTIPLIER),
  );
  s.consecutive_first_try_correct = 0;
  s.reps += 1;
  s.srs_state = s.stability_days < 2 ? "learning" : "review";
  s.last_result = "correct";
  s.last_was_first_try = false;
  s.last_reviewed_at = nowIso;
  s.next_due = addDays(now, 1);

  return { state: s, next_due: s.next_due };
}

function handleIncorrect(
  s: SrsWordState,
  now: Date,
  nowIso: string,
): SrsSchedulerResult {
  s.difficulty = clampDifficulty(
    Math.min(DIFFICULTY_MAX, s.difficulty + DIFF_DELTA_INCORRECT),
  );
  s.learned_level = Math.max(0, s.learned_level - 1);
  s.stability_days = clampStability(
    Math.max(INCORRECT_MIN_STABILITY, s.stability_days * INCORRECT_STABILITY_SHRINK),
  );
  s.lapses += 1;
  s.consecutive_first_try_correct = 0;
  s.last_result = "incorrect";
  s.last_was_first_try = false;
  s.srs_state = "learning";
  s.last_reviewed_at = nowIso;
  s.next_due = addDays(now, 1);

  return { state: s, next_due: s.next_due };
}
