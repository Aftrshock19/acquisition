/**
 * SRS v2 scheduler tests.
 *
 * These tests validate the REFERENCE IMPLEMENTATION in lib/srs/scheduler.ts,
 * which mirrors the authoritative logic in the `record_review` Postgres RPC.
 *
 * Purpose:
 *   - Document the expected scheduling behaviour for each path.
 *   - Catch regressions if the reference implementation drifts from the SQL.
 *
 * When you change the SQL `record_review` function, update both the reference
 * implementation AND these tests to match.
 */

import { describe, it, expect } from "vitest";
import {
  processReview,
  newWordState,
  DEFAULT_DIFFICULTY,
  MAX_STABILITY_DAYS,
} from "./scheduler";
import type { SrsWordState, SrsReviewOutcome } from "./types";

function makeState(overrides: Partial<SrsWordState> = {}): SrsWordState {
  return { ...newWordState(), ...overrides };
}

function cleanSuccess(retryIndex = 0): SrsReviewOutcome {
  return { correct: true, first_try: true, retry_index: retryIndex };
}

function rescuedSuccess(retryIndex = 1): SrsReviewOutcome {
  return { correct: true, first_try: false, retry_index: retryIndex };
}

function incorrect(): SrsReviewOutcome {
  return { correct: false, first_try: false, retry_index: 0 };
}

const NOW = new Date("2026-04-10T12:00:00Z");

// ---------------------------------------------------------------------------
// Scheduler path: first_clean_success
// ---------------------------------------------------------------------------
describe("first_clean_success path", () => {
  it("sets stability to 2 days and schedules 2 days out", () => {
    const state = makeState();
    const result = processReview(state, cleanSuccess(), NOW);

    expect(result.state.stability_days).toBe(2);
    expect(result.state.srs_state).toBe("review");
    expect(result.state.learned_level).toBe(2);
    expect(result.state.difficulty).toBeLessThan(DEFAULT_DIFFICULTY);
    expect(result.state.consecutive_first_try_correct).toBe(1);
    expect(result.state.successful_first_try_reviews).toBe(1);
    expect(result.state.last_was_first_try).toBe(true);

    const diffDays = (new Date(result.next_due).getTime() - NOW.getTime()) / 86400000;
    expect(diffDays).toBeCloseTo(2, 0);
  });

  it("does not mark the word as permanently learned", () => {
    const result = processReview(makeState(), cleanSuccess(), NOW);
    expect(result.state.stability_days).toBeLessThan(100);
    expect(result.state.learned_level).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Scheduler path: second_clean_success
// ---------------------------------------------------------------------------
describe("second_clean_success path", () => {
  const secondCleanState = makeState({
    srs_state: "review",
    reps: 1,
    stability_days: 2,
    learned_level: 2,
    consecutive_first_try_correct: 1,
    last_was_first_try: true,
    difficulty: 0.47,
    successful_first_try_reviews: 1,
  });

  it("schedules at least 6 days out with a big stability jump", () => {
    const result = processReview(secondCleanState, cleanSuccess(), NOW);
    expect(result.state.stability_days).toBeGreaterThanOrEqual(6);
    expect(result.state.learned_level).toBe(4);
    expect(result.state.consecutive_first_try_correct).toBe(2);
  });

  it("schedules longer than a rescued success from the same state", () => {
    const cleanResult = processReview(secondCleanState, cleanSuccess(), NOW);
    const rescuedResult = processReview(secondCleanState, rescuedSuccess(), NOW);
    expect(cleanResult.state.stability_days).toBeGreaterThan(rescuedResult.state.stability_days);
  });
});

// ---------------------------------------------------------------------------
// Scheduler path: later_clean_review
// ---------------------------------------------------------------------------
describe("later_clean_review path", () => {
  it("grows stability multiplicatively (>= 1.8x)", () => {
    const state = makeState({
      srs_state: "review",
      reps: 5,
      stability_days: 10,
      learned_level: 5,
      consecutive_first_try_correct: 3,
      last_was_first_try: true,
      difficulty: 0.35,
      successful_first_try_reviews: 5,
    });
    const result = processReview(state, cleanSuccess(), NOW);
    expect(result.state.stability_days).toBeGreaterThan(10 * 1.8);
  });
});

// ---------------------------------------------------------------------------
// Scheduler path: rescued_success
// ---------------------------------------------------------------------------
describe("rescued_success path", () => {
  it("grows stability modestly (1.2x) and schedules tomorrow", () => {
    const state = makeState({
      srs_state: "learning",
      reps: 2,
      stability_days: 3,
      learned_level: 2,
      consecutive_first_try_correct: 0,
      difficulty: 0.55,
    });
    const result = processReview(state, rescuedSuccess(), NOW);

    expect(result.state.stability_days).toBeCloseTo(3.6, 1);
    expect(result.state.consecutive_first_try_correct).toBe(0);
    expect(result.state.last_was_first_try).toBe(false);

    const diffDays = (new Date(result.next_due).getTime() - NOW.getTime()) / 86400000;
    expect(diffDays).toBeCloseTo(1, 0);
  });

  it("does not increment learned_level from 0", () => {
    const state = makeState({ srs_state: "learning", reps: 1, stability_days: 1, learned_level: 0 });
    expect(processReview(state, rescuedSuccess(), NOW).state.learned_level).toBe(0);
  });

  it("increments learned_level when > 0", () => {
    const state = makeState({ srs_state: "review", reps: 3, stability_days: 5, learned_level: 3 });
    expect(processReview(state, rescuedSuccess(), NOW).state.learned_level).toBe(4);
  });

  it("rescued success is NOT marked as first_try", () => {
    const state = makeState({ srs_state: "learning", reps: 1, stability_days: 1 });
    expect(processReview(state, rescuedSuccess(), NOW).state.last_was_first_try).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scheduler path: incorrect_lapse
// ---------------------------------------------------------------------------
describe("incorrect_lapse path", () => {
  it("increases difficulty and shrinks stability", () => {
    const state = makeState({
      srs_state: "review",
      reps: 5,
      stability_days: 20,
      learned_level: 4,
      difficulty: 0.40,
    });
    const result = processReview(state, incorrect(), NOW);

    expect(result.state.difficulty).toBeGreaterThan(0.40);
    expect(result.state.difficulty).toBeCloseTo(0.48, 1);
    expect(result.state.stability_days).toBeCloseTo(7, 0); // 20 * 0.35
    expect(result.state.learned_level).toBe(3);
    expect(result.state.lapses).toBe(1);
    expect(result.state.srs_state).toBe("learning");
    expect(result.state.consecutive_first_try_correct).toBe(0);
  });

  it("schedules for tomorrow", () => {
    const result = processReview(makeState({ srs_state: "review", stability_days: 10 }), incorrect(), NOW);
    const diffDays = (new Date(result.next_due).getTime() - NOW.getTime()) / 86400000;
    expect(diffDays).toBeCloseTo(1, 0);
  });

  it("has minimum stability of 0.5 days", () => {
    const result = processReview(makeState({ srs_state: "learning", stability_days: 0.5 }), incorrect(), NOW);
    expect(result.state.stability_days).toBeGreaterThanOrEqual(0.5);
  });

  it("caps difficulty at 0.95", () => {
    const result = processReview(makeState({ difficulty: 0.93 }), incorrect(), NOW);
    expect(result.state.difficulty).toBeLessThanOrEqual(0.95);
  });
});

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------
describe("guardrails", () => {
  it("next_due always moves forward", () => {
    for (const outcome of [cleanSuccess(), rescuedSuccess(), incorrect()]) {
      const result = processReview(makeState(), outcome, NOW);
      expect(new Date(result.next_due).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it("no stuck immediate-due loop: always >= 1 day forward after correct", () => {
    let state = makeState();
    for (let i = 0; i < 10; i++) {
      const result = processReview(state, cleanSuccess(), NOW);
      const diffDays = (new Date(result.next_due).getTime() - NOW.getTime()) / 86400000;
      expect(diffDays).toBeGreaterThanOrEqual(1);
      state = result.state;
    }
  });

  it(`stability_days is capped at MAX_STABILITY_DAYS (${MAX_STABILITY_DAYS})`, () => {
    const state = makeState({
      srs_state: "review",
      reps: 20,
      stability_days: 300,
      learned_level: 10,
      consecutive_first_try_correct: 10,
      last_was_first_try: true,
      difficulty: 0.15,
      successful_first_try_reviews: 20,
    });
    const result = processReview(state, cleanSuccess(), NOW);
    expect(result.state.stability_days).toBeLessThanOrEqual(MAX_STABILITY_DAYS);
  });

  it("rescued correct is never counted as first_try", () => {
    const state = makeState({ srs_state: "learning", reps: 2, stability_days: 3 });
    const result = processReview(state, rescuedSuccess(), NOW);
    expect(result.state.last_was_first_try).toBe(false);
    expect(result.state.consecutive_first_try_correct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Path ordering: degraded vs clean
// ---------------------------------------------------------------------------
describe("degraded path recovers slower than clean path", () => {
  it("4 failures + 1 rescued << 2 clean successes", () => {
    let cleanState = makeState();
    cleanState = processReview(cleanState, cleanSuccess(), NOW).state;
    cleanState = processReview(cleanState, cleanSuccess(), NOW).state;

    let degradedState = makeState();
    for (let i = 0; i < 4; i++) {
      degradedState = processReview(degradedState, incorrect(), NOW).state;
    }
    degradedState = processReview(degradedState, rescuedSuccess(), NOW).state;

    expect(cleanState.stability_days).toBeGreaterThan(degradedState.stability_days);
    expect(cleanState.learned_level).toBeGreaterThan(degradedState.learned_level);
    expect(cleanState.difficulty).toBeLessThan(degradedState.difficulty);
  });
});

// ---------------------------------------------------------------------------
// Outcome label semantics (mirrors SQL scheduler_outcome values)
// ---------------------------------------------------------------------------
describe("outcome path semantics", () => {
  it("brand new word → first_clean_success: stability=2, state=review", () => {
    const result = processReview(makeState(), cleanSuccess(), NOW);
    expect(result.state.srs_state).toBe("review");
    expect(result.state.stability_days).toBe(2);
    expect(result.state.last_was_first_try).toBe(true);
  });

  it("second consecutive clean → much larger stability jump than first", () => {
    let state = makeState();
    state = processReview(state, cleanSuccess(), NOW).state; // first_clean
    const secondResult = processReview(state, cleanSuccess(), NOW);
    expect(secondResult.state.stability_days).toBeGreaterThanOrEqual(6);
  });

  it("rescued success: consecutive_first_try_correct resets to 0", () => {
    let state = makeState({ consecutive_first_try_correct: 3, last_was_first_try: true });
    state = processReview(state, rescuedSuccess(), NOW).state;
    expect(state.consecutive_first_try_correct).toBe(0);
  });

  it("incorrect_lapse: lapses counter increments", () => {
    const state = makeState({ lapses: 2 });
    const result = processReview(state, incorrect(), NOW);
    expect(result.state.lapses).toBe(3);
  });

  it("retries do not inflate successful_first_try_reviews", () => {
    const state = makeState({ successful_first_try_reviews: 5, reps: 5 });
    const result = processReview(state, rescuedSuccess(), NOW);
    expect(result.state.successful_first_try_reviews).toBe(5); // unchanged
  });
});
