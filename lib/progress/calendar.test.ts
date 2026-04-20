import { describe, expect, it } from "vitest";
import { getAppSessionDate, shiftSessionDate } from "@/lib/analytics/date";
import type { DailyAggregate } from "@/lib/analytics/types";
import {
  getMonthRange,
  getWeekRange,
  parseYearMonth,
  shiftMonth,
  summariseCalendarDays,
  toCalendarDayMetrics,
} from "./calendar";

function makeDay(overrides: Partial<DailyAggregate> = {}): DailyAggregate {
  return {
    session_date: "2026-04-10",
    session_started: false,
    session_completed: false,
    stage: null,
    assigned_flashcard_count: 0,
    assigned_new_words_count: 0,
    assigned_review_cards_count: 0,
    flashcard_completed_count: 0,
    flashcard_new_completed_count: 0,
    flashcard_review_completed_count: 0,
    flashcard_attempts_count: 0,
    flashcard_retry_count: 0,
    flashcard_accuracy: null,
    review_correctness_proxy: null,
    reader_saved_words_count: 0,
    reading_completed: false,
    listening_completed: false,
    reading_time_seconds: 0,
    listening_time_seconds: 0,
    flashcard_time_seconds: 0,
    total_time_seconds: 0,
    days_active_flag: false,
    workload_assigned_units: 0,
    workload_completed_units: 0,
    workload_completion_rate: null,
    scheduler_variant: null,
    learner_state_score: null,
    learner_factor: null,
    workload_factor: null,
    adaptive_new_word_cap: null,
    reading_question_accuracy: null,
    reading_question_attempts_count: 0,
    daily_target_mode: "recommended",
    ...overrides,
  };
}

describe("toCalendarDayMetrics status", () => {
  it("marks no-activity days as empty", () => {
    expect(toCalendarDayMetrics(makeDay()).status).toBe("empty");
  });

  it("marks activity without completion as partial", () => {
    const day = makeDay({ days_active_flag: true, flashcard_completed_count: 3 });
    expect(toCalendarDayMetrics(day).status).toBe("partial");
  });

  it("marks completed sessions as completed", () => {
    const day = makeDay({
      days_active_flag: true,
      session_completed: true,
      flashcard_completed_count: 10,
    });
    expect(toCalendarDayMetrics(day).status).toBe("completed");
  });

  it("retries do not inflate flashcard completion count in the mapped shape", () => {
    const day = makeDay({
      days_active_flag: true,
      flashcard_completed_count: 5,
      flashcard_retry_count: 3,
    });
    const mapped = toCalendarDayMetrics(day);
    expect(mapped.flashcardsDone).toBe(5);
    expect(mapped.retryCount).toBe(3);
  });

  it("reports minutes rounded from total_time_seconds", () => {
    const day = makeDay({ total_time_seconds: 90 });
    expect(toCalendarDayMetrics(day).timeOnTaskMinutes).toBe(2);
  });
});

describe("getMonthRange", () => {
  it("returns the first and last day of the month", () => {
    expect(getMonthRange(2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(getMonthRange(2024, 2)).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(getMonthRange(2026, 12)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("getWeekRange (Monday start)", () => {
  it("returns Monday..Sunday for a Wednesday anchor", () => {
    expect(getWeekRange("2026-04-15")).toEqual({ from: "2026-04-13", to: "2026-04-19" });
  });

  it("returns Monday..Sunday for a Sunday anchor", () => {
    expect(getWeekRange("2026-04-19")).toEqual({ from: "2026-04-13", to: "2026-04-19" });
  });

  it("returns Monday..Sunday for a Monday anchor", () => {
    expect(getWeekRange("2026-04-13")).toEqual({ from: "2026-04-13", to: "2026-04-19" });
  });
});

describe("shiftMonth", () => {
  it("wraps to the next year from December", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it("wraps backwards across the year boundary", () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe("parseYearMonth", () => {
  it("accepts valid year/month params", () => {
    expect(parseYearMonth("2026", "4")).toEqual({ year: 2026, month: 4 });
  });

  it("clamps invalid month into 1..12", () => {
    expect(parseYearMonth("2026", "13").month).toBeLessThanOrEqual(12);
    expect(parseYearMonth("2026", "0").month).toBeGreaterThanOrEqual(1);
  });
});

describe("summariseCalendarDays", () => {
  it("treats an empty month as zero-active with null rates", () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      toCalendarDayMetrics(makeDay({ session_date: `2026-04-${String(i + 1).padStart(2, "0")}` })),
    );
    const s = summariseCalendarDays(days);
    expect(s.activeDays).toBe(0);
    expect(s.completedDays).toBe(0);
    expect(s.completionRate).toBeNull();
    expect(s.averageAccuracy).toBeNull();
    expect(s.totalFlashcards).toBe(0);
    expect(s.totalMinutes).toBe(0);
  });

  it("computes completion rate against active days, not total days", () => {
    const days = [
      toCalendarDayMetrics(makeDay({ session_date: "2026-04-01", days_active_flag: true, session_completed: true, flashcard_completed_count: 10, flashcard_attempts_count: 10, flashcard_accuracy: 0.8, total_time_seconds: 600 })),
      toCalendarDayMetrics(makeDay({ session_date: "2026-04-02", days_active_flag: true, flashcard_completed_count: 4, flashcard_attempts_count: 4, flashcard_accuracy: 0.5, total_time_seconds: 300 })),
      toCalendarDayMetrics(makeDay({ session_date: "2026-04-03" })),
    ];
    const s = summariseCalendarDays(days);
    expect(s.activeDays).toBe(2);
    expect(s.completedDays).toBe(1);
    expect(s.completionRate).toBe(0.5);
    expect(s.totalFlashcards).toBe(14);
    expect(s.totalMinutes).toBe(15);
    // weighted by attempts: (0.8*10 + 0.5*4) / 14 = 10 / 14
    expect(s.averageAccuracy).toBeCloseTo(10 / 14, 6);
  });

  it("weights monthly accuracy by total attempts (retries included), matching source-of-truth", () => {
    // Source-of-truth daily denominator is reviewEvents.length (retries included),
    // not flashcard_completed_count. So a day with retries must weight more than
    // its "completed" count suggests.
    //
    // Day A: 8 main correct + 2 retry correct out of 10 attempts → accuracy 1.0, completed=8, attempts=10
    // Day B: 2 correct out of 10 attempts (no retries)           → accuracy 0.2, completed=10, attempts=10
    //
    // True source-of-truth: (10 correct total) / (20 attempts total) = 0.6
    // Weighting by completed would give (1.0*8 + 0.2*10) / 18 = 10/18 ≈ 0.556 (WRONG)
    // Weighting by attempts gives       (1.0*10 + 0.2*10) / 20 = 12/20 = 0.6 (CORRECT)
    const days = [
      toCalendarDayMetrics(
        makeDay({
          session_date: "2026-04-01",
          days_active_flag: true,
          flashcard_completed_count: 8,
          flashcard_attempts_count: 10,
          flashcard_retry_count: 2,
          flashcard_accuracy: 1.0,
        }),
      ),
      toCalendarDayMetrics(
        makeDay({
          session_date: "2026-04-02",
          days_active_flag: true,
          flashcard_completed_count: 10,
          flashcard_attempts_count: 10,
          flashcard_retry_count: 0,
          flashcard_accuracy: 0.2,
        }),
      ),
    ];
    const s = summariseCalendarDays(days);
    expect(s.averageAccuracy).toBeCloseTo(0.6, 10);
  });
});

describe("retry semantics", () => {
  it("retry attempts do not inflate flashcardsDone but do inflate attempts and retries", () => {
    const d = toCalendarDayMetrics(
      makeDay({
        days_active_flag: true,
        flashcard_completed_count: 5,
        flashcard_attempts_count: 7,
        flashcard_retry_count: 2,
      }),
    );
    expect(d.flashcardsDone).toBe(5);
    expect(d.flashcardAttempts).toBe(7);
    expect(d.retryCount).toBe(2);
  });
});

describe("partial classification with meaningful-but-incomplete activity", () => {
  // Follows source-of-truth: buildDailyAggregates marks days_active_flag when any of:
  //   review attempts > 0, reader saved words > 0, reading_done, listening_done.

  it("flashcards started but session not completed → partial", () => {
    const d = toCalendarDayMetrics(
      makeDay({
        days_active_flag: true,
        flashcard_completed_count: 3,
        flashcard_attempts_count: 3,
        session_completed: false,
      }),
    );
    expect(d.status).toBe("partial");
  });

  it("reading done but session not completed → partial", () => {
    const d = toCalendarDayMetrics(
      makeDay({ days_active_flag: true, reading_completed: true, session_completed: false }),
    );
    expect(d.status).toBe("partial");
  });

  it("listening done but session not completed → partial", () => {
    const d = toCalendarDayMetrics(
      makeDay({ days_active_flag: true, listening_completed: true, session_completed: false }),
    );
    expect(d.status).toBe("partial");
  });

  it("reader saved words only → partial", () => {
    const d = toCalendarDayMetrics(
      makeDay({ days_active_flag: true, reader_saved_words_count: 2, session_completed: false }),
    );
    expect(d.status).toBe("partial");
  });

  it("no signal at all → empty", () => {
    expect(toCalendarDayMetrics(makeDay()).status).toBe("empty");
  });
});

describe("Europe/London DST boundary grouping", () => {
  // BST starts last Sunday of March (clocks jump 01:00 → 02:00).
  // In 2026 that is 2026-03-29.
  // BST ends last Sunday of October (clocks fall 02:00 → 01:00).
  // In 2026 that is 2026-10-25.

  it("shiftSessionDate crosses the spring-forward day without drifting", () => {
    expect(shiftSessionDate("2026-03-28", 1)).toBe("2026-03-29");
    expect(shiftSessionDate("2026-03-29", 1)).toBe("2026-03-30");
    expect(shiftSessionDate("2026-03-29", -1)).toBe("2026-03-28");
  });

  it("shiftSessionDate crosses the fall-back day without drifting", () => {
    expect(shiftSessionDate("2026-10-24", 1)).toBe("2026-10-25");
    expect(shiftSessionDate("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("getWeekRange around BST start returns the same Mon..Sun regardless of DST", () => {
    // 2026-03-29 is a Sunday (BST start). Week = Mon 23..Sun 29.
    expect(getWeekRange("2026-03-29")).toEqual({ from: "2026-03-23", to: "2026-03-29" });
    // The week containing BST start, anchored from Wednesday of that week.
    expect(getWeekRange("2026-03-25")).toEqual({ from: "2026-03-23", to: "2026-03-29" });
  });

  it("getWeekRange around BST end returns the same Mon..Sun regardless of DST", () => {
    // 2026-10-25 is a Sunday (BST end). Week = Mon 19..Sun 25.
    expect(getWeekRange("2026-10-25")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
  });

  it("getAppSessionDate groups a UTC instant just after the BST jump to the correct local date", () => {
    // 2026-03-29 00:30 UTC → 01:30 BST → local date 2026-03-29
    expect(getAppSessionDate(new Date("2026-03-29T00:30:00.000Z"))).toBe("2026-03-29");
    // 2026-03-28 23:30 UTC → 23:30 GMT (still GMT) → local date 2026-03-28
    expect(getAppSessionDate(new Date("2026-03-28T23:30:00.000Z"))).toBe("2026-03-28");
  });

  it("getAppSessionDate groups around BST end correctly", () => {
    // 2026-10-25 00:30 UTC → 01:30 BST → local 2026-10-25
    expect(getAppSessionDate(new Date("2026-10-25T00:30:00.000Z"))).toBe("2026-10-25");
    // 2026-10-25 23:30 UTC → 23:30 GMT (already fallen back) → local 2026-10-25
    expect(getAppSessionDate(new Date("2026-10-25T23:30:00.000Z"))).toBe("2026-10-25");
    // 2026-10-26 00:30 UTC → 00:30 GMT → local 2026-10-26
    expect(getAppSessionDate(new Date("2026-10-26T00:30:00.000Z"))).toBe("2026-10-26");
  });

  it("totals equal the sum of daily metrics (monthly invariant)", () => {
    const days = [
      toCalendarDayMetrics(makeDay({ session_date: "2026-04-01", days_active_flag: true, flashcard_completed_count: 3, total_time_seconds: 120 })),
      toCalendarDayMetrics(makeDay({ session_date: "2026-04-02", days_active_flag: true, flashcard_completed_count: 7, total_time_seconds: 180 })),
    ];
    const s = summariseCalendarDays(days);
    expect(s.totalFlashcards).toBe(days.reduce((t, d) => t + d.flashcardsDone, 0));
    expect(s.totalMinutes).toBe(days.reduce((t, d) => t + d.timeOnTaskMinutes, 0));
  });
});
