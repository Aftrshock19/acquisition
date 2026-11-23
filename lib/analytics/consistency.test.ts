import { describe, expect, it } from "vitest";
import { getConsistencyIssues } from "@/lib/analytics/consistency";
import { getAppSessionDate } from "@/lib/analytics/date";
import { buildAnalyticsSummary, buildDailyAggregates } from "@/lib/analytics/service";
import type { AnalyticsBundle, AnalyticsSessionRow } from "@/lib/analytics/types";

const TODAY = getAppSessionDate();

const completedSession: AnalyticsSessionRow = {
  id: "session-1",
  user_id: "user-1",
  session_date: TODAY,
  stage: "completed",
  new_words_count: 3,
  reviews_done: 3,
  assigned_flashcard_count: 3,
  assigned_new_words_count: 3,
  assigned_review_cards_count: 0,
  flashcard_completed_count: 3,
  flashcard_new_completed_count: 3,
  flashcard_review_completed_count: 0,
  flashcard_attempts_count: 3,
  flashcard_retry_count: 0,
  started_at: `${TODAY}T08:00:00.000Z`,
  last_active_at: `${TODAY}T08:10:00.000Z`,
  last_resumed_at: null,
  resume_count: 0,
  flashcards_completed_at: `${TODAY}T08:05:00.000Z`,
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
  completed: true,
  completed_at: `${TODAY}T08:08:55.000Z`,
  created_at: `${TODAY}T08:00:00.000Z`,
  updated_at: `${TODAY}T08:08:55.000Z`,
  daily_target_mode: "recommended",
};

function sessionStateIssues(session: AnalyticsSessionRow) {
  const range = { from: TODAY, to: TODAY };
  const dailyAggregates = buildDailyAggregates({
    range,
    sessions: [session],
    reviewEvents: [],
    savedWords: [],
  });
  const bundle: AnalyticsBundle = {
    range,
    sessions: [session],
    reviewEvents: [],
    savedWords: [],
    readingQuestionAttempts: [],
    exportRuns: [],
    dailyAggregates,
    summary: buildAnalyticsSummary({
      sessions: [session],
      reviewEvents: [],
      savedWords: [],
      dailyAggregates,
    }),
    today: null,
  };
  return getConsistencyIssues(bundle, "user-1").find(
    (issue) => issue.id === "impossible-session-states",
  );
}

describe("analytics consistency checks", () => {
  it("does not flag extra practice after a completed loop", () => {
    expect(
      sessionStateIssues({
        ...completedSession,
        stage: "flashcards",
        assigned_flashcard_count: 13,
        completed: false,
      }),
    ).toBeUndefined();
  });

  it("still flags a row stuck at flashcards after reading without completed_at", () => {
    const issue = sessionStateIssues({
      ...completedSession,
      stage: "flashcards",
      assigned_flashcard_count: 4,
      flashcard_attempts_count: 4,
      flashcard_retry_count: 1,
      flashcards_completed_at: null,
      completed: false,
      completed_at: null,
    });

    expect(issue?.details[0]).toContain("stage is flashcards after later-stage completion");
  });
});
