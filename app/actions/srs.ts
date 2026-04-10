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
  flashcardTargetCount: number;
  reviewsDone: number;
  readingDone: boolean;
  listeningDone: boolean;
};

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
    const today = new Date().toISOString().slice(0, 10);
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
  const completedToday = Math.max(0, existingDailySession?.reviews_done ?? 0);
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
    const correct = grade !== "again";
    const rpcArgs = {
      p_word_id: payload.wordId,
      p_grade: grade,
      p_ms_spent: payload.msSpent,
      p_user_answer: payload.userAnswer ?? "",
      p_expected: payload.expected ?? [],
    };

    let { error } = await supabase.rpc("record_review", {
      ...rpcArgs,
      p_card_type: payload.cardType ?? "cloze",
    });

    if (isMissingCardTypeArgumentError(error?.message)) {
      ({ error } = await supabase.rpc("record_review", rpcArgs));
    }

    if (error) {
      if (isMissingUpsertUserWordError(error.message)) {
        await fallbackRecordReview(supabase, user.id, { ...payload, correct, grade });
      } else {
        return { ok: false, error: error.message };
      }
    }

    await syncUserWordReviewState(supabase, user.id, { ...payload, correct, grade });
    await incrementDailySessionReviews(supabase, user.id);

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

function isMissingUpsertUserWordError(message: string) {
  return message.includes("upsert_user_word");
}

function isMissingCardTypeArgumentError(message?: string) {
  if (!message) return false;
  return (
    message.includes("Could not find the function public.record_review") &&
    message.includes("p_card_type")
  );
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
        new_words_count?: number | null;
        reviews_done?: number | null;
        reading_done?: boolean | null;
        listening_done?: boolean | null;
      }
    | null,
  fallbackFlashcardTargetCount = 0,
): DailySessionProgressState {
  const reviewsDone = Math.max(0, current?.reviews_done ?? 0);

  return {
    flashcardTargetCount: Math.max(
      reviewsDone,
      current?.new_words_count ?? 0,
      fallbackFlashcardTargetCount,
    ),
    reviewsDone,
    readingDone: current?.reading_done ?? false,
    listeningDone: current?.listening_done ?? false,
  };
}

function resolveDailySessionStage(
  state: DailySessionProgressState,
): DailySessionRow["stage"] {
  if (state.reviewsDone < state.flashcardTargetCount) {
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
  const progress = getDailySessionProgressState(
    existingDailySession,
    session.dueReviews.length + session.newWords.length,
  );
  const stage = resolveDailySessionStage(progress);

  const { data, error } = await supabase
    .from("daily_sessions")
    .upsert(
      {
        user_id: user.id,
        session_date: sessionDate,
        stage,
        new_words_count: progress.flashcardTargetCount,
        reviews_done: progress.reviewsDone,
        completed: getDailySessionCompleted(progress),
      },
      { onConflict: "user_id,session_date" },
    )
    .select("*")
    .single();

  if (error) return null;
  return data as DailySessionRow;
}

async function incrementDailySessionReviews(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  userId: string,
) {
  const sessionDate = getTodaySessionDate();
  const { data } = await supabase
    .from("daily_sessions")
    .select("reviews_done,new_words_count,reading_done,listening_done")
    .eq("user_id", userId)
    .eq("session_date", sessionDate)
    .maybeSingle();

  const current = data as
    | {
        reviews_done?: number | null;
        new_words_count?: number | null;
        reading_done?: boolean | null;
        listening_done?: boolean | null;
      }
    | null;

  const progress = getDailySessionProgressState(current);
  const nextProgress: DailySessionProgressState = {
    ...progress,
    reviewsDone: progress.reviewsDone + 1,
    flashcardTargetCount: Math.max(
      progress.flashcardTargetCount,
      progress.reviewsDone + 1,
    ),
  };
  const stage = resolveDailySessionStage(nextProgress);

  await supabase.from("daily_sessions").upsert(
    {
      user_id: userId,
      session_date: sessionDate,
      stage,
      new_words_count: nextProgress.flashcardTargetCount,
      reviews_done: nextProgress.reviewsDone,
      completed: getDailySessionCompleted(nextProgress),
    },
    { onConflict: "user_id,session_date" },
  );
}

export async function completeReadingStep({
  textId,
}: {
  textId: string;
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
          new_words_count: nextProgress.flashcardTargetCount,
          reviews_done: nextProgress.reviewsDone,
          reading_done: true,
          reading_text_id: textId,
          reading_completed_at: now,
          listening_done: nextListeningDone,
          listening_asset_id: listeningAsset?.id ?? null,
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
          completed: getDailySessionCompleted(nextProgress),
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
}: {
  assetId: string;
  maxPositionSeconds: number;
  requiredListenSeconds: number;
  transcriptOpened: boolean;
  playbackRate: number;
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
          new_words_count: nextProgress.flashcardTargetCount,
          reviews_done: nextProgress.reviewsDone,
          reading_done: currentProgress.readingDone,
          reading_text_id:
            currentDailySession?.reading_text_id ?? listeningAsset.textId,
          listening_done: true,
          listening_asset_id: listeningAsset.id,
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
          completed: getDailySessionCompleted(nextProgress),
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

async function syncUserWordReviewState(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  userId: string,
  payload: RecordReviewPayload,
) {
  const { data, error } = await supabase
    .from("user_words")
    .select(
      "attempts,correct_attempts,reps_today,reps_today_date,difficulty,last_seen_at,last_graded_at",
    )
    .eq("user_id", userId)
    .eq("word_id", payload.wordId)
    .maybeSingle();

  if (error) return;

  const current = data as
    | {
        attempts?: number | null;
        correct_attempts?: number | null;
        reps_today?: number | null;
        reps_today_date?: string | null;
        difficulty?: number | null;
      }
    | null;

  const today = new Date().toISOString().slice(0, 10);
  const sameDay = current?.reps_today_date === today;
  const attempts = (current?.attempts ?? 0) + 1;
  const correctAttempts = (current?.correct_attempts ?? 0) + (payload.correct ? 1 : 0);
  const repsToday = sameDay ? (current?.reps_today ?? 0) + 1 : 1;
  const accuracy = correctAttempts / Math.max(1, attempts);
  const priorDifficulty = current?.difficulty ?? 0.5;
  const difficulty = Math.max(
    0,
    Math.min(1, priorDifficulty + (payload.correct ? -0.05 : 0.08)),
  );
  const now = new Date().toISOString();

  await supabase
    .from("user_words")
    .update({
      attempts,
      correct_attempts: correctAttempts,
      accuracy,
      difficulty,
      last_seen_at: now,
      last_graded_at: now,
      reps_today: repsToday,
      reps_today_date: today,
    })
    .eq("user_id", userId)
    .eq("word_id", payload.wordId);
}

async function fallbackRecordReview(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  userId: string,
  payload: RecordReviewPayload,
) {
  const now = new Date();
  const nextDue = new Date(
    now.getTime() + (payload.correct ? 24 * 60 * 60 * 1000 : 10 * 60 * 1000),
  ).toISOString();

  // Keep fallback resilient across schema drift: only depend on core queue columns.
  const { error: upsertError } = await supabase.from("user_words").upsert(
    {
      user_id: userId,
      word_id: payload.wordId,
      status: "learning",
      due_at: nextDue,
    },
    { onConflict: "user_id,word_id" },
  );
  if (upsertError) {
    throw new Error(upsertError.message);
  }

  await supabase.from("review_events").insert({
    user_id: userId,
    word_id: payload.wordId,
    card_type: payload.cardType ?? "cloze",
    grade: payload.grade ?? (payload.correct ? "good" : "again"),
    correct: payload.correct,
    ms_spent: payload.msSpent,
    user_answer: payload.userAnswer ?? "",
    expected: payload.expected ?? [],
  });
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

  const sessionDate = new Date().toISOString().slice(0, 10);
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
