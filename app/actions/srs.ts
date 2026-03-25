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
} from "@/lib/srs/types";
import { getUserSettings } from "@/lib/settings/getUserSettings";
import { recommendSettings } from "@/lib/settings/recommendSettings";
import { resolveEffectiveSettings } from "@/lib/settings/resolveEffectiveSettings";

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
        showPosHint: boolean;
        showDefinitionFirst: boolean;
        clozeEnabled: boolean;
      };
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
        showPosHint: boolean;
        showDefinitionFirst: boolean;
        clozeEnabled: boolean;
      };
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
      definition: r.definition ?? null,
      user_id: user.id,
      status: "learning",
      pos: r.pos ?? null,
      extra: r.extra ?? null,
    }));
  const newWords: Word[] = items
    .filter((r) => r.kind === "new")
    .map((r) => ({
      id: r.word_id,
      language: lang,
      lemma: r.lemma,
      rank: r.rank,
      definition: r.definition ?? null,
      pos: r.pos ?? null,
      extra: r.extra ?? null,
    }));

  return {
    ok: true,
    session: { dueReviews, newWords, signedIn: true },
  };
}

export async function getTodayFlashcards(lang: string): Promise<TodayFlashcardsResult> {
  const { settings, signedIn } = await getUserSettings();
  const recommended = await recommendSettings();
  const effective = resolveEffectiveSettings(settings, recommended);

  const effectiveSettings = {
    dailyLimit: effective.effectiveDailyLimit,
    retryDelaySeconds: effective.retryDelaySeconds,
    showPosHint: effective.showPosHint,
    showDefinitionFirst: effective.showDefinitionFirst,
    clozeEnabled: effective.effectiveTypes.cloze,
  };

  const queueResult = await getDailyQueue(
    lang,
    Math.min(MAX_NEW_WORDS, effective.effectiveDailyLimit),
    Math.min(MAX_DUE_REVIEWS, effective.effectiveDailyLimit),
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
    };
  }

  const session = limitTodaySession(queueResult.session, effective.effectiveDailyLimit);
  const dailySession = await upsertDailySession(session);

  return {
    ok: true,
    session,
    dailySession,
    effectiveSettings,
  };
}

export type RecordReviewResult = { ok: true } | { ok: false; error: string };

export async function recordReview(
  payload: RecordReviewPayload,
): Promise<RecordReviewResult> {
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

  const grade = payload.correct ? "good" : "again";
  const { error } = await supabase.rpc("record_review", {
    p_word_id: payload.wordId,
    p_grade: grade,
    p_ms_spent: payload.msSpent,
    p_user_answer: payload.userAnswer ?? "",
    p_expected: payload.expected ?? [],
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  await syncUserWordReviewState(supabase, user.id, payload);
  await incrementDailySessionReviews(supabase, user.id);

  return { ok: true };
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
  const { data } = await supabase
    .from("user_words")
    .select(
      "attempts,correct_attempts,reps_today,reps_today_date,difficulty,last_seen_at,last_graded_at",
    )
    .eq("user_id", userId)
    .eq("word_id", payload.wordId)
    .maybeSingle();

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
