"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, getSupabaseServerContext } from "@/lib/supabase/server";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { getTodayDailySessionRow, getTodaySessionDate } from "@/lib/loop/dailySessions";
import {
  getListeningAssetById,
  getListeningAssetForTextId,
} from "@/lib/loop/listening";
import { EMPTY_SAVED_WORDS_STATE, getSavedWordsState, type SavedWordsState } from "@/lib/reader/savedWords";
import { MAX_DUE_REVIEWS, MAX_NEW_WORDS } from "@/lib/srs/constants";
import type {
  TodaySession,
  DueReviewItem,
  Word,
  QueueItem,
  RecordReviewPayload,
  RecordExposurePayload,
  DailySessionRow,
  Grade,
} from "@/lib/srs/types";
import { getUserSettings } from "@/lib/settings/getUserSettings";
import { getMcqQuestionFormatsPreference } from "@/lib/settings/mcqQuestionFormats";
import { recommendSettings } from "@/lib/settings/recommendSettings";
import { resolveEffectiveSettings } from "@/lib/settings/resolveEffectiveSettings";
import type { EnabledFlashcardMode } from "@/lib/settings/types";

export type GetDailyQueueResult =
  | { ok: true; session: TodaySession }
  | {
      ok: false;
      session?: TodaySession;
      configMissing?: boolean;
      signedIn?: boolean;
      error?: string;
    };

export type TodayFlashcardsResult =
  | {
      ok: true;
      session: TodaySession;
      dailySession: DailySessionRow | null;
      effectiveSettings: {
        dailyLimit: number;
        retryDelaySeconds: number;
        autoAdvanceCorrect: boolean;
        showPosHint: boolean;
        showDefinitionFirst: boolean;
        hideTranslationSentences: boolean;
        mcqQuestionFormats: Awaited<
          ReturnType<typeof getMcqQuestionFormatsPreference>
        >;
        enabledTypes: Record<EnabledFlashcardMode, boolean>;
      };
      savedWords: SavedWordsState;
    }
  | {
      ok: false;
      session?: TodaySession;
      configMissing?: boolean;
      signedIn?: boolean;
      error?: string;
      dailySession?: DailySessionRow | null;
      effectiveSettings: {
        dailyLimit: number;
        retryDelaySeconds: number;
        autoAdvanceCorrect: boolean;
        showPosHint: boolean;
        showDefinitionFirst: boolean;
        hideTranslationSentences: boolean;
        mcqQuestionFormats: Awaited<
          ReturnType<typeof getMcqQuestionFormatsPreference>
        >;
        enabledTypes: Record<EnabledFlashcardMode, boolean>;
      };
      savedWords: SavedWordsState;
    };

export type FlashcardDebugSnapshot = {
  dailySession: DailySessionRow | null;
  currentUserWord: Record<string, unknown> | null;
  lastReviewEvent: Record<string, unknown> | null;
};

type DailySessionProgressState = {
  assignedFlashcardCount: number;
  assignedNewWordsCount: number;
  assignedReviewCardsCount: number;
  flashcardCompletedCount: number;
  readingDone: boolean;
  listeningDone: boolean;
};

const SESSION_RESUME_THRESHOLD_MS = 15 * 60 * 1000;

export type CompleteReadingStepResult =
  | {
      ok: true;
      dailySession: DailySessionRow;
      nextPath: string;
    }
  | {
      ok: false;
      error: string;
    };

export type CompleteListeningStepResult =
  | {
      ok: true;
      dailySession: DailySessionRow;
      nextPath: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function getDailyQueue(
  lang: string,
  newLimit?: number,
  reviewLimit?: number,
): Promise<GetDailyQueueResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return {
      ok: false,
      session: { dueReviews: [], newWords: [] },
      configMissing: true,
    };
  }

  const { supabase, user, error: authError } = await getSupabaseServerContext();
  if (!supabase) {
    return {
      ok: false,
      session: { dueReviews: [], newWords: [] },
      configMissing: true,
    };
  }

  if (authError) {
    return {
      ok: false,
      session: { dueReviews: [], newWords: [] },
      signedIn: false,
      error: authError,
    };
  }

  if (!user) {
    return {
      ok: false,
      session: { dueReviews: [], newWords: [] },
      signedIn: false,
    };
  }

  const limitNew = newLimit ?? MAX_NEW_WORDS;
  const limitReview = reviewLimit ?? MAX_DUE_REVIEWS;

  const { data: rows, error } = await supabase.rpc("get_daily_queue", {
    p_lang: lang,
    p_new_limit: limitNew,
    p_review_limit: limitReview,
  });

  if (error) {
    return {
      ok: false,
      session: { dueReviews: [], newWords: [] },
      signedIn: true,
      error: `Couldn't load queue: ${error.message}`,
    };
  }

  const items = (rows ?? []) as QueueItem[];
  const dueReviews: DueReviewItem[] = items
    .filter((r) => r.kind === "review")
    .map((r) => ({
      id: r.word_id,
      word_id: r.word_id,
      language: lang,
      lemma: r.lemma,
      rank: r.rank,
      translation: r.translation ?? null,
      definition: r.definition ?? null,
      definitionEs: r.definition_es ?? null,
      definitionEn: r.definition_en ?? null,
      exampleSentence: r.example_sentence ?? null,
      exampleSentenceEn: r.example_sentence_en ?? null,
      user_id: user.id,
      status: "learning",
      pos: r.pos ?? null,
    }));
  let filteredDueReviews = dueReviews;

  if (dueReviews.length > 0) {
    const today = getTodaySessionDate();
    const { data: reviewedTodayRows, error: reviewedTodayError } = await supabase
      .from("user_words")
      .select("word_id")
      .eq("user_id", user.id)
      .eq("reps_today_date", today)
      .gt("reps_today", 0)
      .in("word_id", dueReviews.map((r) => r.word_id));

    if (!reviewedTodayError && (reviewedTodayRows?.length ?? 0) > 0) {
      const reviewedTodayIds = new Set(
        (reviewedTodayRows as Array<{ word_id: string }>).map((row) => row.word_id),
      );
      filteredDueReviews = dueReviews.filter((r) => !reviewedTodayIds.has(r.word_id));
    }
  }

  const newWords: Word[] = items
    .filter((r) => r.kind === "new")
    .map((r) => ({
      id: r.word_id,
      language: lang,
      lemma: r.lemma,
      rank: r.rank,
      translation: r.translation ?? null,
      definition: r.definition ?? null,
      definitionEs: r.definition_es ?? null,
      definitionEn: r.definition_en ?? null,
      exampleSentence: r.example_sentence ?? null,
      exampleSentenceEn: r.example_sentence_en ?? null,
      pos: r.pos ?? null,
    }));

  return {
    ok: true,
    session: { dueReviews: filteredDueReviews, newWords, signedIn: true },
  };
}

export async function getTodayFlashcards(lang: string): Promise<TodayFlashcardsResult> {
  const [
    { settings, signedIn },
    mcqQuestionFormats,
    recommended,
    existingDailySession,
    savedWords,
  ] = await Promise.all([
    getUserSettings(),
    getMcqQuestionFormatsPreference(),
    recommendSettings(),
    getTodayDailySession(),
    getTodaySavedWordsState(lang),
  ]);
  const effective = resolveEffectiveSettings(settings, recommended);
  const completedToday = Math.max(
    0,
    existingDailySession?.flashcard_completed_count ??
      existingDailySession?.reviews_done ??
      0,
  );
  const remainingDailyLimit = Math.max(0, effective.effectiveDailyLimit - completedToday);
  const queueLimit = Math.max(1, remainingDailyLimit);

  const effectiveSettings = {
    dailyLimit: effective.effectiveDailyLimit,
    retryDelaySeconds: effective.retryDelaySeconds,
    autoAdvanceCorrect: effective.autoAdvanceCorrect,
    showPosHint: effective.showPosHint,
    showDefinitionFirst: effective.showDefinitionFirst,
    hideTranslationSentences: effective.hideTranslationSentences,
    mcqQuestionFormats,
    enabledTypes: effective.enabledModes,
  };

  const queueResult = await getDailyQueue(
    lang,
    queueLimit,
    queueLimit,
  );

  if (!queueResult.ok) {
    return {
      ok: false,
      session: queueResult.session,
      configMissing: queueResult.configMissing,
      signedIn: queueResult.signedIn ?? signedIn,
      error: queueResult.error,
      dailySession: null,
      effectiveSettings,
      savedWords,
    };
  }

  const session = limitTodaySession(queueResult.session, remainingDailyLimit);
  const dailySession = await upsertDailySession(session, existingDailySession);

  return {
    ok: true,
    session,
    dailySession,
    effectiveSettings,
    savedWords,
  };
}

async function getTodayDailySession(): Promise<DailySessionRow | null> {
  const { supabase, user } = await getSupabaseServerContext();
  if (!supabase || !user) return null;

  return getTodayDailySessionRow(supabase, user.id);
}

async function getTodaySavedWordsState(language: string): Promise<SavedWordsState> {
  const { supabase, user } = await getSupabaseServerContext();
  if (!supabase || !user) {
    return EMPTY_SAVED_WORDS_STATE;
  }

  return getSavedWordsState(supabase, user.id, language);
}

export type RecordReviewResult =
  | { ok: true; debugSnapshot: FlashcardDebugSnapshot }
  | { ok: false; error: string };

export async function recordReview(
  payload: RecordReviewPayload,
): Promise<RecordReviewResult> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      return {
        ok: false,
        error: "Supabase env vars NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing",
      };
    }

    const { supabase, user, error: authError } = await getSupabaseServerContext();
    if (!supabase) {
      return {
        ok: false,
        error: "Supabase client could not be created on the server",
      };
    }
    if (authError) {
      return { ok: false, error: authError };
    }

    if (!user) {
      return { ok: false, error: "Not authenticated" };
    }

    const grade = resolveGrade(payload);
    const queueSource = payload.queueSource ?? "main";
    const retryScheduledFor =
      queueSource === "main" && grade === "again" && payload.retryScheduledFor
        ? payload.retryScheduledFor
        : queueSource === "main" && grade === "again"
          ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
          : null;

    const { error } = await supabase.rpc("record_review", {
      p_word_id: payload.wordId,
      p_grade: grade,
      p_ms_spent: payload.msSpent,
      p_user_answer: payload.userAnswer ?? "",
      p_expected: payload.expected ?? [],
      p_card_type: payload.cardType ?? "cloze",
      p_session_date: getTodaySessionDate(),
      p_queue_kind: payload.queueKind ?? null,
      p_queue_source: queueSource,
      p_shown_at: payload.shownAt ?? null,
      p_submitted_at: payload.submittedAt ?? null,
      p_retry_scheduled_for: retryScheduledFor,
      p_client_attempt_id: payload.clientAttemptId ?? null,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    const debugSnapshot = await getFlashcardDebugSnapshot(payload.wordId);

    return { ok: true, debugSnapshot };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to record review",
    };
  }
}

function resolveGrade(payload: RecordReviewPayload): Grade {
  if (payload.grade && isValidGrade(payload.grade)) return payload.grade;
  return payload.correct ? "good" : "again";
}

function isValidGrade(value: string): value is Grade {
  return value === "again" || value === "hard" || value === "good" || value === "easy";
}

export type RecordExposureResult = { ok: true } | { ok: false; error: string };

export async function recordExposure(
  payload: RecordExposurePayload,
): Promise<RecordExposureResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return {
      ok: false,
      error: "Supabase env vars NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing",
    };
  }

  const { supabase, user, error: authError } = await getSupabaseServerContext();
  if (!supabase) {
    return {
      ok: false,
      error: "Supabase client could not be created on the server",
    };
  }
  if (authError) {
    return { ok: false, error: authError };
  }

  if (!user) {
    return { ok: false, error: "Not authenticated" };
  }

  const { error } = await supabase.rpc("record_exposure", {
    p_word_id: payload.wordId,
    p_kind: payload.kind,
    p_weight: payload.weight ?? 0.1,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

function getDailySessionProgressState(
  current:
    | {
        assigned_flashcard_count?: number | null;
        assigned_new_words_count?: number | null;
        assigned_review_cards_count?: number | null;
        flashcard_completed_count?: number | null;
        new_words_count?: number | null;
        reviews_done?: number | null;
        reading_done?: boolean | null;
        listening_done?: boolean | null;
      }
    | null,
  fallbackCounts?: {
    assignedFlashcardCount?: number;
    assignedNewWordsCount?: number;
    assignedReviewCardsCount?: number;
  },
): DailySessionProgressState {
  const assignedFlashcardCount = Math.max(
    0,
    current?.assigned_flashcard_count ??
      current?.new_words_count ??
      fallbackCounts?.assignedFlashcardCount ??
      0,
  );
  const assignedNewWordsCount = Math.max(
    0,
    current?.assigned_new_words_count ?? fallbackCounts?.assignedNewWordsCount ?? 0,
  );
  const assignedReviewCardsCount = Math.max(
    0,
    current?.assigned_review_cards_count ??
      fallbackCounts?.assignedReviewCardsCount ??
      0,
  );
  const flashcardCompletedCount = Math.max(
    0,
    current?.flashcard_completed_count ?? current?.reviews_done ?? 0,
  );

  return {
    assignedFlashcardCount: Math.max(
      assignedFlashcardCount,
      flashcardCompletedCount,
      assignedNewWordsCount + assignedReviewCardsCount,
    ),
    assignedNewWordsCount,
    assignedReviewCardsCount,
    flashcardCompletedCount,
    readingDone: current?.reading_done ?? false,
    listeningDone: current?.listening_done ?? false,
  };
}

function resolveDailySessionStage(
  state: DailySessionProgressState,
): DailySessionRow["stage"] {
  if (state.flashcardCompletedCount < state.assignedFlashcardCount) {
    return "flashcards";
  }

  if (!state.readingDone) {
    return "reading";
  }

  if (!state.listeningDone) {
    return "listening";
  }

  return "complete";
}

function getDailySessionCompleted(state: DailySessionProgressState) {
  return resolveDailySessionStage(state) === "complete";
}

function getNextPathForDailySession(
  dailySession: Pick<
    DailySessionRow,
    "stage" | "reading_text_id" | "listening_asset_id"
  >,
) {
  if (dailySession.stage === "reading" && dailySession.reading_text_id) {
    return `/reader/${dailySession.reading_text_id}`;
  }

  if (dailySession.stage === "listening" && dailySession.listening_asset_id) {
    return `/listening/${dailySession.listening_asset_id}`;
  }

  if (dailySession.stage === "reading") {
    return "/reading";
  }

  if (dailySession.stage === "listening") {
    return "/listening";
  }

  return "/today";
}

function limitTodaySession(session: TodaySession, dailyLimit: number): TodaySession {
  if (dailyLimit <= 0) {
    return { ...session, dueReviews: [], newWords: [] };
  }

  const dueReviews = session.dueReviews.slice(0, dailyLimit);
  const remaining = Math.max(0, dailyLimit - dueReviews.length);
  const newWords = session.newWords.slice(0, remaining);

  return {
    ...session,
    dueReviews,
    newWords,
  };
}

async function upsertDailySession(
  session: TodaySession,
  existingDailySession: DailySessionRow | null,
): Promise<DailySessionRow | null> {
  const { supabase, user } = await getSupabaseServerContext();
  if (!supabase || !user) return null;

  const sessionDate = getTodaySessionDate();
  const now = new Date().toISOString();
  const assignedReviewCardsCount = session.dueReviews.length;
  const assignedNewWordsCount = session.newWords.length;
  const assignedFlashcardCount = assignedReviewCardsCount + assignedNewWordsCount;
  const progress = getDailySessionProgressState(
    existingDailySession,
    {
      assignedFlashcardCount,
      assignedNewWordsCount,
      assignedReviewCardsCount,
    },
  );
  const stage = resolveDailySessionStage(progress);
  const shouldResume = Boolean(
    existingDailySession &&
      existingDailySession.started_at &&
      !existingDailySession.completed &&
      existingDailySession.last_active_at &&
      Date.now() - new Date(existingDailySession.last_active_at).getTime() >
        SESSION_RESUME_THRESHOLD_MS,
  );
  const completed = getDailySessionCompleted(progress);
  const flashcardsCompletedAt =
    progress.assignedFlashcardCount === 0 || progress.flashcardCompletedCount >= progress.assignedFlashcardCount
      ? existingDailySession?.flashcards_completed_at ?? now
      : existingDailySession?.flashcards_completed_at ?? null;

  const { data, error } = await supabase
    .from("daily_sessions")
    .upsert(
      {
        user_id: user.id,
        session_date: sessionDate,
        stage,
        assigned_flashcard_count: progress.assignedFlashcardCount,
        assigned_new_words_count: progress.assignedNewWordsCount,
        assigned_review_cards_count: progress.assignedReviewCardsCount,
        new_words_count: progress.assignedFlashcardCount,
        reviews_done: progress.flashcardCompletedCount,
        flashcard_completed_count: progress.flashcardCompletedCount,
        flashcard_new_completed_count:
          existingDailySession?.flashcard_new_completed_count ?? 0,
        flashcard_review_completed_count:
          existingDailySession?.flashcard_review_completed_count ?? 0,
        flashcard_attempts_count: existingDailySession?.flashcard_attempts_count ?? 0,
        flashcard_retry_count: existingDailySession?.flashcard_retry_count ?? 0,
        started_at: existingDailySession?.started_at ?? now,
        last_active_at: now,
        last_resumed_at: shouldResume
          ? now
          : existingDailySession?.last_resumed_at ?? null,
        resume_count:
          (existingDailySession?.resume_count ?? 0) + (shouldResume ? 1 : 0),
        flashcards_completed_at: flashcardsCompletedAt,
        reading_done: existingDailySession?.reading_done ?? false,
        reading_text_id: existingDailySession?.reading_text_id ?? null,
        reading_opened_at: existingDailySession?.reading_opened_at ?? null,
        reading_completed_at: existingDailySession?.reading_completed_at ?? null,
        reading_time_seconds: existingDailySession?.reading_time_seconds ?? 0,
        listening_done: existingDailySession?.listening_done ?? false,
        listening_asset_id: existingDailySession?.listening_asset_id ?? null,
        listening_opened_at: existingDailySession?.listening_opened_at ?? null,
        listening_playback_started_at:
          existingDailySession?.listening_playback_started_at ?? null,
        listening_completed_at:
          existingDailySession?.listening_completed_at ?? null,
        listening_max_position_seconds:
          existingDailySession?.listening_max_position_seconds ?? null,
        listening_required_seconds:
          existingDailySession?.listening_required_seconds ?? null,
        listening_transcript_opened:
          existingDailySession?.listening_transcript_opened ?? false,
        listening_playback_rate:
          existingDailySession?.listening_playback_rate ?? null,
        listening_time_seconds:
          existingDailySession?.listening_time_seconds ?? 0,
        completed,
        completed_at: completed
          ? existingDailySession?.completed_at ?? now
          : existingDailySession?.completed_at ?? null,
      },
      { onConflict: "user_id,session_date" },
    )
    .select("*")
    .single();

  if (error) return null;
  return data as DailySessionRow;
}

export async function completeReadingStep({
  textId,
  readingTimeSeconds = 0,
}: {
  textId: string;
  readingTimeSeconds?: number;
}): Promise<CompleteReadingStepResult> {
  try {
    const { supabase, user, error: authError } = await getSupabaseServerContext();
    if (!supabase) {
      return {
        ok: false,
        error: "Supabase client could not be created on the server",
      };
    }

    if (authError) {
      return { ok: false, error: authError };
    }

    if (!user) {
      return { ok: false, error: "Not authenticated" };
    }

    const [currentDailySession, listeningAsset] = await Promise.all([
      getTodayDailySessionRow(supabase, user.id),
      getListeningAssetForTextId(supabase, textId),
    ]);

    const currentProgress = getDailySessionProgressState(currentDailySession);
    const nextListeningDone =
      listeningAsset === null
        ? true
        : Boolean(
            currentDailySession?.listening_done &&
              currentDailySession.listening_asset_id === listeningAsset.id,
          );
    const nextProgress: DailySessionProgressState = {
      ...currentProgress,
      readingDone: true,
      listeningDone: nextListeningDone,
    };
    const stage = resolveDailySessionStage(nextProgress);
    const sessionDate = getTodaySessionDate();
    const now = new Date().toISOString();
    const shouldResetListeningProgress =
      currentDailySession?.listening_asset_id != null &&
      currentDailySession.listening_asset_id !== listeningAsset?.id;

    const { data, error } = await supabase
      .from("daily_sessions")
      .upsert(
        {
          user_id: user.id,
          session_date: sessionDate,
          stage,
          assigned_flashcard_count: nextProgress.assignedFlashcardCount,
          assigned_new_words_count: nextProgress.assignedNewWordsCount,
          assigned_review_cards_count: nextProgress.assignedReviewCardsCount,
          new_words_count: nextProgress.assignedFlashcardCount,
          reviews_done: nextProgress.flashcardCompletedCount,
          flashcard_completed_count: nextProgress.flashcardCompletedCount,
          flashcard_new_completed_count:
            currentDailySession?.flashcard_new_completed_count ?? 0,
          flashcard_review_completed_count:
            currentDailySession?.flashcard_review_completed_count ?? 0,
          flashcard_attempts_count:
            currentDailySession?.flashcard_attempts_count ?? 0,
          flashcard_retry_count:
            currentDailySession?.flashcard_retry_count ?? 0,
          started_at: currentDailySession?.started_at ?? now,
          last_active_at: now,
          flashcards_completed_at:
            currentDailySession?.flashcards_completed_at ??
            (nextProgress.assignedFlashcardCount === 0 ||
            nextProgress.flashcardCompletedCount >= nextProgress.assignedFlashcardCount
              ? now
              : null),
          reading_done: true,
          reading_text_id: textId,
          reading_opened_at: currentDailySession?.reading_opened_at ?? now,
          reading_completed_at: now,
          reading_time_seconds: Math.max(
            Math.max(0, Math.round(readingTimeSeconds)),
            currentDailySession?.reading_time_seconds ?? 0,
          ),
          listening_done: nextListeningDone,
          listening_asset_id: listeningAsset?.id ?? null,
          listening_opened_at:
            listeningAsset === null || shouldResetListeningProgress
              ? null
              : currentDailySession?.listening_opened_at ?? null,
          listening_playback_started_at:
            listeningAsset === null || shouldResetListeningProgress
              ? null
              : currentDailySession?.listening_playback_started_at ?? null,
          listening_completed_at:
            listeningAsset === null
              ? currentDailySession?.listening_completed_at ?? now
              : nextListeningDone
                ? currentDailySession?.listening_completed_at ?? now
                : null,
          listening_max_position_seconds:
            listeningAsset === null || shouldResetListeningProgress
              ? null
              : currentDailySession?.listening_max_position_seconds ?? null,
          listening_required_seconds:
            listeningAsset === null || shouldResetListeningProgress
              ? null
              : currentDailySession?.listening_required_seconds ?? null,
          listening_transcript_opened:
            listeningAsset === null || shouldResetListeningProgress
              ? false
              : currentDailySession?.listening_transcript_opened ?? false,
          listening_playback_rate:
            listeningAsset === null || shouldResetListeningProgress
              ? null
              : currentDailySession?.listening_playback_rate ?? null,
          listening_time_seconds:
            listeningAsset === null || shouldResetListeningProgress
              ? 0
              : currentDailySession?.listening_time_seconds ?? 0,
          completed: getDailySessionCompleted(nextProgress),
          completed_at: getDailySessionCompleted(nextProgress)
            ? currentDailySession?.completed_at ?? now
            : currentDailySession?.completed_at ?? null,
        },
        { onConflict: "user_id,session_date" },
      )
      .select("*")
      .single();

    if (error || !data) {
      return {
        ok: false,
        error: error?.message ?? "Failed to update today's reading progress",
      };
    }

    revalidatePath("/today");
    revalidatePath("/reading");
    revalidatePath(`/reader/${textId}`);
    revalidatePath("/listening");
    if (listeningAsset) {
      revalidatePath(`/listening/${listeningAsset.id}`);
    }

    const dailySession = data as DailySessionRow;

    return {
      ok: true,
      dailySession,
      nextPath: getNextPathForDailySession(dailySession),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to complete the reading step",
    };
  }
}

export async function completeListeningStep({
  assetId,
  maxPositionSeconds,
  requiredListenSeconds,
  transcriptOpened,
  playbackRate,
  listeningTimeSeconds = 0,
}: {
  assetId: string;
  maxPositionSeconds: number;
  requiredListenSeconds: number;
  transcriptOpened: boolean;
  playbackRate: number;
  listeningTimeSeconds?: number;
}): Promise<CompleteListeningStepResult> {
  try {
    const { supabase, user, error: authError } = await getSupabaseServerContext();
    if (!supabase) {
      return {
        ok: false,
        error: "Supabase client could not be created on the server",
      };
    }

    if (authError) {
      return { ok: false, error: authError };
    }

    if (!user) {
      return { ok: false, error: "Not authenticated" };
    }

    const [currentDailySession, listeningAsset] = await Promise.all([
      getTodayDailySessionRow(supabase, user.id),
      getListeningAssetById(supabase, assetId),
    ]);

    if (!listeningAsset) {
      return {
        ok: false,
        error: "This listening asset could not be found.",
      };
    }

    const currentProgress = getDailySessionProgressState(currentDailySession);
    const nextProgress: DailySessionProgressState = {
      ...currentProgress,
      listeningDone: true,
    };
    const stage = resolveDailySessionStage(nextProgress);
    const sessionDate = getTodaySessionDate();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("daily_sessions")
      .upsert(
        {
          user_id: user.id,
          session_date: sessionDate,
          stage,
          assigned_flashcard_count: nextProgress.assignedFlashcardCount,
          assigned_new_words_count: nextProgress.assignedNewWordsCount,
          assigned_review_cards_count: nextProgress.assignedReviewCardsCount,
          new_words_count: nextProgress.assignedFlashcardCount,
          reviews_done: nextProgress.flashcardCompletedCount,
          flashcard_completed_count: nextProgress.flashcardCompletedCount,
          flashcard_new_completed_count:
            currentDailySession?.flashcard_new_completed_count ?? 0,
          flashcard_review_completed_count:
            currentDailySession?.flashcard_review_completed_count ?? 0,
          flashcard_attempts_count:
            currentDailySession?.flashcard_attempts_count ?? 0,
          flashcard_retry_count:
            currentDailySession?.flashcard_retry_count ?? 0,
          started_at: currentDailySession?.started_at ?? now,
          last_active_at: now,
          flashcards_completed_at:
            currentDailySession?.flashcards_completed_at ??
            (nextProgress.assignedFlashcardCount === 0 ||
            nextProgress.flashcardCompletedCount >= nextProgress.assignedFlashcardCount
              ? now
              : null),
          reading_done: currentProgress.readingDone,
          reading_text_id:
            currentDailySession?.reading_text_id ?? listeningAsset.textId,
          reading_opened_at: currentDailySession?.reading_opened_at ?? null,
          reading_completed_at: currentDailySession?.reading_completed_at ?? null,
          reading_time_seconds: currentDailySession?.reading_time_seconds ?? 0,
          listening_done: true,
          listening_asset_id: listeningAsset.id,
          listening_opened_at: currentDailySession?.listening_opened_at ?? now,
          listening_playback_started_at:
            currentDailySession?.listening_playback_started_at ?? now,
          listening_completed_at: now,
          listening_max_position_seconds: Math.max(
            Math.max(0, Math.round(maxPositionSeconds)),
            currentDailySession?.listening_asset_id === listeningAsset.id
              ? currentDailySession?.listening_max_position_seconds ?? 0
              : 0,
          ),
          listening_required_seconds: Math.max(
            1,
            Math.round(requiredListenSeconds),
          ),
          listening_transcript_opened:
            transcriptOpened ||
            (currentDailySession?.listening_asset_id === listeningAsset.id &&
              (currentDailySession?.listening_transcript_opened ?? false)),
          listening_playback_rate: playbackRate,
          listening_time_seconds: Math.max(
            Math.max(0, Math.round(listeningTimeSeconds)),
            currentDailySession?.listening_time_seconds ?? 0,
          ),
          completed: getDailySessionCompleted(nextProgress),
          completed_at: getDailySessionCompleted(nextProgress)
            ? currentDailySession?.completed_at ?? now
            : currentDailySession?.completed_at ?? null,
        },
        { onConflict: "user_id,session_date" },
      )
      .select("*")
      .single();

    if (error || !data) {
      return {
        ok: false,
        error: error?.message ?? "Failed to save today's listening progress",
      };
    }

    revalidatePath("/today");
    revalidatePath("/listening");
    revalidatePath(`/listening/${listeningAsset.id}`);
    revalidatePath("/reading");
    revalidatePath(`/reader/${listeningAsset.textId}`);

    const dailySession = data as DailySessionRow;

    return {
      ok: true,
      dailySession,
      nextPath: getNextPathForDailySession(dailySession),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to complete the listening step",
    };
  }
}

export async function markReadingOpened({
  textId,
}: {
  textId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, user, error: authError } = await getSupabaseServerContext();
    if (!supabase) {
      return { ok: false, error: "Supabase client could not be created on the server" };
    }

    if (authError) {
      return { ok: false, error: authError };
    }

    if (!user) {
      return { ok: false, error: "Not authenticated" };
    }

    const sessionDate = getTodaySessionDate();
    const now = new Date().toISOString();
    const currentDailySession = await getTodayDailySessionRow(supabase, user.id);
    const progress = getDailySessionProgressState(currentDailySession);

    const { error } = await supabase.from("daily_sessions").upsert(
      {
        user_id: user.id,
        session_date: sessionDate,
        stage: currentDailySession?.stage ?? resolveDailySessionStage(progress),
        assigned_flashcard_count: progress.assignedFlashcardCount,
        assigned_new_words_count: progress.assignedNewWordsCount,
        assigned_review_cards_count: progress.assignedReviewCardsCount,
        new_words_count: progress.assignedFlashcardCount,
        reviews_done: progress.flashcardCompletedCount,
        flashcard_completed_count: progress.flashcardCompletedCount,
        flashcard_new_completed_count:
          currentDailySession?.flashcard_new_completed_count ?? 0,
        flashcard_review_completed_count:
          currentDailySession?.flashcard_review_completed_count ?? 0,
        flashcard_attempts_count: currentDailySession?.flashcard_attempts_count ?? 0,
        flashcard_retry_count: currentDailySession?.flashcard_retry_count ?? 0,
        started_at: currentDailySession?.started_at ?? now,
        last_active_at: now,
        flashcards_completed_at: currentDailySession?.flashcards_completed_at ?? null,
        reading_text_id: textId,
        reading_opened_at: currentDailySession?.reading_opened_at ?? now,
        reading_done: currentDailySession?.reading_done ?? false,
        reading_completed_at: currentDailySession?.reading_completed_at ?? null,
        reading_time_seconds: currentDailySession?.reading_time_seconds ?? 0,
        listening_done: currentDailySession?.listening_done ?? false,
        listening_asset_id: currentDailySession?.listening_asset_id ?? null,
        listening_opened_at: currentDailySession?.listening_opened_at ?? null,
        listening_playback_started_at:
          currentDailySession?.listening_playback_started_at ?? null,
        listening_completed_at: currentDailySession?.listening_completed_at ?? null,
        listening_max_position_seconds:
          currentDailySession?.listening_max_position_seconds ?? null,
        listening_required_seconds:
          currentDailySession?.listening_required_seconds ?? null,
        listening_transcript_opened:
          currentDailySession?.listening_transcript_opened ?? false,
        listening_playback_rate:
          currentDailySession?.listening_playback_rate ?? null,
        listening_time_seconds:
          currentDailySession?.listening_time_seconds ?? 0,
        completed: currentDailySession?.completed ?? false,
        completed_at: currentDailySession?.completed_at ?? null,
      },
      { onConflict: "user_id,session_date" },
    );

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to mark the reader as opened",
    };
  }
}

export async function markListeningOpened({
  assetId,
}: {
  assetId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, user, error: authError } = await getSupabaseServerContext();
    if (!supabase) {
      return { ok: false, error: "Supabase client could not be created on the server" };
    }

    if (authError) {
      return { ok: false, error: authError };
    }

    if (!user) {
      return { ok: false, error: "Not authenticated" };
    }

    const [currentDailySession, listeningAsset] = await Promise.all([
      getTodayDailySessionRow(supabase, user.id),
      getListeningAssetById(supabase, assetId),
    ]);

    if (!listeningAsset) {
      return { ok: false, error: "This listening asset could not be found." };
    }

    const sessionDate = getTodaySessionDate();
    const now = new Date().toISOString();
    const progress = getDailySessionProgressState(currentDailySession);

    const { error } = await supabase.from("daily_sessions").upsert(
      {
        user_id: user.id,
        session_date: sessionDate,
        stage: currentDailySession?.stage ?? resolveDailySessionStage(progress),
        assigned_flashcard_count: progress.assignedFlashcardCount,
        assigned_new_words_count: progress.assignedNewWordsCount,
        assigned_review_cards_count: progress.assignedReviewCardsCount,
        new_words_count: progress.assignedFlashcardCount,
        reviews_done: progress.flashcardCompletedCount,
        flashcard_completed_count: progress.flashcardCompletedCount,
        flashcard_new_completed_count:
          currentDailySession?.flashcard_new_completed_count ?? 0,
        flashcard_review_completed_count:
          currentDailySession?.flashcard_review_completed_count ?? 0,
        flashcard_attempts_count: currentDailySession?.flashcard_attempts_count ?? 0,
        flashcard_retry_count: currentDailySession?.flashcard_retry_count ?? 0,
        started_at: currentDailySession?.started_at ?? now,
        last_active_at: now,
        flashcards_completed_at: currentDailySession?.flashcards_completed_at ?? null,
        reading_done: currentDailySession?.reading_done ?? false,
        reading_text_id:
          currentDailySession?.reading_text_id ?? listeningAsset.textId,
        reading_opened_at: currentDailySession?.reading_opened_at ?? null,
        reading_completed_at: currentDailySession?.reading_completed_at ?? null,
        reading_time_seconds: currentDailySession?.reading_time_seconds ?? 0,
        listening_done: currentDailySession?.listening_done ?? false,
        listening_asset_id: listeningAsset.id,
        listening_opened_at: currentDailySession?.listening_opened_at ?? now,
        listening_playback_started_at:
          currentDailySession?.listening_playback_started_at ?? null,
        listening_completed_at: currentDailySession?.listening_completed_at ?? null,
        listening_max_position_seconds:
          currentDailySession?.listening_max_position_seconds ?? null,
        listening_required_seconds:
          currentDailySession?.listening_required_seconds ?? null,
        listening_transcript_opened:
          currentDailySession?.listening_transcript_opened ?? false,
        listening_playback_rate:
          currentDailySession?.listening_playback_rate ?? null,
        listening_time_seconds:
          currentDailySession?.listening_time_seconds ?? 0,
        completed: currentDailySession?.completed ?? false,
        completed_at: currentDailySession?.completed_at ?? null,
      },
      { onConflict: "user_id,session_date" },
    );

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to mark listening as opened",
    };
  }
}

export async function markListeningPlaybackStarted({
  assetId,
}: {
  assetId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, user, error: authError } = await getSupabaseServerContext();
    if (!supabase) {
      return { ok: false, error: "Supabase client could not be created on the server" };
    }

    if (authError) {
      return { ok: false, error: authError };
    }

    if (!user) {
      return { ok: false, error: "Not authenticated" };
    }

    const currentDailySession = await getTodayDailySessionRow(supabase, user.id);
    if (
      currentDailySession?.listening_asset_id === assetId &&
      currentDailySession.listening_playback_started_at
    ) {
      return { ok: true };
    }

    const now = new Date().toISOString();
    const { error } = await supabase.from("daily_sessions").upsert(
      {
        user_id: user.id,
        session_date: getTodaySessionDate(),
        stage:
          currentDailySession?.stage ??
          resolveDailySessionStage(getDailySessionProgressState(currentDailySession)),
        assigned_flashcard_count:
          currentDailySession?.assigned_flashcard_count ?? currentDailySession?.new_words_count ?? 0,
        assigned_new_words_count:
          currentDailySession?.assigned_new_words_count ?? 0,
        assigned_review_cards_count:
          currentDailySession?.assigned_review_cards_count ?? 0,
        new_words_count:
          currentDailySession?.assigned_flashcard_count ?? currentDailySession?.new_words_count ?? 0,
        reviews_done:
          currentDailySession?.flashcard_completed_count ?? currentDailySession?.reviews_done ?? 0,
        flashcard_completed_count:
          currentDailySession?.flashcard_completed_count ?? currentDailySession?.reviews_done ?? 0,
        flashcard_new_completed_count:
          currentDailySession?.flashcard_new_completed_count ?? 0,
        flashcard_review_completed_count:
          currentDailySession?.flashcard_review_completed_count ?? 0,
        flashcard_attempts_count:
          currentDailySession?.flashcard_attempts_count ?? 0,
        flashcard_retry_count:
          currentDailySession?.flashcard_retry_count ?? 0,
        started_at: currentDailySession?.started_at ?? now,
        last_active_at: now,
        flashcards_completed_at:
          currentDailySession?.flashcards_completed_at ?? null,
        reading_done: currentDailySession?.reading_done ?? false,
        reading_text_id: currentDailySession?.reading_text_id ?? null,
        reading_opened_at: currentDailySession?.reading_opened_at ?? null,
        reading_completed_at: currentDailySession?.reading_completed_at ?? null,
        reading_time_seconds: currentDailySession?.reading_time_seconds ?? 0,
        listening_done: currentDailySession?.listening_done ?? false,
        listening_asset_id: assetId,
        listening_opened_at: currentDailySession?.listening_opened_at ?? now,
        listening_playback_started_at: now,
        listening_completed_at: currentDailySession?.listening_completed_at ?? null,
        listening_max_position_seconds:
          currentDailySession?.listening_max_position_seconds ?? null,
        listening_required_seconds:
          currentDailySession?.listening_required_seconds ?? null,
        listening_transcript_opened:
          currentDailySession?.listening_transcript_opened ?? false,
        listening_playback_rate:
          currentDailySession?.listening_playback_rate ?? null,
        listening_time_seconds:
          currentDailySession?.listening_time_seconds ?? 0,
        completed: currentDailySession?.completed ?? false,
        completed_at: currentDailySession?.completed_at ?? null,
      },
      { onConflict: "user_id,session_date" },
    );

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to mark listening playback as started",
    };
  }
}

export async function getFlashcardDebugSnapshot(
  wordId?: string,
): Promise<FlashcardDebugSnapshot> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      dailySession: null,
      currentUserWord: null,
      lastReviewEvent: null,
    };
  }

  const { user } = await getSupabaseUser(supabase);
  if (!user) {
    return {
      dailySession: null,
      currentUserWord: null,
      lastReviewEvent: null,
    };
  }

  const sessionDate = getTodaySessionDate();
  const [dailySessionResult, userWordResult] = await Promise.all([
    supabase
      .from("daily_sessions")
      .select("*")
      .eq("user_id", user.id)
      .eq("session_date", sessionDate)
      .maybeSingle(),
    wordId
      ? supabase
          .from("user_words")
          .select("*")
          .eq("user_id", user.id)
          .eq("word_id", wordId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const latestByCreated = await supabase
    .from("review_events")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestByHappened = latestByCreated.error
    ? await supabase
        .from("review_events")
        .select("*")
        .eq("user_id", user.id)
        .order("happened_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : null;

  return {
    dailySession: (dailySessionResult.data as DailySessionRow | null) ?? null,
    currentUserWord: (userWordResult.data as Record<string, unknown> | null) ?? null,
    lastReviewEvent:
      (latestByCreated.data as Record<string, unknown> | null) ??
      (latestByHappened?.data as Record<string, unknown> | null) ??
      null,
  };
}
