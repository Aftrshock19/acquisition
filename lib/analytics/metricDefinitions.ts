export const EXPORT_FORMAT_VERSION = "dissertation-metrics-v1";

export type MetricDefinitionId =
  | "daily_session_completion_rate"
  | "flashcard_accuracy"
  | "new_card_main_queue_attempts_per_day"
  | "review_card_main_queue_attempts_per_day"
  | "total_flashcard_attempts_per_day"
  | "flashcard_retries_per_day"
  | "logged_active_time_per_day"
  | "reading_stage_completions_per_day"
  | "listening_stage_completions_per_day"
  | "listening_time_per_day"
  | "reader_saved_words_per_day"
  | "total_sessions_started"
  | "total_sessions_completed"
  | "completion_by_stage"
  | "stage_drop_off"
  | "days_active"
  | "workload_completed_vs_assigned"
  | "review_correctness_proxy";

export type MetricDefinition = {
  id: MetricDefinitionId;
  label: string;
  description: string;
  formula: string;
  sourceTables: string[];
  limitations?: string;
};

export const METRIC_DEFINITIONS: Record<MetricDefinitionId, MetricDefinition> = {
  daily_session_completion_rate: {
    id: "daily_session_completion_rate",
    label: "Daily session completion rate",
    description:
      "Proportion of daily sessions with a recorded started_at timestamp that subsequently reached the completed state (completed=true). Sessions created automatically but never interacted with (started_at IS NULL) are excluded from the denominator.",
    formula: "count(daily_sessions where completed=true) / count(daily_sessions where started_at IS NOT NULL)",
    sourceTables: ["daily_sessions"],
    limitations:
      "The denominator excludes auto-created sessions that were never opened. A session counts as started when started_at is set on first flashcard interaction or explicit session open.",
  },
  flashcard_accuracy: {
    id: "flashcard_accuracy",
    label: "Flashcard attempt accuracy (all queues)",
    description:
      "Proportion of correct flashcard attempts across all attempts, including both main-queue and retry-queue attempts.",
    formula: "count(review_events where correct=true) / count(review_events)",
    sourceTables: ["review_events"],
    limitations:
      "Retry attempts are included in both numerator and denominator. For main-queue-only accuracy, filter to queue_source='main'. This measures response correctness, not learning or retention.",
  },
  new_card_main_queue_attempts_per_day: {
    id: "new_card_main_queue_attempts_per_day",
    label: "New-card main-queue attempts per day",
    description:
      "Count of submitted flashcard attempts from the main queue where queue_kind='new', grouped by session date. Each row in review_events represents one submitted attempt, not a unique word learned.",
    formula: "count(review_events where queue_source='main' AND queue_kind='new') per session_date",
    sourceTables: ["review_events"],
    limitations:
      "This counts submitted attempts, not unique words encountered or words retained. A word may generate multiple attempts across days.",
  },
  review_card_main_queue_attempts_per_day: {
    id: "review_card_main_queue_attempts_per_day",
    label: "Review-card main-queue attempts per day",
    description:
      "Count of submitted flashcard attempts from the main queue where queue_kind='review', grouped by session date.",
    formula: "count(review_events where queue_source='main' AND queue_kind='review') per session_date",
    sourceTables: ["review_events"],
    limitations:
      "This counts submitted review attempts, not unique words reviewed. Retry-queue attempts are excluded.",
  },
  total_flashcard_attempts_per_day: {
    id: "total_flashcard_attempts_per_day",
    label: "Total flashcard attempts per day",
    description:
      "All submitted flashcard attempts on a given session date, including both main-queue and retry-queue attempts.",
    formula: "count(review_events) per session_date",
    sourceTables: ["review_events"],
  },
  flashcard_retries_per_day: {
    id: "flashcard_retries_per_day",
    label: "Retry-queue attempts per day",
    description:
      "Submitted flashcard attempts where queue_source='retry', grouped by session date. Retry attempts are re-presentations of incorrectly answered cards within the same session.",
    formula: "count(review_events where queue_source='retry') per session_date",
    sourceTables: ["review_events"],
    limitations:
      "Counts submitted retry attempts only. Retries that were scheduled (retry_scheduled_for) but never answered are not included.",
  },
  logged_active_time_per_day: {
    id: "logged_active_time_per_day",
    label: "Logged active time per day",
    description:
      "Sum of client-recorded active time across flashcard attempts, reading, and listening for a given session date. Flashcard time is the sum of ms_spent on submitted attempts (converted to seconds). Reading and listening time are client-recorded active seconds stored in daily_sessions.",
    formula:
      "sum(review_events.ms_spent) / 1000 + daily_sessions.reading_time_seconds + daily_sessions.listening_time_seconds",
    sourceTables: ["review_events", "daily_sessions"],
    limitations:
      "Does not include idle time, time spent navigating between app sections, or time on abandoned (unsubmitted) flashcard views. Reading and listening seconds are recorded by client-side timers and may under-count if the app is backgrounded.",
  },
  reading_stage_completions_per_day: {
    id: "reading_stage_completions_per_day",
    label: "Reading stage completions per day",
    description:
      "Count of daily sessions where the reading stage was marked complete (reading_done=true), per session date. Each session contributes at most one reading completion.",
    formula: "count(daily_sessions where reading_done=true) per session_date",
    sourceTables: ["daily_sessions"],
    limitations:
      "Binary flag per session. Does not measure reading depth, comprehension, or the amount of text read.",
  },
  listening_stage_completions_per_day: {
    id: "listening_stage_completions_per_day",
    label: "Listening stage completions per day",
    description:
      "Count of daily sessions where the listening stage was marked complete (listening_done=true), per session date. Each session contributes at most one listening completion.",
    formula: "count(daily_sessions where listening_done=true) per session_date",
    sourceTables: ["daily_sessions"],
    limitations:
      "Binary flag per session. Does not measure listening comprehension or the proportion of audio content consumed.",
  },
  listening_time_per_day: {
    id: "listening_time_per_day",
    label: "Client-recorded listening time per day",
    description:
      "Client-recorded active listening seconds for the daily listening block, stored in daily_sessions.listening_time_seconds.",
    formula: "daily_sessions.listening_time_seconds per session_date",
    sourceTables: ["daily_sessions"],
    limitations:
      "Recorded by the client-side listening player. May under-count if the app is backgrounded. Represents playback time, not comprehension time.",
  },
  reader_saved_words_per_day: {
    id: "reader_saved_words_per_day",
    label: "Reader-saved words per day",
    description:
      "Count of words saved from the interactive reader into the user's manual deck on a given session date. Source: user_deck_words where added_via='reader'.",
    formula: "count(user_deck_words where added_via='reader') per session_date",
    sourceTables: ["user_deck_words"],
    limitations:
      "Append-only at the row level: duplicate saves of the same word are ignored after the first event. Counts save events, not unique words if the same word could theoretically appear in multiple decks.",
  },
  total_sessions_started: {
    id: "total_sessions_started",
    label: "Total sessions with recorded start",
    description:
      "Count of daily sessions where started_at is not null within the selected date range. A session is started when the user first interacts with the daily loop (e.g. loads flashcards).",
    formula: "count(daily_sessions where started_at IS NOT NULL)",
    sourceTables: ["daily_sessions"],
    limitations:
      "Excludes auto-created sessions that were never opened by the user.",
  },
  total_sessions_completed: {
    id: "total_sessions_completed",
    label: "Total sessions completed",
    description:
      "Count of daily sessions where completed=true within the selected date range. A session is completed when all assigned stages (flashcards, reading, and listening if assigned) are finished.",
    formula: "count(daily_sessions where completed=true)",
    sourceTables: ["daily_sessions"],
  },
  completion_by_stage: {
    id: "completion_by_stage",
    label: "Sessions reaching each stage milestone",
    description:
      "Count of sessions that reached each stage milestone: started (started_at set), flashcards completed (flashcards_completed_at set or completed count >= assigned count), reading completed (reading_done=true), listening completed (listening_done=true with a listening asset assigned), and fully completed (completed=true).",
    formula: "count of sessions meeting each milestone condition",
    sourceTables: ["daily_sessions"],
    limitations:
      "Listening milestone is only counted for sessions where a listening asset was assigned (listening_asset_id IS NOT NULL).",
  },
  stage_drop_off: {
    id: "stage_drop_off",
    label: "Stage drop-off",
    description:
      "Number of sessions that reached a given stage milestone but did not reach the next one. Calculated as the difference between adjacent stage milestone counts.",
    formula: "sessions reaching stage N minus sessions reaching stage N+1",
    sourceTables: ["daily_sessions"],
    limitations:
      "Listening drop-off denominator is sessions that completed reading AND had a listening asset assigned, not all reading-completed sessions.",
  },
  days_active: {
    id: "days_active",
    label: "Days with recorded activity",
    description:
      "Count of distinct session dates where at least one of the following occurred: a flashcard attempt was submitted, a word was saved from the reader, the reading stage was completed, or the listening stage was completed.",
    formula:
      "count(distinct session_date where flashcard_attempts > 0 OR reader_saved_words > 0 OR reading_done OR listening_done)",
    sourceTables: ["daily_sessions", "review_events", "user_deck_words"],
  },
  workload_completed_vs_assigned: {
    id: "workload_completed_vs_assigned",
    label: "Workload units completed vs. assigned",
    description:
      "Ratio of completed workload units to assigned workload units for a session. Flashcards contribute one unit per card. Reading contributes one binary unit per session. Listening contributes one binary unit per session only when a listening asset was assigned.",
    formula:
      "(flashcard_completed_count + (1 if reading_done) + (1 if listening_done AND listening_asset_id)) / (assigned_flashcard_count + 1 + (1 if listening_asset_id))",
    sourceTables: ["daily_sessions"],
    limitations:
      "Mixed granularity: flashcard units are per-card while reading and listening are binary per-session. This metric is useful for workload adherence, not for comparing effort across modalities.",
  },
  review_correctness_proxy: {
    id: "review_correctness_proxy",
    label: "Review-card correctness (retention proxy)",
    description:
      "Proportion of correct attempts among review-card attempts (queue_kind='review'), used as a behavioural proxy for retention. This is not a direct measure of learning outcomes or long-term retention.",
    formula:
      "count(review_events where queue_kind='review' AND correct=true) / count(review_events where queue_kind='review')",
    sourceTables: ["review_events"],
    limitations:
      "This is a behavioural proxy derived from in-app review correctness. It does not measure recall outside the app, transfer to naturalistic contexts, or long-term retention beyond the SRS schedule. The proxy assumes that higher review correctness correlates with better retention, which is plausible but unvalidated for this specific implementation.",
  },
};
