"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
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
      debugSnapshot: FlashcardDebugSnapshot;
      effectiveSettings: {
        dailyLimit: number;
        retryDelaySeconds: number;
        autoAdvanceCorrect: boolean;
        showPosHint: boolean;
        showDefinitionFirst: boolean;
        enabledTypes: Record<EnabledFlashcardMode, boolean>;
      };
    }
  | {
      ok: false;
      session?: TodaySession;
      configMissing?: boolean;
      signedIn?: boolean;
      error?: string;
      dailySession?: DailySessionRow | null;
      debugSnapshot: FlashcardDebugSnapshot;
      effectiveSettings: {
        dailyLimit: number;
        retryDelaySeconds: number;
        autoAdvanceCorrect: boolean;
        showPosHint: boolean;
        showDefinitionFirst: boolean;
        enabledTypes: Record<EnabledFlashcardMode, boolean>;
      };
    };

export type FlashcardDebugSnapshot = {
  dailySession: DailySessionRow | null;
  currentUserWord: Record<string, unknown> | null;
  lastReviewEvent: Record<string, unknown> | null;
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

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      session: { dueReviews: [], newWords: [] },
      configMissing: true,
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  const { settings, signedIn } = await getUserSettings();
  const recommended = await recommendSettings();
  const effective = resolveEffectiveSettings(settings, recommended);
  const existingDailySession = await getTodayDailySession();
  const completedToday = Math.max(0, existingDailySession?.reviews_done ?? 0);
  const remainingDailyLimit = Math.max(0, effective.effectiveDailyLimit - completedToday);
  const queueLimit = Math.max(1, remainingDailyLimit);

  const effectiveSettings = {
    dailyLimit: effective.effectiveDailyLimit,
    retryDelaySeconds: effective.retryDelaySeconds,
    autoAdvanceCorrect: effective.autoAdvanceCorrect,
    showPosHint: effective.showPosHint,
    showDefinitionFirst: effective.showDefinitionFirst,
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
      debugSnapshot: {
        dailySession: null,
        currentUserWord: null,
        lastReviewEvent: null,
      },
      effectiveSettings,
    };
  }

  const session = limitTodaySession(queueResult.session, remainingDailyLimit);
  const dailySession = await upsertDailySession(session);
  const firstWordId = session.dueReviews[0]?.word_id ?? session.newWords[0]?.id ?? null;
  const debugSnapshot = await getFlashcardDebugSnapshot(firstWordId ?? undefined);

  return {
    ok: true,
    session,
    dailySession,
    debugSnapshot,
    effectiveSettings,
  };
}

async function getTodayDailySession(): Promise<DailySessionRow | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const sessionDate = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("daily_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("session_date", sessionDate)
    .maybeSingle();

  if (error) return null;
  return data as DailySessionRow | null;
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

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return {
        ok: false,
        error: "Supabase client could not be created on the server",
      };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
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

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      error: "Supabase client could not be created on the server",
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
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
): Promise<DailySessionRow | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const sessionDate = new Date().toISOString().slice(0, 10);
  const hasCards = session.dueReviews.length + session.newWords.length > 0;

  const { data, error } = await supabase
    .from("daily_sessions")
    .upsert(
      {
        user_id: user.id,
        session_date: sessionDate,
        stage: hasCards ? "flashcards" : "reading",
        new_words_count: session.newWords.length,
        completed: !hasCards,
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
  const sessionDate = new Date().toISOString().slice(0, 10);
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

  const nextReviewsDone = (current?.reviews_done ?? 0) + 1;
  const readingDone = current?.reading_done ?? false;
  const listeningDone = current?.listening_done ?? false;
  const completed = nextReviewsDone >= (current?.new_words_count ?? 0) && readingDone && listeningDone;

  await supabase.from("daily_sessions").upsert(
    {
      user_id: userId,
      session_date: sessionDate,
      stage: "flashcards",
      reviews_done: nextReviewsDone,
      completed,
    },
    { onConflict: "user_id,session_date" },
  );
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

  const {
    data: { user },
  } = await supabase.auth.getUser();
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
