import { describe, it, expect } from "vitest";
import {
  buildLoopSummariesByDate,
  computeFlashcardSummary,
  type CalendarLoopSummaryDay,
  type ListeningAudioLookup,
  type ReadingTextLookup,
} from "./dailySummary";

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

// ---------------------------------------------------------------------------

function makeCalendarDay(
  overrides: Partial<CalendarLoopSummaryDay> = {},
): CalendarLoopSummaryDay {
  return {
    date: "2026-04-10",
    usedApp: true,
    flashcardsDone: 0,
    newWords: 0,
    reviewsDone: 0,
    flashcardAttempts: 0,
    retryCount: 0,
    readingCompleted: false,
    readingTextId: null,
    readingTimeSeconds: 0,
    listeningCompleted: false,
    listeningAssetId: null,
    listeningTimeSeconds: 0,
    ...overrides,
  };
}

describe("computeFlashcardSummary on calendar-shaped day inputs", () => {
  it("derives the same accuracy from CalendarDayMetrics fields as from DailySessionRow", () => {
    // Calendar-side adapter mirrors the field renaming buildLoopSummariesByDate
    // does internally. Confirms both surfaces produce an identical FlashcardSummary.
    const day = makeCalendarDay({
      flashcardsDone: 22,
      newWords: 4,
      reviewsDone: 18,
      flashcardAttempts: 26,
      retryCount: 4,
    });
    const out = computeFlashcardSummary({
      flashcard_completed_count: day.flashcardsDone,
      flashcard_new_completed_count: day.newWords,
      flashcard_review_completed_count: day.reviewsDone,
      flashcard_attempts_count: day.flashcardAttempts,
      flashcard_retry_count: day.retryCount,
    });
    expect(out.cardsPracticed).toBe(22);
    expect(out.attempts).toBe(26);
    expect(out.retries).toBe(4);
    expect(out.accuracyPercent).toBe(85); // round((1 - 4/26) * 100) = 85
    expect(out.showAccuracy).toBe(true);
    expect(out.showAttemptsLine).toBe(true);
  });
});

describe("buildLoopSummariesByDate", () => {
  it("skips empty days and keys active days by date", () => {
    const days: CalendarLoopSummaryDay[] = [
      makeCalendarDay({ date: "2026-04-09", usedApp: false }),
      makeCalendarDay({
        date: "2026-04-10",
        usedApp: true,
        flashcardsDone: 22,
        newWords: 4,
        reviewsDone: 18,
        flashcardAttempts: 26,
        retryCount: 4,
        readingCompleted: true,
        readingTextId: "text-A",
        readingTimeSeconds: 240,
        listeningCompleted: true,
        listeningAssetId: "audio-A",
        listeningTimeSeconds: 90,
      }),
      makeCalendarDay({ date: "2026-04-11", usedApp: false }),
    ];
    const texts = new Map<string, ReadingTextLookup>([
      ["text-A", { word_count: 81, estimated_minutes: 1, display_label: "A1--" }],
    ]);
    const audios = new Map<string, ListeningAudioLookup>([
      ["audio-A", { duration_seconds: 90, display_label: "B2+" }],
    ]);
    const out = buildLoopSummariesByDate(days, texts, audios);
    expect(Object.keys(out)).toEqual(["2026-04-10"]);

    const summary = out["2026-04-10"];
    expect(summary.flashcards.cardsPracticed).toBe(22);
    expect(summary.flashcards.accuracyPercent).toBe(85);
    expect(summary.reading.completed).toBe(true);
    expect(summary.reading.totalWords).toBe(81);
    expect(summary.reading.totalMinutes).toBe(4); // 240s / 60 = 4
    expect(summary.reading.displayLabel).toBe("A1--");
    expect(summary.listening.completed).toBe(true);
    expect(summary.listening.totalMinutes).toBe(2); // round(90/60) = 2
    expect(summary.listening.displayLabel).toBe("B2+");
  });

  it("falls back to 'completed without stats' when text/audio lookups are missing", () => {
    const days: CalendarLoopSummaryDay[] = [
      makeCalendarDay({
        date: "2026-04-12",
        usedApp: true,
        flashcardsDone: 5,
        flashcardAttempts: 5,
        readingCompleted: true,
        readingTextId: "text-missing",
        listeningCompleted: true,
        listeningAssetId: "audio-missing",
      }),
    ];
    const out = buildLoopSummariesByDate(days, new Map(), new Map());
    const summary = out["2026-04-12"];
    expect(summary.reading.completed).toBe(true);
    expect(summary.reading.totalWords).toBeNull();
    expect(summary.reading.displayLabel).toBeNull();
    expect(summary.listening.completed).toBe(true);
    expect(summary.listening.totalMinutes).toBeNull();
    expect(summary.listening.displayLabel).toBeNull();
  });

  it("uses listeningTimeSeconds fallback when audio.duration_seconds is missing", () => {
    const days: CalendarLoopSummaryDay[] = [
      makeCalendarDay({
        date: "2026-04-13",
        usedApp: true,
        listeningCompleted: true,
        listeningAssetId: "audio-Z",
        listeningTimeSeconds: 24,
      }),
    ];
    const audios = new Map<string, ListeningAudioLookup>([
      ["audio-Z", { duration_seconds: null, display_label: null }],
    ]);
    const out = buildLoopSummariesByDate(days, new Map(), audios);
    // 24 seconds rounds to 0 but listeningMinutes floors at 1.
    expect(out["2026-04-13"].listening.totalMinutes).toBe(1);
  });

  it("returns {} when given no active days", () => {
    const days: CalendarLoopSummaryDay[] = [
      makeCalendarDay({ date: "2026-04-14", usedApp: false }),
      makeCalendarDay({ date: "2026-04-15", usedApp: false }),
    ];
    expect(buildLoopSummariesByDate(days, new Map(), new Map())).toEqual({});
  });
});
