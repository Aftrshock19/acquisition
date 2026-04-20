import { createHash } from "node:crypto";
import { getAppSessionTimeZone } from "@/lib/analytics/date";
import { EXPORT_FORMAT_VERSION, METRIC_DEFINITIONS } from "@/lib/analytics/metricDefinitions";
import type { AnalyticsBundle } from "@/lib/analytics/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

export type ExportDataset =
  | "all"
  | "daily_aggregates"
  | "sessions"
  | "review_events"
  | "reading_events"
  | "listening_events"
  | "saved_words"
  | "reading_question_attempts"
  | "export_runs"
  | "placement_runs"
  | "placement_responses";

const CSV_FIELD_ORDER: Record<Exclude<ExportDataset, "all">, string[]> = {
  daily_aggregates: [
    "anonymous_user_id",
    "session_date",
    "session_started",
    "session_completed",
    "stage",
    "assigned_flashcard_count",
    "assigned_new_words_count",
    "assigned_review_cards_count",
    "flashcard_completed_count",
    "flashcard_new_completed_count",
    "flashcard_review_completed_count",
    "flashcard_attempts_count",
    "flashcard_retry_count",
    "flashcard_accuracy",
    "review_correctness_proxy",
    "reader_saved_words_count",
    "reading_completed",
    "listening_completed",
    "reading_time_seconds",
    "listening_time_seconds",
    "flashcard_time_seconds",
    "total_time_seconds",
    "workload_assigned_units",
    "workload_completed_units",
    "workload_completion_rate",
    "scheduler_variant",
    "learner_state_score",
    "learner_factor",
    "workload_factor",
    "adaptive_new_word_cap",
    "reading_question_accuracy",
    "reading_question_attempts_count",
    "daily_target_mode",
  ],
  sessions: [
    "anonymous_user_id",
    "id",
    "session_date",
    "stage",
    "started_at",
    "last_active_at",
    "last_resumed_at",
    "resume_count",
    "flashcards_completed_at",
    "reading_opened_at",
    "reading_completed_at",
    "reading_time_seconds",
    "listening_opened_at",
    "listening_playback_started_at",
    "listening_completed_at",
    "listening_time_seconds",
    "listening_max_position_seconds",
    "listening_required_seconds",
    "listening_transcript_opened",
    "listening_playback_rate",
    "assigned_flashcard_count",
    "assigned_new_words_count",
    "assigned_review_cards_count",
    "daily_target_mode",
    "flashcard_completed_count",
    "flashcard_new_completed_count",
    "flashcard_review_completed_count",
    "flashcard_attempts_count",
    "flashcard_retry_count",
    "reading_done",
    "reading_text_id",
    "listening_done",
    "listening_asset_id",
    "completed",
    "completed_at",
    "created_at",
    "updated_at",
  ],
  review_events: [
    "anonymous_user_id",
    "id",
    "daily_session_id",
    "session_date",
    "word_id",
    "queue_kind",
    "queue_source",
    "card_type",
    "grade",
    "correct",
    "first_try",
    "retry_index",
    "scheduler_outcome",
    "ms_spent",
    "shown_at",
    "submitted_at",
    "retry_scheduled_for",
    "client_attempt_id",
    "created_at",
    "delta_hours",
    "user_answer",
    "expected",
    "scheduler_variant",
    "learner_factor",
    "item_factor",
    "baseline_interval_days",
    "effective_interval_days",
    "difficulty_before",
    "difficulty_after",
  ],
  reading_events: [
    "anonymous_user_id",
    "daily_session_id",
    "session_date",
    "text_id",
    "reading_opened_at",
    "reading_completed_at",
    "reading_time_seconds",
    "reader_saved_words_count",
    "reading_done",
  ],
  listening_events: [
    "anonymous_user_id",
    "daily_session_id",
    "session_date",
    "audio_asset_id",
    "listening_opened_at",
    "listening_playback_started_at",
    "listening_completed_at",
    "listening_time_seconds",
    "listening_max_position_seconds",
    "listening_required_seconds",
    "listening_transcript_opened",
    "listening_playback_rate",
    "listening_done",
  ],
  saved_words: [
    "anonymous_user_id",
    "session_date",
    "daily_session_id",
    "text_id",
    "word_id",
    "added_at",
    "added_via",
    "deck_id",
  ],
  reading_question_attempts: [
    "anonymous_user_id",
    "id",
    "daily_session_id",
    "session_date",
    "text_id",
    "question_id",
    "selected_option",
    "correct_option",
    "correct",
    "response_ms",
    "scheduler_variant",
    "created_at",
  ],
  export_runs: [
    "anonymous_user_id",
    "id",
    "format",
    "dataset",
    "date_from",
    "date_to",
    "created_at",
  ],
  placement_runs: [
    "anonymous_user_id",
    "id",
    "language",
    "status",
    "started_at",
    "completed_at",
    "skipped_at",
    "algorithm_version",
    "recognition_items_answered",
    "recall_items_answered",
    "estimated_frontier_rank",
    "estimated_frontier_rank_low",
    "estimated_frontier_rank_high",
    "estimated_receptive_vocab",
    "confidence_score",
    "raw_recognition_accuracy",
    "raw_recall_accuracy",
    "created_at",
  ],
  placement_responses: [
    "anonymous_user_id",
    "id",
    "run_id",
    "sequence_index",
    "item_type",
    "band_start",
    "band_end",
    "is_correct",
    "used_idk",
    "latency_ms",
    "answered_at",
    "previous_attempt_seen",
    "reuse_due_to_pool_exhaustion",
    "selection_seed",
  ],
};

export function anonymizeUserId(userId: string) {
  const salt =
    process.env.EXPORT_ANONYMIZATION_SALT ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    "acquisition-local-export-salt";

  return createHash("sha256")
    .update(`${salt}:${userId}`)
    .digest("hex")
    .slice(0, 16);
}

export function buildJsonExport(bundle: AnalyticsBundle, anonymousUserId: string) {
  return {
    format_version: EXPORT_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    app_session_time_zone: getAppSessionTimeZone(),
    anonymous_user_id: anonymousUserId,
    range: bundle.range,
    metric_definitions: METRIC_DEFINITIONS,
    summary: bundle.summary,
    today: bundle.today,
    datasets: {
      daily_aggregates: getExportRows("daily_aggregates", bundle, anonymousUserId),
      sessions: getExportRows("sessions", bundle, anonymousUserId),
      review_events: getExportRows("review_events", bundle, anonymousUserId),
      reading_events: getExportRows("reading_events", bundle, anonymousUserId),
      listening_events: getExportRows("listening_events", bundle, anonymousUserId),
      saved_words: getExportRows("saved_words", bundle, anonymousUserId),
      reading_question_attempts: getExportRows(
        "reading_question_attempts",
        bundle,
        anonymousUserId,
      ),
      export_runs: getExportRows("export_runs", bundle, anonymousUserId),
      placement_runs: getExportRows("placement_runs", bundle, anonymousUserId),
      placement_responses: getExportRows(
        "placement_responses",
        bundle,
        anonymousUserId,
      ),
    },
  };
}

export function getExportRows(
  dataset: Exclude<ExportDataset, "all">,
  bundle: AnalyticsBundle,
  anonymousUserId: string,
) {
  if (dataset === "daily_aggregates") {
    return bundle.dailyAggregates.map((row) => ({
      anonymous_user_id: anonymousUserId,
      ...row,
    }));
  }

  if (dataset === "sessions") {
    return bundle.sessions.map((row) => ({
      anonymous_user_id: anonymousUserId,
      ...row,
    }));
  }

  if (dataset === "review_events") {
    return bundle.reviewEvents.map((row) => ({
      anonymous_user_id: anonymousUserId,
      id: row.id,
      daily_session_id: row.daily_session_id,
      session_date: row.session_date,
      word_id: row.word_id,
      queue_kind: row.queue_kind,
      queue_source: row.queue_source,
      card_type: row.card_type,
      grade: row.grade,
      correct: row.correct,
      first_try: row.first_try,
      retry_index: row.retry_index,
      scheduler_outcome: row.scheduler_outcome,
      ms_spent: row.ms_spent,
      shown_at: row.shown_at,
      submitted_at: row.submitted_at,
      retry_scheduled_for: row.retry_scheduled_for,
      client_attempt_id: row.client_attempt_id,
      created_at: row.created_at,
      delta_hours: row.delta_hours,
      user_answer: row.user_answer,
      expected: row.expected.join(" | "),
      scheduler_variant: row.scheduler_variant ?? null,
      learner_factor: row.learner_factor ?? null,
      item_factor: row.item_factor ?? null,
      baseline_interval_days: row.baseline_interval_days ?? null,
      effective_interval_days: row.effective_interval_days ?? null,
      difficulty_before: row.difficulty_before ?? null,
      difficulty_after: row.difficulty_after ?? null,
    }));
  }

  if (dataset === "reading_events") {
    const savedWordsBySession = new Map<string, number>();
    for (const row of bundle.savedWords) {
      if (row.added_via !== "reader") {
        continue;
      }

      const key = `${row.daily_session_id ?? ""}:${row.text_id ?? ""}:${row.session_date ?? ""}`;
      savedWordsBySession.set(key, (savedWordsBySession.get(key) ?? 0) + 1);
    }

    return bundle.sessions
      .filter((row) => row.reading_opened_at || row.reading_completed_at)
      .map((row) => ({
        anonymous_user_id: anonymousUserId,
        daily_session_id: row.id,
        session_date: row.session_date,
        text_id: row.reading_text_id,
        reading_opened_at: row.reading_opened_at,
        reading_completed_at: row.reading_completed_at,
        reading_time_seconds: row.reading_time_seconds,
        reader_saved_words_count:
          savedWordsBySession.get(
            `${row.id}:${row.reading_text_id ?? ""}:${row.session_date}`,
          ) ?? 0,
        reading_done: row.reading_done,
      }));
  }

  if (dataset === "listening_events") {
    return bundle.sessions
      .filter(
        (row) =>
          row.listening_opened_at ||
          row.listening_playback_started_at ||
          row.listening_completed_at,
      )
      .map((row) => ({
        anonymous_user_id: anonymousUserId,
        daily_session_id: row.id,
        session_date: row.session_date,
        audio_asset_id: row.listening_asset_id,
        listening_opened_at: row.listening_opened_at,
        listening_playback_started_at: row.listening_playback_started_at,
        listening_completed_at: row.listening_completed_at,
        listening_time_seconds: row.listening_time_seconds,
        listening_max_position_seconds: row.listening_max_position_seconds,
        listening_required_seconds: row.listening_required_seconds,
        listening_transcript_opened: row.listening_transcript_opened,
        listening_playback_rate: row.listening_playback_rate,
        listening_done: row.listening_done,
      }));
  }

  if (dataset === "reading_question_attempts") {
    return bundle.readingQuestionAttempts.map((row) => ({
      anonymous_user_id: anonymousUserId,
      id: row.id,
      daily_session_id: row.daily_session_id,
      session_date: row.session_date,
      text_id: row.text_id,
      question_id: row.question_id,
      selected_option: row.selected_option,
      correct_option: row.correct_option,
      correct: row.correct,
      response_ms: row.response_ms,
      scheduler_variant: row.scheduler_variant,
      created_at: row.created_at,
    }));
  }

  if (dataset === "saved_words") {
    return bundle.savedWords.map((row) => ({
      anonymous_user_id: anonymousUserId,
      session_date: row.session_date,
      daily_session_id: row.daily_session_id,
      text_id: row.text_id,
      word_id: row.word_id,
      added_at: row.added_at,
      added_via: row.added_via,
      deck_id: row.deck_id,
    }));
  }

  if (dataset === "placement_runs") {
    return (bundle.placementRuns ?? []).map((row) => ({
      anonymous_user_id: anonymousUserId,
      id: row.id,
      language: row.language,
      status: row.status,
      started_at: row.started_at,
      completed_at: row.completed_at,
      skipped_at: row.skipped_at,
      algorithm_version: row.algorithm_version,
      recognition_items_answered: row.recognition_items_answered,
      recall_items_answered: row.recall_items_answered,
      estimated_frontier_rank: row.estimated_frontier_rank,
      estimated_frontier_rank_low: row.estimated_frontier_rank_low,
      estimated_frontier_rank_high: row.estimated_frontier_rank_high,
      estimated_receptive_vocab: row.estimated_receptive_vocab,
      confidence_score: row.confidence_score,
      raw_recognition_accuracy: row.raw_recognition_accuracy,
      raw_recall_accuracy: row.raw_recall_accuracy,
      created_at: row.created_at,
    }));
  }

  if (dataset === "placement_responses") {
    return (bundle.placementResponses ?? []).map((row) => ({
      anonymous_user_id: anonymousUserId,
      id: row.id,
      run_id: row.run_id,
      sequence_index: row.sequence_index,
      item_type: row.item_type,
      band_start: row.band_start,
      band_end: row.band_end,
      is_correct: row.is_correct,
      used_idk: row.used_idk,
      latency_ms: row.latency_ms,
      answered_at: row.answered_at,
      previous_attempt_seen: row.previous_attempt_seen,
      reuse_due_to_pool_exhaustion: row.reuse_due_to_pool_exhaustion,
      selection_seed: row.selection_seed,
    }));
  }

  return bundle.exportRuns.map((row) => ({
    anonymous_user_id: anonymousUserId,
    id: row.id,
    format: row.format,
    dataset: row.dataset,
    date_from: row.date_from,
    date_to: row.date_to,
    created_at: row.created_at,
  }));
}

export function toCsv(
  dataset: Exclude<ExportDataset, "all">,
  rows: Record<string, unknown>[],
) {
  const headers = CSV_FIELD_ORDER[dataset];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => escapeCsvCell(row[header]))
        .join(","),
    ),
  ];

  return lines.join("\n");
}

export async function logExportRun(
  supabase: SupabaseServerClient,
  userId: string,
  input: {
    anonymousUserId: string;
    format: "json" | "csv";
    dataset: ExportDataset;
    dateFrom: string;
    dateTo: string;
  },
) {
  const { error } = await supabase.from("export_runs").insert({
    user_id: userId,
    anonymized_user_id: input.anonymousUserId,
    format: input.format,
    dataset: input.dataset,
    date_from: input.dateFrom,
    date_to: input.dateTo,
  });

  if (error) {
    throw new Error(error.message);
  }
}

function escapeCsvCell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const normalized =
    typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);

  if (!/[",\n]/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replaceAll('"', '""')}"`;
}
