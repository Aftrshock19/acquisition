import { describe, expect, it } from "vitest";
import { getAppSessionDate } from "@/lib/analytics/date";
import { buildAnalyticsSummary, buildDailyAggregates, buildTodaySnapshot } from "@/lib/analytics/service";
import type { AnalyticsReviewEventRow, AnalyticsSavedWordRow, AnalyticsSessionRow } from "@/lib/analytics/types";

const TODAY = getAppSessionDate();

const sampleSession: AnalyticsSessionRow = {
  id: "session-1",
  user_id: "user-1",
  session_date: TODAY,
  stage: "completed",
  new_words_count: 3,
  reviews_done: 3,
  assigned_flashcard_count: 3,
  assigned_new_words_count: 1,
  assigned_review_cards_count: 2,
  flashcard_completed_count: 3,
  flashcard_new_completed_count: 1,
  flashcard_review_completed_count: 2,
  flashcard_attempts_count: 4,
  flashcard_retry_count: 1,
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

const reviewEvents: AnalyticsReviewEventRow[] = [
  {
    id: "review-1",
    user_id: "user-1",
    daily_session_id: "session-1",
    session_date: TODAY,
    word_id: "word-1",
    queue_kind: "new",
    queue_source: "main",
    card_type: "cloze",
    grade: "good",
    correct: true,
    ms_spent: 4000,
    shown_at: `${TODAY}T08:00:05.000Z`,
    submitted_at: `${TODAY}T08:00:09.000Z`,
    retry_scheduled_for: null,
    client_attempt_id: "attempt-1",
    created_at: `${TODAY}T08:00:09.000Z`,
    user_answer: "hola",
    expected: ["hola"],
    delta_hours: 0.2,
    first_try: true,
    retry_index: 0,
    scheduler_outcome: "first_clean_success",
  },
  {
    id: "review-2",
    user_id: "user-1",
    daily_session_id: "session-1",
    session_date: TODAY,
    word_id: "word-2",
    queue_kind: "review",
    queue_source: "main",
    card_type: "normal",
    grade: "again",
    correct: false,
    ms_spent: 5000,
    shown_at: `${TODAY}T08:00:10.000Z`,
    submitted_at: `${TODAY}T08:00:15.000Z`,
    retry_scheduled_for: `${TODAY}T08:10:15.000Z`,
    client_attempt_id: "attempt-2",
    created_at: `${TODAY}T08:00:15.000Z`,
    user_answer: "missed",
    expected: ["adios"],
    delta_hours: 26,
    first_try: false,
    retry_index: 0,
    scheduler_outcome: "incorrect_lapse",
  },
  {
    id: "review-3",
    user_id: "user-1",
    daily_session_id: "session-1",
    session_date: TODAY,
    word_id: "word-3",
    queue_kind: "review",
    queue_source: "main",
    card_type: "mcq",
    grade: "good",
    correct: true,
    ms_spent: 3000,
    shown_at: `${TODAY}T08:00:16.000Z`,
    submitted_at: `${TODAY}T08:00:19.000Z`,
    retry_scheduled_for: null,
    client_attempt_id: "attempt-3",
    created_at: `${TODAY}T08:00:19.000Z`,
    user_answer: "sun",
    expected: ["sun"],
    delta_hours: 48,
    first_try: true,
    retry_index: 0,
    scheduler_outcome: "later_clean_review",
  },
  {
    id: "review-4",
    user_id: "user-1",
    daily_session_id: "session-1",
    session_date: TODAY,
    word_id: "word-2",
    queue_kind: "review",
    queue_source: "retry",
    card_type: "normal",
    grade: "good",
    correct: true,
    ms_spent: 2000,
    shown_at: `${TODAY}T08:10:16.000Z`,
    submitted_at: `${TODAY}T08:10:18.000Z`,
    retry_scheduled_for: null,
    client_attempt_id: "attempt-4",
    created_at: `${TODAY}T08:10:18.000Z`,
    user_answer: "got it",
    expected: ["adios"],
    // Same-session retry ~10 minutes after the main-queue miss (review-2).
    delta_hours: 0.17,
    first_try: false,
    retry_index: 1,
    scheduler_outcome: "rescued_success",
  },
];

const savedWords: AnalyticsSavedWordRow[] = [
  {
    user_id: "user-1",
    deck_id: "deck-1",
    word_id: "word-8",
    added_at: `${TODAY}T08:06:00.000Z`,
    added_via: "reader",
    session_date: TODAY,
    daily_session_id: "session-1",
    text_id: "text-1",
  },
  {
    user_id: "user-1",
    deck_id: "deck-1",
    word_id: "word-9",
    added_at: `${TODAY}T08:06:30.000Z`,
    added_via: "reader",
    session_date: TODAY,
    daily_session_id: "session-1",
    text_id: "text-1",
  },
];

describe("analytics service", () => {
  it("derives daily aggregates from canonical raw rows", () => {
    const dailyAggregates = buildDailyAggregates({
      range: { from: TODAY, to: TODAY },
      sessions: [sampleSession],
      reviewEvents,
      savedWords,
    });

    expect(dailyAggregates).toHaveLength(1);
    expect(dailyAggregates[0]).toMatchObject({
      session_date: TODAY,
      flashcard_completed_count: 3,
      flashcard_new_completed_count: 1,
      flashcard_review_completed_count: 2,
      flashcard_attempts_count: 4,
      flashcard_retry_count: 1,
      reader_saved_words_count: 2,
      reading_completed: true,
      listening_completed: true,
      total_time_seconds: 224,
    });
    expect(dailyAggregates[0].flashcard_accuracy).toBeCloseTo(0.75);
    // Main-queue review attempts only: review-2 (wrong), review-3 (right).
    expect(dailyAggregates[0].review_correctness_proxy).toBeCloseTo(1 / 2);
  });

  it("summarizes totals and builds the today snapshot from those aggregates", () => {
    const dailyAggregates = buildDailyAggregates({
      range: { from: TODAY, to: TODAY },
      sessions: [sampleSession],
      reviewEvents,
      savedWords,
    });
    const summary = buildAnalyticsSummary({
      sessions: [sampleSession],
      reviewEvents,
      savedWords,
      dailyAggregates,
    });
    const today = buildTodaySnapshot(dailyAggregates);

    expect(summary.total_sessions_started).toBe(1);
    expect(summary.total_sessions_completed).toBe(1);
    expect(summary.flashcard_accuracy).toBeCloseTo(0.75);
    expect(summary.total_flashcard_retries).toBe(1);
    expect(summary.total_reader_saved_words).toBe(2);
    expect(summary.review_retention_proxy.review_attempts).toBe(2);
    expect(summary.review_retention_proxy.review_accuracy).toBeCloseTo(1 / 2);

    expect(today).not.toBeNull();
    expect(today).toMatchObject({
      flashcards_completed: 3,
      flashcards_assigned: 3,
      new_card_main_queue_attempts: 1,
      review_card_main_queue_attempts: 2,
      reader_completed: true,
      listening_completed: true,
    });
  });

  function summarize(session: AnalyticsSessionRow, events = reviewEvents) {
    const dailyAggregates = buildDailyAggregates({
      range: { from: TODAY, to: TODAY },
      sessions: [session],
      reviewEvents: events,
      savedWords,
    });
    const summary = buildAnalyticsSummary({
      sessions: [session],
      reviewEvents: events,
      savedWords,
      dailyAggregates,
    });
    return { day: dailyAggregates[0], summary };
  }

  it("counts a day finished with retries as completed even when completed=false", () => {
    // Pilot bug: client counted the retry towards the 4-card target, server
    // counted only 3 first attempts, so the row stayed at stage='flashcards'
    // with completed=false after reading and listening were done.
    const { day, summary } = summarize({
      ...sampleSession,
      stage: "flashcards",
      assigned_flashcard_count: 4,
      flashcard_completed_count: 3,
      flashcard_attempts_count: 4,
      flashcard_retry_count: 1,
      flashcards_completed_at: null,
      completed: false,
      completed_at: null,
    });

    expect(day.session_completed).toBe(true);
    expect(summary.total_sessions_completed).toBe(1);
    expect(summary.daily_session_completion_rate).toBe(1);
    expect(summary.stage_totals.flashcards_completed).toBe(1);
    expect(summary.stage_totals.completed).toBe(1);
  });

  it("counts an extended day (completed=false, completed_at set) as completed", () => {
    // "Do more flashcards" after finishing: routed back to flashcards with
    // completed=false, a raised target, but completed_at kept.
    const { day, summary } = summarize({
      ...sampleSession,
      stage: "flashcards",
      assigned_flashcard_count: 13,
      flashcards_completed_at: null,
      completed: false,
    });

    expect(day.session_completed).toBe(true);
    expect(day.loop_completed_at_present).toBe(true);
    expect(summary.total_sessions_completed).toBe(1);
    expect(summary.daily_session_completion_rate).toBe(1);
    expect(summary.stage_totals.completed).toBe(1);
  });

  it("does not count a day whose flashcard target was not met", () => {
    const { day, summary } = summarize({
      ...sampleSession,
      stage: "flashcards",
      assigned_flashcard_count: 10,
      flashcard_attempts_count: 4,
      flashcards_completed_at: null,
      completed: false,
      completed_at: null,
    });

    expect(day.session_completed).toBe(false);
    expect(summary.total_sessions_completed).toBe(0);
    expect(summary.daily_session_completion_rate).toBe(0);
    expect(summary.stage_totals.flashcards_completed).toBe(0);
    expect(summary.stage_totals.completed).toBe(0);
  });

  it("excludes same-session retries from the retention proxy and mean delta", () => {
    const { day, summary } = summarize(sampleSession);
    const proxy = summary.review_retention_proxy;

    expect(proxy.review_attempts).toBe(2);
    expect(proxy.correct_review_attempts).toBe(1);
    expect(proxy.review_accuracy).toBeCloseTo(1 / 2);
    // Main-queue review deltas 26h and 48h; the 0.17h retry is excluded.
    expect(proxy.average_delta_hours).toBeCloseTo(37);
    expect(day.review_correctness_proxy).toBeCloseTo(1 / 2);

    const retriesOnly = summarize(
      sampleSession,
      reviewEvents.filter((event) => event.queue_source === "retry"),
    );
    expect(retriesOnly.summary.review_retention_proxy.review_attempts).toBe(0);
    expect(retriesOnly.summary.review_retention_proxy.review_accuracy).toBeNull();
    expect(retriesOnly.summary.review_retention_proxy.average_delta_hours).toBeNull();
    expect(retriesOnly.day.review_correctness_proxy).toBeNull();
  });
});
