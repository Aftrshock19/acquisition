import { getAppSessionDate } from "@/lib/analytics/date";
import type {
  AnalyticsBundle,
  AnalyticsDateRange,
  AnalyticsExportRunRow,
  AnalyticsPlacementResponseRow,
  AnalyticsPlacementRunRow,
  AnalyticsReadingQuestionAttemptRow,
  AnalyticsReviewEventRow,
  AnalyticsSavedWordRow,
  AnalyticsSessionRow,
  AnalyticsSummary,
  DailyAggregate,
  RetentionProxySummary,
  StageDropOff,
  StageTotals,
  TodayProgressSnapshot,
} from "@/lib/analytics/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

export async function getUserAnalyticsBundle(
  supabase: SupabaseServerClient,
  userId: string,
  range: AnalyticsDateRange,
): Promise<AnalyticsBundle> {
  const [sessions, reviewEvents, savedWords, readingQuestionAttempts, exportRuns, placementRuns, placementResponses] =
    await Promise.all([
      fetchSessions(supabase, userId, range),
      fetchReviewEvents(supabase, userId, range),
      fetchSavedWords(supabase, userId, range),
      fetchReadingQuestionAttempts(supabase, userId, range),
      fetchExportRuns(supabase, userId, range),
      fetchPlacementRuns(supabase, userId),
      fetchPlacementResponses(supabase, userId),
    ]);

  const dailyAggregates = buildDailyAggregates({
    range,
    sessions,
    reviewEvents,
    savedWords,
  });
  const summary = buildAnalyticsSummary({
    sessions,
    reviewEvents,
    savedWords,
    dailyAggregates,
  });
  const today = buildTodaySnapshot(dailyAggregates);

  return {
    range,
    sessions,
    reviewEvents,
    savedWords,
    readingQuestionAttempts,
    exportRuns,
    dailyAggregates,
    summary,
    today,
    placementRuns,
    placementResponses,
  };
}

async function fetchPlacementRuns(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<AnalyticsPlacementRunRow[]> {
  const { data, error } = await supabase
    .from("baseline_test_runs")
    .select(
      "id,user_id,language,status,started_at,completed_at,skipped_at,algorithm_version,recognition_items_answered,recall_items_answered,estimated_frontier_rank,estimated_frontier_rank_low,estimated_frontier_rank_high,estimated_receptive_vocab,confidence_score,raw_recognition_accuracy,raw_recall_accuracy,placement_summary,created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data ?? []) as AnalyticsPlacementRunRow[];
}

async function fetchPlacementResponses(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<AnalyticsPlacementResponseRow[]> {
  const { data, error } = await supabase
    .from("baseline_test_responses")
    .select(
      "id,run_id,user_id,word_id,item_bank_id,sequence_index,item_type,band_start,band_end,is_correct,used_idk,latency_ms,answered_at,previous_attempt_seen,reuse_due_to_pool_exhaustion,selection_seed",
    )
    .eq("user_id", userId)
    .order("answered_at", { ascending: true });
  if (error) return [];
  return (data ?? []) as AnalyticsPlacementResponseRow[];
}

async function fetchReadingQuestionAttempts(
  supabase: SupabaseServerClient,
  userId: string,
  range: AnalyticsDateRange,
) {
  const { data, error } = await supabase
    .from("reading_question_attempts")
    .select(
      "id,user_id,daily_session_id,session_date,text_id,question_id,selected_option,correct_option,correct,response_ms,scheduler_variant,created_at",
    )
    .eq("user_id", userId)
    .gte("session_date", range.from)
    .lte("session_date", range.to)
    .order("session_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as AnalyticsReadingQuestionAttemptRow[];
}

async function fetchSessions(
  supabase: SupabaseServerClient,
  userId: string,
  range: AnalyticsDateRange,
) {
  const { data, error } = await supabase
    .from("daily_sessions")
    .select("*")
    .eq("user_id", userId)
    .gte("session_date", range.from)
    .lte("session_date", range.to)
    .order("session_date", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as AnalyticsSessionRow[];
}

async function fetchReviewEvents(
  supabase: SupabaseServerClient,
  userId: string,
  range: AnalyticsDateRange,
) {
  const { data, error } = await supabase
    .from("review_events")
    .select(
      "id,user_id,daily_session_id,session_date,word_id,queue_kind,queue_source,card_type,grade,correct,ms_spent,shown_at,submitted_at,retry_scheduled_for,client_attempt_id,created_at,user_answer,expected,delta_hours,first_try,retry_index,scheduler_outcome,scheduler_variant,learner_factor,item_factor,baseline_interval_days,effective_interval_days,difficulty_before,difficulty_after",
    )
    .eq("user_id", userId)
    .gte("session_date", range.from)
    .lte("session_date", range.to)
    .order("session_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as AnalyticsReviewEventRow[];
}

async function fetchSavedWords(
  supabase: SupabaseServerClient,
  userId: string,
  range: AnalyticsDateRange,
) {
  const { data, error } = await supabase
    .from("user_deck_words")
    .select("user_id,deck_id,word_id,added_at,added_via,session_date,daily_session_id,text_id")
    .eq("user_id", userId)
    .gte("session_date", range.from)
    .lte("session_date", range.to)
    .order("session_date", { ascending: true })
    .order("added_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as AnalyticsSavedWordRow[];
}

async function fetchExportRuns(
  supabase: SupabaseServerClient,
  userId: string,
  range: AnalyticsDateRange,
) {
  const { data, error } = await supabase
    .from("export_runs")
    .select("id,user_id,anonymized_user_id,format,dataset,date_from,date_to,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as AnalyticsExportRunRow[]).filter((row) => {
    const createdSessionDate = getAppSessionDate(new Date(row.created_at));
    return createdSessionDate >= range.from && createdSessionDate <= range.to;
  });
}

export function buildDailyAggregates({
  range,
  sessions,
  reviewEvents,
  savedWords,
}: {
  range: AnalyticsDateRange;
  sessions: AnalyticsSessionRow[];
  reviewEvents: AnalyticsReviewEventRow[];
  savedWords: AnalyticsSavedWordRow[];
}) {
  const sessionByDate = new Map(sessions.map((session) => [session.session_date, session]));
  const reviewsByDate = groupBy(reviewEvents, (row) => row.session_date ?? "");
  const savedWordsByDate = groupBy(savedWords, (row) => row.session_date ?? "");
  const dates = enumerateSessionDates(range);

  return dates.map<DailyAggregate>((sessionDate) => {
    const session = sessionByDate.get(sessionDate) ?? null;
    const dayReviewEvents = reviewsByDate.get(sessionDate) ?? [];
    const daySavedWords = savedWordsByDate.get(sessionDate) ?? [];

    const attempts = dayReviewEvents.length;
    const correctAttempts = dayReviewEvents.filter((event) => event.correct).length;
    const retryAttempts = dayReviewEvents.filter(
      (event) => event.queue_source === "retry",
    ).length;
    const mainAttempts = dayReviewEvents.filter(
      (event) => event.queue_source !== "retry",
    );
    const newCompletedCount = mainAttempts.filter(
      (event) => event.queue_kind === "new",
    ).length;
    const reviewCompletedCount = mainAttempts.filter(
      (event) => event.queue_kind === "review",
    ).length;
    const flashcardCompletedCount =
      mainAttempts.length > 0
        ? mainAttempts.length
        : session?.flashcard_completed_count ?? 0;
    const flashcardTimeSeconds = Math.round(
      dayReviewEvents.reduce((total, event) => total + Math.max(0, event.ms_spent), 0) /
        1000,
    );
    const reviewAttempts = dayReviewEvents.filter(
      (event) => event.queue_kind === "review",
    );
    const reviewCorrect = reviewAttempts.filter((event) => event.correct).length;
    const readerSavedWordsCount = daySavedWords.filter(
      (row) => row.added_via === "reader",
    ).length;
    const readingTimeSeconds = Math.max(0, session?.reading_time_seconds ?? 0);
    const listeningTimeSeconds =
      Math.max(
        0,
        session?.listening_time_seconds ??
          session?.listening_max_position_seconds ??
          0,
      ) || 0;
    const totalTimeSeconds =
      flashcardTimeSeconds + readingTimeSeconds + listeningTimeSeconds;
    const workloadAssignedUnits = getWorkloadAssignedUnits(session);
    const workloadCompletedUnits = getWorkloadCompletedUnits(
      session,
      flashcardCompletedCount,
    );
    const daysActiveFlag =
      attempts > 0 ||
      readerSavedWordsCount > 0 ||
      Boolean(session?.reading_done) ||
      Boolean(session?.listening_done);

    return {
      session_date: sessionDate,
      session_started: Boolean(session?.started_at),
      session_completed: Boolean(session?.completed),
      stage: session?.stage ?? null,
      assigned_flashcard_count:
        session?.assigned_flashcard_count ?? session?.new_words_count ?? 0,
      assigned_new_words_count: session?.assigned_new_words_count ?? 0,
      assigned_review_cards_count: session?.assigned_review_cards_count ?? 0,
      flashcard_completed_count: flashcardCompletedCount,
      flashcard_new_completed_count:
        newCompletedCount > 0
          ? newCompletedCount
          : session?.flashcard_new_completed_count ?? 0,
      flashcard_review_completed_count:
        reviewCompletedCount > 0
          ? reviewCompletedCount
          : session?.flashcard_review_completed_count ?? 0,
      flashcard_attempts_count:
        attempts > 0 ? attempts : session?.flashcard_attempts_count ?? 0,
      flashcard_retry_count:
        retryAttempts > 0 ? retryAttempts : session?.flashcard_retry_count ?? 0,
      flashcard_accuracy:
        attempts > 0 ? correctAttempts / attempts : null,
      review_correctness_proxy:
        reviewAttempts.length > 0 ? reviewCorrect / reviewAttempts.length : null,
      reader_saved_words_count: readerSavedWordsCount,
      reading_completed: Boolean(session?.reading_done),
      listening_completed: Boolean(session?.listening_done),
      reading_time_seconds: readingTimeSeconds,
      listening_time_seconds: listeningTimeSeconds,
      flashcard_time_seconds: flashcardTimeSeconds,
      total_time_seconds: totalTimeSeconds,
      days_active_flag: daysActiveFlag,
      workload_assigned_units: workloadAssignedUnits,
      workload_completed_units: workloadCompletedUnits,
      workload_completion_rate:
        workloadAssignedUnits > 0
          ? workloadCompletedUnits / workloadAssignedUnits
          : null,
      scheduler_variant: session?.scheduler_variant ?? null,
      learner_state_score: session?.learner_state_score ?? null,
      learner_factor: session?.learner_factor ?? null,
      workload_factor: session?.workload_factor ?? null,
      adaptive_new_word_budget: session?.adaptive_new_word_budget ?? null,
      reading_question_accuracy: session?.reading_question_accuracy ?? null,
      reading_question_attempts_count: session?.reading_question_attempts_count ?? 0,
    };
  });
}

export function buildAnalyticsSummary({
  sessions,
  reviewEvents,
  savedWords,
  dailyAggregates,
}: {
  sessions: AnalyticsSessionRow[];
  reviewEvents: AnalyticsReviewEventRow[];
  savedWords: AnalyticsSavedWordRow[];
  dailyAggregates: DailyAggregate[];
}): AnalyticsSummary {
  const totalSessionsStarted = sessions.filter((session) => session.started_at).length;
  const totalSessionsCompleted = sessions.filter((session) => session.completed).length;
  const totalFlashcardAttempts = reviewEvents.length;
  const correctAttempts = reviewEvents.filter((event) => event.correct).length;
  const totalFlashcardRetries = reviewEvents.filter(
    (event) => event.queue_source === "retry",
  ).length;
  const totalReaderSavedWords = savedWords.filter(
    (row) => row.added_via === "reader",
  ).length;
  const totalReadingCompletions = sessions.filter((session) => session.reading_done).length;
  const totalListeningCompletions = sessions.filter(
    (session) => session.listening_done,
  ).length;
  const stageTotals = buildStageTotals(sessions);
  const stageDropOff = buildStageDropOff(stageTotals, sessions);
  const reviewRetentionProxy = buildRetentionProxy(reviewEvents);

  return {
    total_sessions_started: totalSessionsStarted,
    total_sessions_completed: totalSessionsCompleted,
    daily_session_completion_rate:
      totalSessionsStarted > 0
        ? totalSessionsCompleted / totalSessionsStarted
        : null,
    flashcard_accuracy:
      totalFlashcardAttempts > 0 ? correctAttempts / totalFlashcardAttempts : null,
    review_retention_proxy: reviewRetentionProxy,
    stage_totals: stageTotals,
    stage_drop_off: stageDropOff,
    days_active: dailyAggregates.filter((aggregate) => aggregate.days_active_flag).length,
    total_flashcard_attempts: totalFlashcardAttempts,
    total_flashcard_retries: totalFlashcardRetries,
    total_reader_saved_words: totalReaderSavedWords,
    total_reading_completions: totalReadingCompletions,
    total_listening_completions: totalListeningCompletions,
    total_time_seconds: dailyAggregates.reduce(
      (total, aggregate) => total + aggregate.total_time_seconds,
      0,
    ),
  };
}

export function buildTodaySnapshot(
  dailyAggregates: DailyAggregate[],
): TodayProgressSnapshot | null {
  const todaySessionDate = getAppSessionDate();
  const today = dailyAggregates.find(
    (aggregate) => aggregate.session_date === todaySessionDate,
  );

  if (!today) {
    return null;
  }

  return {
    session_date: today.session_date,
    session_started: today.session_started,
    session_completed: today.session_completed,
    stage: today.stage,
    flashcards_completed: today.flashcard_completed_count,
    flashcards_assigned: today.assigned_flashcard_count,
    accuracy: today.flashcard_accuracy,
    new_card_main_queue_attempts: today.flashcard_new_completed_count,
    review_card_main_queue_attempts: today.flashcard_review_completed_count,
    reader_completed: today.reading_completed,
    listening_completed: today.listening_completed,
    reader_saved_words: today.reader_saved_words_count,
    logged_active_time_seconds: today.total_time_seconds,
  };
}

function buildStageTotals(sessions: AnalyticsSessionRow[]): StageTotals {
  return {
    started: sessions.filter((session) => session.started_at).length,
    flashcards_completed: sessions.filter(
      (session) =>
        Boolean(session.flashcards_completed_at) ||
        session.flashcard_completed_count >= session.assigned_flashcard_count,
    ).length,
    reading_completed: sessions.filter((session) => session.reading_done).length,
    listening_completed: sessions.filter(
      (session) => session.listening_asset_id && session.listening_done,
    ).length,
    completed: sessions.filter((session) => session.completed).length,
  };
}

function buildStageDropOff(stageTotals: StageTotals, sessions: AnalyticsSessionRow[]): StageDropOff {
  const listeningEligible = sessions.filter(
    (session) => session.reading_done && session.listening_asset_id,
  ).length;

  return {
    before_flashcards_complete: Math.max(
      0,
      stageTotals.started - stageTotals.flashcards_completed,
    ),
    before_reading_complete: Math.max(
      0,
      stageTotals.flashcards_completed - stageTotals.reading_completed,
    ),
    before_listening_complete: Math.max(
      0,
      listeningEligible - stageTotals.listening_completed,
    ),
  };
}

function buildRetentionProxy(reviewEvents: AnalyticsReviewEventRow[]): RetentionProxySummary {
  const reviewAttempts = reviewEvents.filter((event) => event.queue_kind === "review");
  const correctReviewAttempts = reviewAttempts.filter((event) => event.correct).length;
  const deltas = reviewAttempts
    .map((event) => event.delta_hours)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    review_attempts: reviewAttempts.length,
    correct_review_attempts: correctReviewAttempts,
    review_accuracy:
      reviewAttempts.length > 0 ? correctReviewAttempts / reviewAttempts.length : null,
    average_delta_hours:
      deltas.length > 0
        ? deltas.reduce((total, delta) => total + delta, 0) / deltas.length
        : null,
  };
}

function getWorkloadAssignedUnits(session: AnalyticsSessionRow | null) {
  if (!session) {
    return 0;
  }

  return (
    Math.max(0, session.assigned_flashcard_count ?? session.new_words_count ?? 0) +
    1 +
    (session.listening_asset_id ? 1 : 0)
  );
}

function getWorkloadCompletedUnits(
  session: AnalyticsSessionRow | null,
  flashcardCompletedCount: number,
) {
  if (!session) {
    return 0;
  }

  return (
    flashcardCompletedCount +
    (session.reading_done ? 1 : 0) +
    (session.listening_asset_id && session.listening_done ? 1 : 0)
  );
}

function enumerateSessionDates(range: AnalyticsDateRange) {
  const dates: string[] = [];
  const cursor = new Date(`${range.from}T00:00:00.000Z`);
  const end = new Date(`${range.to}T00:00:00.000Z`);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function groupBy<T>(rows: T[], getKey: (row: T) => string) {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    const key = getKey(row);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(row);
      continue;
    }

    grouped.set(key, [row]);
  }

  return grouped;
}
