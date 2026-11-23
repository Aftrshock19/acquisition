import { describe, expect, it } from "vitest";
import { getAppSessionDate } from "@/lib/analytics/date";
import { getExportRows, toCsv } from "@/lib/analytics/export";
import { buildAnalyticsSummary, buildDailyAggregates, isLoopCompleted } from "@/lib/analytics/service";
import type { AnalyticsBundle, AnalyticsSessionRow } from "@/lib/analytics/types";

const TODAY = getAppSessionDate();

// Day finished with a retry: client counted it towards the target, the
// server did not, so the raw completed flag stayed false.
const finishedWithRetries: AnalyticsSessionRow = {
  id: "session-1",
  user_id: "user-1",
  session_date: TODAY,
  stage: "flashcards",
  new_words_count: 4,
  reviews_done: 3,
  assigned_flashcard_count: 4,
  assigned_new_words_count: 4,
  assigned_review_cards_count: 0,
  flashcard_completed_count: 3,
  flashcard_new_completed_count: 3,
  flashcard_review_completed_count: 0,
  flashcard_attempts_count: 4,
  flashcard_retry_count: 1,
  started_at: `${TODAY}T08:00:00.000Z`,
  last_active_at: `${TODAY}T08:10:00.000Z`,
  last_resumed_at: null,
  resume_count: 0,
  flashcards_completed_at: null,
  reading_done: true,
  reading_text_id: "text-1",
  reading_opened_at: `${TODAY}T08:05:10.000Z`,
  reading_completed_at: `${TODAY}T08:07:10.000Z`,
  reading_time_seconds: 120,
  listening_done: true,
  listening_asset_id: "audio-1",
  listening_opened_at: `${TODAY}T08:07:20.000Z`,
  listening_playback_started_at: `${TODAY}T08:07:25.000Z`,
  listening_completed_at: `${TODAY}T08:08:55.000Z`,
  listening_max_position_seconds: 85,
  listening_required_seconds: 60,
  listening_transcript_opened: false,
  listening_playback_rate: 1,
  listening_time_seconds: 90,
  completed: false,
  completed_at: null,
  created_at: `${TODAY}T08:00:00.000Z`,
  updated_at: `${TODAY}T08:08:55.000Z`,
  daily_target_mode: "recommended",
};

function makeBundle(sessions: AnalyticsSessionRow[]): AnalyticsBundle {
  const range = { from: TODAY, to: TODAY };
  const dailyAggregates = buildDailyAggregates({
    range,
    sessions,
    reviewEvents: [],
    savedWords: [],
  });
  return {
    range,
    sessions,
    reviewEvents: [],
    savedWords: [],
    readingQuestionAttempts: [],
    exportRuns: [],
    dailyAggregates,
    summary: buildAnalyticsSummary({
      sessions,
      reviewEvents: [],
      savedWords: [],
      dailyAggregates,
    }),
    today: null,
  };
}

describe("analytics export", () => {
  it("adds loop_completed to the sessions export and keeps the raw completed flag", () => {
    const bundle = makeBundle([finishedWithRetries]);
    const rows = getExportRows("sessions", bundle, "P001");

    expect(rows[0]).toMatchObject({ completed: false, loop_completed: true });

    const [header, line] = toCsv("sessions", rows).split("\n");
    const columns = header.split(",");
    const values = line.split(",");
    expect(values[columns.indexOf("completed")]).toBe("false");
    expect(values[columns.indexOf("loop_completed")]).toBe("true");
  });

  it("exports loop_completed in daily_aggregates matching session_completed", () => {
    const bundle = makeBundle([finishedWithRetries]);
    const rows = getExportRows("daily_aggregates", bundle, "P001");

    expect(rows[0]).toMatchObject({ session_completed: true, loop_completed: true });

    const [header, line] = toCsv("daily_aggregates", rows).split("\n");
    const columns = header.split(",");
    expect(line.split(",")[columns.indexOf("loop_completed")]).toBe("true");
  });

  it("applies the loop_completed definition to historical column combinations", () => {
    expect(isLoopCompleted(finishedWithRetries)).toBe(true);
    expect(
      isLoopCompleted({ ...finishedWithRetries, flashcard_attempts_count: 3 }),
    ).toBe(false);
    expect(
      isLoopCompleted({
        ...finishedWithRetries,
        flashcard_attempts_count: 3,
        flashcards_completed_at: `${TODAY}T08:05:00.000Z`,
      }),
    ).toBe(true);
    expect(isLoopCompleted({ ...finishedWithRetries, listening_done: false })).toBe(false);
    expect(
      isLoopCompleted({
        ...finishedWithRetries,
        reading_done: false,
        listening_done: false,
        completed_at: `${TODAY}T08:08:55.000Z`,
      }),
    ).toBe(true);
  });
});
