import { describe, it, expect } from "vitest";
import { computeFlashcardSummary } from "./dailySummary";

type SessionInput = Parameters<typeof computeFlashcardSummary>[0];

function makeSession(overrides: Partial<NonNullable<SessionInput>> = {}): SessionInput {
  return {
    flashcard_completed_count: 0,
    flashcard_new_completed_count: 0,
    flashcard_review_completed_count: 0,
    flashcard_attempts_count: 0,
    flashcard_retry_count: 0,
    ...overrides,
  };
}

describe("computeFlashcardSummary", () => {
  it("all-zeros session yields no accuracy and no attempts line", () => {
    const out = computeFlashcardSummary(makeSession());
    expect(out.cardsPracticed).toBe(0);
    expect(out.newCount).toBe(0);
    expect(out.reviewCount).toBe(0);
    expect(out.attempts).toBe(0);
    expect(out.retries).toBe(0);
    expect(out.accuracyPercent).toBeNull();
    expect(out.showAccuracy).toBe(false);
    expect(out.showAttemptsLine).toBe(false);
  });

  it("10 reviews / 0 retries → 100% accuracy, shown", () => {
    const out = computeFlashcardSummary(
      makeSession({
        flashcard_completed_count: 10,
        flashcard_review_completed_count: 10,
        flashcard_attempts_count: 10,
        flashcard_retry_count: 0,
      }),
    );
    expect(out.accuracyPercent).toBe(100);
    expect(out.showAccuracy).toBe(true);
  });

  it("10 reviews / 4 retries → 60% accuracy, shown", () => {
    const out = computeFlashcardSummary(
      makeSession({
        flashcard_completed_count: 10,
        flashcard_review_completed_count: 10,
        flashcard_attempts_count: 10,
        flashcard_retry_count: 4,
      }),
    );
    expect(out.accuracyPercent).toBe(60);
    expect(out.showAccuracy).toBe(true);
  });

  it("retries > attempts clamps accuracy to 0", () => {
    const out = computeFlashcardSummary(
      makeSession({
        flashcard_completed_count: 10,
        flashcard_attempts_count: 10,
        flashcard_retry_count: 15,
      }),
    );
    expect(out.accuracyPercent).toBe(0);
  });

  it("all-new with no retries → accuracy hidden", () => {
    const out = computeFlashcardSummary(
      makeSession({
        flashcard_completed_count: 10,
        flashcard_new_completed_count: 10,
        flashcard_review_completed_count: 0,
        flashcard_attempts_count: 10,
        flashcard_retry_count: 0,
      }),
    );
    // Internally the computation yields 100, but with no reviews and no retries
    // there is no graded signal worth surfacing — render gate should hide it.
    expect(out.accuracyPercent).toBe(100);
    expect(out.showAccuracy).toBe(false);
  });

  it("all-new with retries → accuracy shown (retries are signal enough)", () => {
    const out = computeFlashcardSummary(
      makeSession({
        flashcard_completed_count: 10,
        flashcard_new_completed_count: 10,
        flashcard_review_completed_count: 0,
        flashcard_attempts_count: 10,
        flashcard_retry_count: 2,
      }),
    );
    expect(out.showAccuracy).toBe(true);
    expect(out.accuracyPercent).toBe(80);
  });

  it("attempts > cardsPracticed → showAttemptsLine true", () => {
    const out = computeFlashcardSummary(
      makeSession({
        flashcard_completed_count: 15,
        flashcard_attempts_count: 22,
        flashcard_retry_count: 7,
      }),
    );
    expect(out.cardsPracticed).toBe(15);
    expect(out.attempts).toBe(22);
    expect(out.showAttemptsLine).toBe(true);
  });

  it("attempts === cardsPracticed → showAttemptsLine false", () => {
    const out = computeFlashcardSummary(
      makeSession({
        flashcard_completed_count: 22,
        flashcard_attempts_count: 22,
        flashcard_retry_count: 0,
      }),
    );
    expect(out.cardsPracticed).toBe(22);
    expect(out.attempts).toBe(22);
    expect(out.showAttemptsLine).toBe(false);
  });

  it("null session yields safe zero summary", () => {
    const out = computeFlashcardSummary(null);
    expect(out.cardsPracticed).toBe(0);
    expect(out.attempts).toBe(0);
    expect(out.accuracyPercent).toBeNull();
    expect(out.showAccuracy).toBe(false);
    expect(out.showAttemptsLine).toBe(false);
  });

  it("missing attempts column falls back to cardsPracticed (no spurious attempts line)", () => {
    const out = computeFlashcardSummary(
      makeSession({
        flashcard_completed_count: 8,
        flashcard_attempts_count: undefined as unknown as number,
      }),
    );
    expect(out.attempts).toBe(8);
    expect(out.showAttemptsLine).toBe(false);
  });
});
