import type { DailySessionRow, FlashcardQueueKind, FlashcardQueueSource, FlashcardType, Grade } from "@/lib/srs/types";

export type AnalyticsDateRange = {
  from: string;
  to: string;
};

export type AnalyticsSessionRow = DailySessionRow;

export type SchedulerOutcome =
  | "first_clean_success"
  | "second_clean_success"
  | "later_clean_review"
  | "rescued_success"
  | "incorrect_lapse";

export type AnalyticsReviewEventRow = {
  id: string;
  user_id: string;
  daily_session_id: string | null;
  session_date: string | null;
  word_id: string;
  queue_kind: FlashcardQueueKind | null;
  queue_source: FlashcardQueueSource;
  card_type: FlashcardType;
  grade: Grade;
  correct: boolean;
  ms_spent: number;
  shown_at: string | null;
  submitted_at: string | null;
  retry_scheduled_for: string | null;
  client_attempt_id: string | null;
  created_at: string;
  happened_at?: string | null;
  user_answer: string;
  expected: string[];
  delta_hours: number | null;
  first_try: boolean | null;
  retry_index: number | null;
  scheduler_outcome: SchedulerOutcome | null;
};

export type AnalyticsSavedWordRow = {
  user_id: string;
  deck_id: string;
  word_id: string;
  added_at: string;
  added_via: string;
  session_date: string | null;
  daily_session_id: string | null;
  text_id: string | null;
};

export type AnalyticsExportRunRow = {
  id: string;
  user_id: string;
  anonymized_user_id: string;
  format: "json" | "csv";
  dataset: string;
  date_from: string | null;
  date_to: string | null;
  created_at: string;
};

export type DailyAggregate = {
  session_date: string;
  session_started: boolean;
  session_completed: boolean;
  stage: DailySessionRow["stage"] | null;
  assigned_flashcard_count: number;
  assigned_new_words_count: number;
  assigned_review_cards_count: number;
  flashcard_completed_count: number;
  flashcard_new_completed_count: number;
  flashcard_review_completed_count: number;
  flashcard_attempts_count: number;
  flashcard_retry_count: number;
  flashcard_accuracy: number | null;
  review_correctness_proxy: number | null;
  reader_saved_words_count: number;
  reading_completed: boolean;
  listening_completed: boolean;
  reading_time_seconds: number;
  listening_time_seconds: number;
  flashcard_time_seconds: number;
  total_time_seconds: number;
  days_active_flag: boolean;
  workload_assigned_units: number;
  workload_completed_units: number;
  workload_completion_rate: number | null;
};

export type StageTotals = {
  started: number;
  flashcards_completed: number;
  reading_completed: number;
  listening_completed: number;
  completed: number;
};

export type StageDropOff = {
  before_flashcards_complete: number;
  before_reading_complete: number;
  before_listening_complete: number;
};

export type RetentionProxySummary = {
  review_attempts: number;
  correct_review_attempts: number;
  review_accuracy: number | null;
  average_delta_hours: number | null;
};

export type AnalyticsSummary = {
  total_sessions_started: number;
  total_sessions_completed: number;
  daily_session_completion_rate: number | null;
  flashcard_accuracy: number | null;
  review_retention_proxy: RetentionProxySummary;
  stage_totals: StageTotals;
  stage_drop_off: StageDropOff;
  days_active: number;
  total_flashcard_attempts: number;
  total_flashcard_retries: number;
  total_reader_saved_words: number;
  total_reading_completions: number;
  total_listening_completions: number;
  total_time_seconds: number;
};

export type TodayProgressSnapshot = {
  session_date: string;
  session_started: boolean;
  session_completed: boolean;
  stage: DailySessionRow["stage"] | null;
  flashcards_completed: number;
  flashcards_assigned: number;
  accuracy: number | null;
  new_card_main_queue_attempts: number;
  review_card_main_queue_attempts: number;
  reader_completed: boolean;
  listening_completed: boolean;
  reader_saved_words: number;
  logged_active_time_seconds: number;
};

export type AnalyticsBundle = {
  range: AnalyticsDateRange;
  sessions: AnalyticsSessionRow[];
  reviewEvents: AnalyticsReviewEventRow[];
  savedWords: AnalyticsSavedWordRow[];
  exportRuns: AnalyticsExportRunRow[];
  dailyAggregates: DailyAggregate[];
  summary: AnalyticsSummary;
  today: TodayProgressSnapshot | null;
};

export type ConsistencyIssue = {
  id: string;
  severity: "error" | "warning";
  message: string;
  details: string[];
};
