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
} from "@/lib/srs/types";

export type GetDailyQueueResult =
  | { ok: true; session: TodaySession }
  | { ok: false; session?: TodaySession; configMissing?: boolean; signedIn?: boolean; error?: string };

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
