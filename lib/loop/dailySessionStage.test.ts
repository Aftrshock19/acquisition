import { describe, expect, it } from "vitest";
import {
  buildExtendedProgress,
  buildSkippedProgress,
  getDailySessionCompleted,
  getDailySessionProgressState,
  getFlashcardAttemptsCount,
  getInitialAssignedFlashcardCount,
  isFlashcardsPending,
  resolveCompletedAt,
  resolveDailySessionStage,
  resolveFlashcardsCompletedAt,
  type DailySessionProgressSource,
} from "./dailySessionStage";

const EARLIER = "2026-11-01T09:00:00.000Z";
const NOW = "2026-11-02T10:00:00.000Z";

function row(overrides: DailySessionProgressSource = {}): DailySessionProgressSource {
  return {
    assigned_flashcard_count: 10,
    assigned_new_words_count: 5,
    assigned_review_cards_count: 5,
    flashcard_completed_count: 0,
    flashcard_attempts_count: 0,
    flashcards_skipped_at: null,
    reading_done: false,
    listening_done: false,
    ...overrides,
  };
}

function stageOf(source: DailySessionProgressSource) {
  return resolveDailySessionStage(getDailySessionProgressState(source));
}

describe("resolveDailySessionStage (contract A)", () => {
  it("stays on flashcards while attempts < assigned", () => {
    expect(stageOf(row({ flashcard_attempts_count: 9, flashcard_completed_count: 9 }))).toBe(
      "flashcards",
    );
  });

  it("counts retries towards the target (main-only completions are not the unit)", () => {
    // 7 main + 3 retries = 10 attempts against a target of 10: the client
    // session cap ends here, so the server must leave the flashcard stage.
    const state = getDailySessionProgressState(
      row({ flashcard_completed_count: 7, flashcard_attempts_count: 10 }),
    );
    expect(isFlashcardsPending(state)).toBe(false);
    expect(resolveDailySessionStage(state)).toBe("reading");
  });

  it("walks reading → listening → completed once flashcards are done", () => {
    const done = { flashcard_completed_count: 10, flashcard_attempts_count: 10 };
    expect(stageOf(row({ ...done }))).toBe("reading");
    expect(stageOf(row({ ...done, reading_done: true }))).toBe("listening");
    expect(stageOf(row({ ...done, reading_done: true, listening_done: true }))).toBe(
      "completed",
    );
  });

  it("a persisted skip ends the flashcard stage below target", () => {
    expect(
      stageOf(row({ flashcard_attempts_count: 3, flashcards_skipped_at: EARLIER })),
    ).toBe("reading");
  });

  it("completed flag is exactly stage === 'completed'", () => {
    const pending = getDailySessionProgressState(
      row({ flashcard_attempts_count: 4, reading_done: true, listening_done: true }),
    );
    expect(resolveDailySessionStage(pending)).toBe("flashcards");
    expect(getDailySessionCompleted(pending)).toBe(false);
  });

  it("a zero target is never pending", () => {
    expect(stageOf(row({ assigned_flashcard_count: 0 }))).toBe("reading");
  });
});

describe("getDailySessionProgressState", () => {
  it("reads attempts, falling back to main completions only when attempts are missing", () => {
    expect(getFlashcardAttemptsCount({ flashcard_attempts_count: 12, flashcard_completed_count: 9 })).toBe(12);
    expect(getFlashcardAttemptsCount({ flashcard_attempts_count: null, flashcard_completed_count: 9 })).toBe(9);
    expect(getFlashcardAttemptsCount(null)).toBe(0);
  });

  it("preserves an existing assigned count as-is", () => {
    const state = getDailySessionProgressState(
      row({ assigned_flashcard_count: 100, flashcard_attempts_count: 60 }),
      { assignedFlashcardCount: 50 },
    );
    expect(state.assignedFlashcardCount).toBe(100);
  });

  it("uses the fallback assigned count only when creating the row", () => {
    const state = getDailySessionProgressState(null, {
      assignedFlashcardCount: 100,
      assignedNewWordsCount: 50,
      assignedReviewCardsCount: 0,
    });
    expect(state.assignedFlashcardCount).toBe(100);
    expect(state.flashcardsSkipped).toBe(false);
  });
});

describe("manual target storage", () => {
  it("stores the full manual target, not the first 50-card chunk", () => {
    expect(
      getInitialAssignedFlashcardCount({
        isUserDrivenTarget: true,
        sessionTargetCount: 100,
        loadedCardCount: 50,
      }),
    ).toBe(100);
  });

  it("recommended autopilot stores the size of the queue it assigned", () => {
    expect(
      getInitialAssignedFlashcardCount({
        isUserDrivenTarget: false,
        sessionTargetCount: 25,
        loadedCardCount: 13,
      }),
    ).toBe(13);
  });

  it("a reload at card 60 of 100 keeps the 100 target and stays on flashcards", () => {
    const assigned = getInitialAssignedFlashcardCount({
      isUserDrivenTarget: true,
      sessionTargetCount: 100,
      loadedCardCount: 50,
    });
    const reloaded = getDailySessionProgressState(
      row({ assigned_flashcard_count: assigned, flashcard_attempts_count: 60 }),
    );
    expect(reloaded.assignedFlashcardCount).toBe(100);
    expect(resolveDailySessionStage(reloaded)).toBe("flashcards");
  });
});

describe("first-reached timestamps", () => {
  it("flashcards_completed_at is set when flashcards stop being pending", () => {
    const pending = getDailySessionProgressState(row({ flashcard_attempts_count: 2 }));
    const done = getDailySessionProgressState(row({ flashcard_attempts_count: 10 }));
    expect(resolveFlashcardsCompletedAt(null, pending, NOW)).toBeNull();
    expect(resolveFlashcardsCompletedAt(null, done, NOW)).toBe(NOW);
  });

  it("neither timestamp is ever cleared once set", () => {
    const pending = getDailySessionProgressState(row({ flashcard_attempts_count: 2 }));
    expect(resolveFlashcardsCompletedAt(EARLIER, pending, NOW)).toBe(EARLIER);
    expect(resolveCompletedAt(EARLIER, pending, NOW)).toBe(EARLIER);
  });

  it("completed_at is set the first time the stage reaches completed", () => {
    const complete = getDailySessionProgressState(
      row({ flashcard_attempts_count: 10, reading_done: true, listening_done: true }),
    );
    expect(resolveCompletedAt(null, complete, NOW)).toBe(NOW);
  });
});

describe("Do more flashcards (extend)", () => {
  const completedDay = row({
    assigned_flashcard_count: 10,
    flashcard_completed_count: 8,
    flashcard_attempts_count: 12,
    reading_done: true,
    listening_done: true,
  });

  it("requires `count` more attempts beyond what has been done and routes to flashcards", () => {
    const next = buildExtendedProgress(getDailySessionProgressState(completedDay), 5);
    expect(next.assignedFlashcardCount).toBe(17);
    expect(resolveDailySessionStage(next)).toBe("flashcards");
    expect(getDailySessionCompleted(next)).toBe(false);
  });

  it("keeps flashcards_completed_at and completed_at from the finished day", () => {
    const next = buildExtendedProgress(getDailySessionProgressState(completedDay), 5);
    expect(resolveFlashcardsCompletedAt(EARLIER, next, NOW)).toBe(EARLIER);
    expect(resolveCompletedAt(EARLIER, next, NOW)).toBe(EARLIER);
  });

  it("clears an earlier skip so flashcards are pending again", () => {
    const skippedDay = row({ flashcard_attempts_count: 3, flashcards_skipped_at: EARLIER });
    const next = buildExtendedProgress(getDailySessionProgressState(skippedDay), 5);
    expect(next.flashcardsSkipped).toBe(false);
    expect(resolveDailySessionStage(next)).toBe("flashcards");
  });

  it("after a skip, re-bases the target on attempts so exactly `count` more are owed", () => {
    // Manual target 100, skipped at 30: picking 10 must mean 10 more, not 80.
    const skippedAt30 = row({
      assigned_flashcard_count: 100,
      flashcard_attempts_count: 30,
      flashcards_skipped_at: EARLIER,
      reading_done: true,
    });
    const next = buildExtendedProgress(getDailySessionProgressState(skippedAt30), 10);
    expect(next.assignedFlashcardCount).toBe(40);
    expect(next.assignedFlashcardCount - next.flashcardAttemptsCount).toBe(10);

    const skippedAt0 = row({ flashcard_attempts_count: 0, flashcards_skipped_at: EARLIER });
    expect(
      buildExtendedProgress(getDailySessionProgressState(skippedAt0), 5).assignedFlashcardCount,
    ).toBe(5);
  });

  it("without a skip, still raises from the stored target when attempts are below it", () => {
    // Not reachable through contract A (extend needs flashcards to be done),
    // but a legacy row must never have its target lowered by an extend.
    const legacy = row({ assigned_flashcard_count: 10, flashcard_attempts_count: 3 });
    expect(
      buildExtendedProgress(getDailySessionProgressState(legacy), 5).assignedFlashcardCount,
    ).toBe(15);
  });

  it("finishing the extra cards returns to completed without a new completed_at", () => {
    const next = buildExtendedProgress(getDailySessionProgressState(completedDay), 5);
    const finished = { ...next, flashcardAttemptsCount: next.assignedFlashcardCount };
    expect(resolveDailySessionStage(finished)).toBe("completed");
    expect(resolveCompletedAt(EARLIER, finished, NOW)).toBe(EARLIER);
  });
});

describe("Continue to reading (skip) persistence", () => {
  it("is a no-op when flashcards are not pending", () => {
    const done = getDailySessionProgressState(row({ flashcard_attempts_count: 10 }));
    expect(buildSkippedProgress(done)).toBeNull();
  });

  it("moves a below-target day to reading and sets flashcards_completed_at", () => {
    const pending = getDailySessionProgressState(row({ flashcard_attempts_count: 4 }));
    const skipped = buildSkippedProgress(pending)!;
    expect(resolveDailySessionStage(skipped)).toBe("reading");
    expect(resolveFlashcardsCompletedAt(null, skipped, NOW)).toBe(NOW);
  });

  it("survives the /today re-render that re-derives stage from the row", () => {
    // skipFlashcardsToReading writes flashcards_skipped_at; the same request
    // re-renders /today and upsertDailySession re-derives the stage from the
    // stored row. Before the fix the counters alone sent it back to flashcards.
    const storedAfterSkip = row({ flashcard_attempts_count: 4, flashcards_skipped_at: NOW });
    expect(stageOf(storedAfterSkip)).toBe("reading");
  });

  it("manual target above the word supply: the day completes once the session's skip lands", () => {
    // Target 30 stored in full, only 20 words: 20 main + 3 retries = 23.
    const assigned = getInitialAssignedFlashcardCount({
      isUserDrivenTarget: true,
      sessionTargetCount: 30,
      loadedCardCount: 20,
    });
    const afterSession = row({ assigned_flashcard_count: assigned, flashcard_attempts_count: 23 });
    // Without the skip, finishing reading and listening leaves the day pending.
    expect(stageOf({ ...afterSession, reading_done: true, listening_done: true })).toBe(
      "flashcards",
    );

    // TodaySession persists the skip (skipFlashcardsAfterSession) at its
    // practice-complete screen; reading and listening then complete the day.
    const skipped = buildSkippedProgress(getDailySessionProgressState(afterSession))!;
    expect(resolveFlashcardsCompletedAt(null, skipped, NOW)).toBe(NOW);
    const stored = { ...afterSession, flashcards_skipped_at: NOW };
    expect(stageOf(stored)).toBe("reading");
    const finished = getDailySessionProgressState({
      ...stored,
      reading_done: true,
      listening_done: true,
    });
    expect(resolveDailySessionStage(finished)).toBe("completed");
    expect(resolveCompletedAt(null, finished, NOW)).toBe(NOW);
  });

  it("an extended, completed day that runs out of words skips back to completed", () => {
    const extendedDay = row({
      assigned_flashcard_count: 30,
      flashcard_attempts_count: 18,
      reading_done: true,
      listening_done: true,
    });
    const skipped = buildSkippedProgress(getDailySessionProgressState(extendedDay))!;
    expect(resolveDailySessionStage(skipped)).toBe("completed");
    expect(getDailySessionCompleted(skipped)).toBe(true);
  });
});
