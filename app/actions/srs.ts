"use server";

import { revalidatePath } from "next/cache";
import {
  createSupabaseServerClient,
  getSupabaseServerContextFast,
} from "@/lib/supabase/server";
import { getTodayDailySessionRow, getTodaySessionDate } from "@/lib/loop/dailySessions";
import {
  getListeningAssetById,
  getListeningAssetForTextId,
} from "@/lib/loop/listening";
import { EMPTY_SAVED_WORDS_STATE, getSavedWordsState, type SavedWordsState } from "@/lib/reader/savedWords";
import { MAX_DUE_REVIEWS, MAX_NEW_WORDS } from "@/lib/srs/constants";
import {
  computeWorkloadPolicy,
  CONTINUATION_REVIEW_CHUNK,
  CONTINUATION_NEW_CHUNK,
  type WorkloadPolicy,
} from "@/lib/srs/workloadPolicy";
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
import { recalibratePlacementForUser } from "@/lib/placement/recalibrate";
import { pickNewWordsNearFrontier } from "@/lib/placement/newWordPicker";
import {
  computeAdaptiveContext,
  computeItemFactor,
  type SchedulerVariant,
} from "@/lib/srs/adaptive";
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
      workloadPolicy: WorkloadPolicy;
      effectiveSettings: {
        dailyLimit: number;
        manualTargetMode: boolean;
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
        manualTargetMode: boolean;
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
/** Max cards fetched per chunk in manual-target mode. */
const MANUAL_TARGET_CHUNK = 50;

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

// Hydrate a list of (id, rank) picks into full Word rows in the same order.
// Used by both the near-frontier picker path and the user-driven fallback
// path so the substitution into `newWords` is identical.
async function enrichWordsByOrder(
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseServerContextFast>>["supabase"]>,
  ordered: ReadonlyArray<{ id: string; rank: number }>,
  lang: string,
): Promise<Word[]> {
  if (ordered.length === 0) return [];
  const ids = ordered.map((p) => p.id);
  const { data: enriched } = await supabase
    .from("words")
    .select(
      "id, lemma, rank, pos, translation, example_sentence, example_sentence_en, lemma_audio_path, lemma_sentence_audio_path",
    )
    .in("id", ids);
  const byId = new Map<string, Word>();
  for (const row of (enriched ?? []) as Array<{
    id: string;
    lemma: string;
    rank: number;
    pos: string | null;
    translation: string | null;
    example_sentence: string | null;
    example_sentence_en: string | null;
    lemma_audio_path: string | null;
    lemma_sentence_audio_path: string | null;
  }>) {
    byId.set(row.id, {
      id: row.id,
      language: lang,
      lemma: row.lemma,
      rank: row.rank,
      translation: row.translation ?? null,
      definition: null,
      definitionEs: null,
      definitionEn: null,
      exampleSentence: row.example_sentence ?? null,
      exampleSentenceEn: row.example_sentence_en ?? null,
      lemmaAudioPath: row.lemma_audio_path ?? null,
      lemmaSentenceAudioPath: row.lemma_sentence_audio_path ?? null,
      pos: row.pos ?? null,
    });
  }
  return ordered
    .map((p) => byId.get(p.id))
    .filter((w): w is Word => Boolean(w));
}

export async function getDailyQueue(
  lang: string,
  newLimit?: number,
  reviewLimit?: number,
  excludeWordIds?: string[],
  userDriven?: boolean,
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

  const { supabase, user, error: authError } = await getSupabaseServerContextFast();
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
    p_exclude_word_ids: excludeWordIds ?? [],
  } as never).limit(limitNew + limitReview);

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
      lemmaAudioPath: r.lemma_audio_path ?? null,
      lemmaSentenceAudioPath: r.lemma_sentence_audio_path ?? null,
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

  let newWords: Word[] = items
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
      lemmaAudioPath: r.lemma_audio_path ?? null,
      lemmaSentenceAudioPath: r.lemma_sentence_audio_path ?? null,
      pos: r.pos ?? null,
    }));

  // Placement-aware override: if user has a frontier estimate, prefer new
  // words near the frontier rather than always picking from rank 1.
  try {
    const { data: placementRow } = await supabase
      .from("user_settings")
      .select("current_frontier_rank, current_frontier_rank_low, current_frontier_rank_high, placement_status, baseline_test_run_id")
      .eq("user_id", user.id)
      .maybeSingle();
    let frontierRank = placementRow?.current_frontier_rank as number | null;
    let lowBound = placementRow?.current_frontier_rank_low as number | null;
    let highBound = placementRow?.current_frontier_rank_high as number | null;

    if (!frontierRank && placementRow?.baseline_test_run_id) {
      const { data: completedRun } = await supabase
        .from("baseline_test_runs")
        .select(
          "estimated_frontier_rank, estimated_frontier_rank_low, estimated_frontier_rank_high",
        )
        .eq("user_id", user.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (completedRun) {
        frontierRank = (completedRun.estimated_frontier_rank as number | null) ?? null;
        lowBound = (completedRun.estimated_frontier_rank_low as number | null) ?? lowBound;
        highBound = (completedRun.estimated_frontier_rank_high as number | null) ?? highBound;
      }
    }

    if (frontierRank && frontierRank > 200 && limitNew > 0) {
      const picked = await pickNewWordsNearFrontier(supabase, {
        userId: user.id,
        language: lang,
        frontier: {
          rank: frontierRank,
          low: lowBound ?? Math.max(1, frontierRank - 300),
          high: highBound ?? frontierRank + 300,
        },
        limit: limitNew,
        excludeWordIds: excludeWordIds ?? [],
      });
      if (picked.length > 0) {
        const enriched = await enrichWordsByOrder(supabase, picked, lang);
        if (enriched.length > 0) {
          newWords = enriched;
        }
      } else if (userDriven) {
        // User-driven mode and the rank-window picker exhausted (or its RPC
        // errored — pickNewWordsNearFrontier logs and returns []). Rather
        // than silently keep the rank-ASC RPC list (which would serve rank-1
        // beginner words to a learner whose frontier may be in the
        // thousands), walk the whole bank by absolute distance to the
        // frontier and use whatever is closest. newWords is set to [] only
        // when the fallback genuinely has no rows or its RPC errors.
        const { data: fallbackRows, error: fallbackError } = await supabase.rpc(
          "pick_user_driven_fallback",
          {
            p_frontier_rank: frontierRank,
            p_exclude_word_ids: excludeWordIds ?? [],
            p_limit: limitNew,
          } as never,
        );
        if (fallbackError) {
          console.warn(
            "[getDailyQueue] pick_user_driven_fallback RPC error; user-driven queue will be empty",
            fallbackError,
          );
          newWords = [];
        } else {
          const fallback = (fallbackRows ?? []) as Array<{ id: string; rank: number }>;
          if (fallback.length > 0) {
            newWords = await enrichWordsByOrder(supabase, fallback, lang);
          } else {
            newWords = [];
          }
        }
      }
    }
  } catch {
    // Placement override is best-effort; never block the daily queue.
  }

  return {
    ok: true,
    session: { dueReviews: filteredDueReviews, newWords, signedIn: true },
  };
}

export async function getTodayFlashcards(lang: string): Promise<TodayFlashcardsResult> {
  const __perfStart = performance.now();
  const [
    { settings, signedIn },
    mcqQuestionFormats,
    recommended,
    existingDailySession,
    savedWords,
    p50ReviewMs,
    daysSinceLastSession,
    overdueCount,
  ] = await Promise.all([
    getUserSettings(),
    getMcqQuestionFormatsPreference(),
    recommendSettings(),
    getTodayDailySession(),
    getTodaySavedWordsState(lang),
    getP50ReviewMs(),
    getDaysSinceLastSession(),
    getOverdueCount(),
  ]);
  const __perfParallelDone = performance.now();
  const effective = resolveEffectiveSettings(settings, recommended);
  const completedToday = Math.max(
    0,
    existingDailySession?.flashcard_completed_count ??
      existingDailySession?.reviews_done ??
      0,
  );
  const existingAssignedCount = Math.max(
    0,
    existingDailySession?.assigned_flashcard_count ?? 0,
  );
  const sessionTargetCount = existingAssignedCount > 0
    ? existingAssignedCount
    : effective.effectiveDailyLimit;
  const remainingDailyLimit = Math.max(0, sessionTargetCount - completedToday);

  const variant: SchedulerVariant =
    settings.scheduler_variant === "adaptive" ? "adaptive" : "baseline";
  const adaptiveContext =
    variant === "adaptive"
      ? await (async () => {
          const { supabase, user } = await getSupabaseServerContextFast();
          if (!supabase || !user) return null;
          return computeAdaptiveContext(supabase, user.id, variant);
        })()
      : null;

  const baseNewWordBudget = MAX_NEW_WORDS;
  const adaptiveNewWordCap = adaptiveContext
    ? adaptiveContext.workload.adaptiveNewWordCap(baseNewWordBudget)
    : baseNewWordBudget;

  const workloadPolicy = computeWorkloadPolicy({
    p50ReviewMs,
    daysSinceLastSession,
    overdueCount,
    scheduledNewCount: adaptiveNewWordCap,
  });

  const isManualMode = settings.daily_plan_mode === "manual";

  // Detect whether today's target is user-driven rather than autopilot.
  // Three signals — any one is sufficient:
  //   - manual mode: user picked the target explicitly
  //   - explicit override flag: recordReview / extendFlashcardsSession set
  //     effective_daily_target_mode='manual' for a recommended-mode user
  //     who has gone past today's frozen recommendation
  //   - extended assigned vs frozen snapshot: assigned has been raised above
  //     recommended_target_at_creation. Defense-in-depth against the override
  //     flag write failing — both writers treat that update as best-effort.
  // When user-driven, queue sizing and continuation use chunk-fill semantics
  // instead of the recommendedNewWords cap, so the user can reach the target
  // they chose. Pure recommended autopilot (none of the signals) keeps the
  // cap as a pedagogical guardrail.
  const isExplicitOverride =
    existingDailySession?.effective_daily_target_mode === "manual";
  const snapshotRecommended =
    existingDailySession?.recommended_target_at_creation ?? null;
  const isExtended =
    typeof snapshotRecommended === "number" &&
    snapshotRecommended > 0 &&
    existingAssignedCount > snapshotRecommended;
  const isUserDrivenTarget = isManualMode || isExplicitOverride || isExtended;

  const chunk = Math.min(remainingDailyLimit, MANUAL_TARGET_CHUNK);
  const newLimit = isUserDrivenTarget
    ? chunk
    : workloadPolicy.recommendedNewWords;
  const reviewLimit = isUserDrivenTarget
    ? chunk
    : workloadPolicy.recommendedReviews;

  const effectiveSettings = {
    dailyLimit: sessionTargetCount,
    manualTargetMode: isUserDrivenTarget,
    autoAdvanceCorrect: effective.autoAdvanceCorrect,
    showPosHint: effective.showPosHint,
    showDefinitionFirst: effective.showDefinitionFirst,
    hideTranslationSentences: effective.hideTranslationSentences,
    mcqQuestionFormats,
    enabledTypes: effective.enabledModes,
  };

  const __perfPreQueue = performance.now();
  const queueResult = await getDailyQueue(
    lang,
    newLimit,
    reviewLimit,
    undefined,
    isUserDrivenTarget,
  );
  const __perfQueueDone = performance.now();

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

  const sessionLimit = isUserDrivenTarget ? chunk : remainingDailyLimit;
  const session = limitTodaySession(queueResult.session, sessionLimit);
  const dailySession = await upsertDailySession(
    session,
    existingDailySession,
    {
      variant,
      learnerStateScore: adaptiveContext?.learnerState.learnerStateScore ?? null,
      learnerFactor: adaptiveContext?.learnerState.learnerFactor ?? null,
      workloadFactor: adaptiveContext?.workload.workloadFactor ?? null,
      adaptiveNewWordCap: adaptiveContext ? adaptiveNewWordCap : null,
    },
    isManualMode ? "manual" : "recommended",
    recommended.recommendedDailyLimit,
  );

  console.log(
    `[perf] getTodayFlashcards total=${Math.round(performance.now() - __perfStart)}ms ` +
      `parallel8=${Math.round(__perfParallelDone - __perfStart)}ms ` +
      `adaptive+pre=${Math.round(__perfPreQueue - __perfParallelDone)}ms ` +
      `queue=${Math.round(__perfQueueDone - __perfPreQueue)}ms ` +
      `upsert=${Math.round(performance.now() - __perfQueueDone)}ms`,
  );
  return {
    ok: true,
    session,
    dailySession,
    workloadPolicy,
    effectiveSettings,
    savedWords,
  };
}

async function getTodayDailySession(): Promise<DailySessionRow | null> {
  const { supabase, user } = await getSupabaseServerContextFast();
  if (!supabase || !user) return null;

  return getTodayDailySessionRow(supabase, user.id);
}

async function getTodaySavedWordsState(language: string): Promise<SavedWordsState> {
  const { supabase, user } = await getSupabaseServerContextFast();
  if (!supabase || !user) {
    return EMPTY_SAVED_WORDS_STATE;
  }

  return getSavedWordsState(supabase, user.id, language);
}

// p50 review latency is a slow-moving diagnostic metric used only to size
// daily workload. A 10-minute per-user cache is indistinguishable in
// product behaviour from a live fetch and saves the 200-row scan on every
// Today load (and every completion-triggered revalidation).
const P50_CACHE_TTL_MS = 10 * 60 * 1000;
const p50ReviewMsCache = new Map<
  string,
  { value: number | null; expiresAt: number }
>();

async function getP50ReviewMs(): Promise<number | null> {
  const { supabase, user } = await getSupabaseServerContextFast();
  if (!supabase || !user) return null;

  const cached = p50ReviewMsCache.get(user.id);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    console.log(`[perf] getP50ReviewMs cache=hit user=${user.id.slice(0, 8)}`);
    return cached.value;
  }

  const __perfStart = performance.now();
  const { data } = await supabase
    .from("review_events")
    .select("ms_spent")
    .eq("user_id", user.id)
    .eq("correct", true)
    .not("ms_spent", "is", null)
    .gt("ms_spent", 0)
    .lt("ms_spent", 120000)
    .order("submitted_at", { ascending: false })
    .limit(200);

  const values = (data ?? []).map((r) => r.ms_spent as number).filter(Boolean);
  const p50 =
    values.length === 0
      ? null
      : ([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? null);

  p50ReviewMsCache.set(user.id, { value: p50, expiresAt: now + P50_CACHE_TTL_MS });
  console.log(
    `[perf] getP50ReviewMs cache=miss fetch=${Math.round(performance.now() - __perfStart)}ms rows=${values.length}`,
  );
  return p50;
}

async function getDaysSinceLastSession(): Promise<number | null> {
  const { supabase, user } = await getSupabaseServerContextFast();
  if (!supabase || !user) return null;

  const today = getTodaySessionDate();

  const { data } = await supabase
    .from("daily_sessions")
    .select("session_date")
    .eq("user_id", user.id)
    .lt("session_date", today)
    .order("session_date", { ascending: false })
    .limit(1);

  const lastDate = (data ?? [])[0]?.session_date;
  if (!lastDate) return null;

  const diffMs = new Date(today).getTime() - new Date(lastDate).getTime();
  return Math.floor(diffMs / 86400000);
}

// Overdue count is a slow-moving input to workload sizing. A 60-second
// per-user cache removes an exact count scan on every Today load and on
// every completion-triggered revalidation without changing the workload
// policy output in a user-perceptible way.
const OVERDUE_COUNT_CACHE_TTL_MS = 60 * 1000;
const overdueCountCache = new Map<
  string,
  { value: number; expiresAt: number }
>();

async function getOverdueCount(): Promise<number> {
  const { supabase, user } = await getSupabaseServerContextFast();
  if (!supabase || !user) return 0;

  const now = Date.now();
  const cached = overdueCountCache.get(user.id);
  if (cached && cached.expiresAt > now) {
    console.log(`[perf] getOverdueCount cache=hit user=${user.id.slice(0, 8)}`);
    return cached.value;
  }

  const __perfStart = performance.now();
  const { count } = await supabase
    .from("user_words")
    .select("word_id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .lte("next_due", new Date().toISOString())
    .not("last_review_at", "is", null);

  const value = count ?? 0;
  overdueCountCache.set(user.id, { value, expiresAt: now + OVERDUE_COUNT_CACHE_TTL_MS });
  console.log(
    `[perf] getOverdueCount cache=miss fetch=${Math.round(performance.now() - __perfStart)}ms value=${value}`,
  );
  return value;
}

export type LoadMoreResult =
  | { ok: true; dueReviews: DueReviewItem[]; newWords: Word[] }
  | { ok: false; error: string };

export async function loadMoreReviewChunk(
  excludeWordIds: string[],
  lang = "es",
  userDriven = false,
): Promise<LoadMoreResult> {
  // Reviews-only chunk; userDriven only affects new-word selection so this
  // wrapper threads the flag for symmetry with the other continuation paths.
  const result = await getDailyQueue(
    lang,
    0,
    CONTINUATION_REVIEW_CHUNK,
    excludeWordIds,
    userDriven,
  );
  if (!result.ok) return { ok: false, error: result.error ?? "Failed to load reviews" };
  return { ok: true, dueReviews: result.session.dueReviews, newWords: [] };
}

export async function loadMoreNewWordsChunk(
  excludeWordIds: string[],
  lang = "es",
  userDriven = false,
): Promise<LoadMoreResult> {
  const result = await getDailyQueue(
    lang,
    CONTINUATION_NEW_CHUNK,
    0,
    excludeWordIds,
    userDriven,
  );
  if (!result.ok) return { ok: false, error: result.error ?? "Failed to load new words" };
  return { ok: true, dueReviews: [], newWords: result.session.newWords };
}

/**
 * Load a user-chosen number of extra flashcards. Reviews are prioritised;
 * remaining slots are filled with new words. `userDriven` should be true when
 * the caller is in manual / override / extended mode so that an exhausted
 * frontier band falls back to the closest-by-distance picker rather than
 * rank-1 beginner words.
 */
export async function loadMoreFlashcards(
  count: number,
  excludeWordIds: string[],
  lang = "es",
  userDriven = false,
): Promise<LoadMoreResult> {
  const safeCount = Math.max(1, Math.min(count, 200));
  const result = await getDailyQueue(
    lang,
    safeCount,
    safeCount,
    excludeWordIds,
    userDriven,
  );
  if (!result.ok) return { ok: false, error: result.error ?? "Failed to load cards" };
  const reviews = result.session.dueReviews;
  const remainingSlots = Math.max(0, safeCount - reviews.length);
  const newWords = result.session.newWords.slice(0, remainingSlots);
  return { ok: true, dueReviews: reviews, newWords };
}

export type RecordReviewResult =
  | { ok: true; debugSnapshot: FlashcardDebugSnapshot }
  | { ok: false; error: string };

export async function recordReview(
  payload: RecordReviewPayload,
): Promise<RecordReviewResult> {
  const __perfStart = performance.now();
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      return {
        ok: false,
        error: "Supabase env vars NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing",
      };
    }

    const { supabase, user, error: authError } = await getSupabaseServerContextFast();
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

    const __perfAuthDone = performance.now();

    const grade = resolveGrade(payload);
    const queueSource = payload.queueSource ?? "main";
    const retryScheduledFor = payload.retryScheduledFor ?? null;

    // Run settings + speculative adaptive wordState fetch in parallel. wordState
    // is a cheap single-row query and is discarded in baseline variant; this
    // removes a serial RTT in the adaptive path.
    const [{ settings }, wordStateData] = await Promise.all([
      getUserSettings(),
      (async () => {
        const { data } = await supabase
          .from("user_words")
          .select("difficulty,adaptive_evidence_count,status,words(rank)")
          .eq("user_id", user.id)
          .eq("word_id", payload.wordId)
          .maybeSingle();
        return data as
          | {
              difficulty: number | null;
              adaptive_evidence_count: number | null;
              status: string | null;
              words: { rank: number | null } | null;
            }
          | null;
      })(),
    ]);

    // Stale-tab guard: a card may have been opened before the user (or
    // another tab) suspended this word. The queue gate in get_daily_queue
    // prevents fresh draws of suspended words; this catches the race where
    // a stale review is submitted after suspension.
    if (wordStateData?.status === "suspended") {
      return { ok: false, error: "word_suspended" };
    }
    const variant: SchedulerVariant =
      settings.scheduler_variant === "adaptive" ? "adaptive" : "baseline";

    let learnerFactor = 1.0;
    let itemFactor = 1.0;

    if (variant === "adaptive") {
      const adaptive = await computeAdaptiveContext(supabase, user.id, variant);
      learnerFactor = adaptive.learnerState.learnerFactor;
      const item = computeItemFactor({
        rank: wordStateData?.words?.rank ?? null,
        observedDifficulty: wordStateData?.difficulty ?? null,
        evidenceCount: wordStateData?.adaptive_evidence_count ?? 0,
      });
      itemFactor = item.itemFactor;
    }

    const __perfPreRpc = performance.now();

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
      p_first_try: payload.firstTry ?? true,
      p_retry_index: payload.retryIndex ?? 0,
      p_scheduler_variant: variant,
      p_learner_factor: learnerFactor,
      p_item_factor: itemFactor,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    // Override check: if this main-queue submission has pushed today's
    // completion past the recommender snapshot while the user's stated
    // preference is 'recommended', mark today's session as effectively
    // overridden. Fires on the regular card flow (not just at extend time),
    // so a user whose due-review queue naturally carries them past the
    // recommended number also trips the flag. Guarded by queue_source !==
    // 'retry' and idempotent via the effective_daily_target_mode !== 'manual'
    // check. All failures here are logged but do not fail the action — the
    // review was already persisted by the RPC above.
    if (queueSource !== "retry" && settings.daily_plan_mode === "recommended") {
      const sessionDate = getTodaySessionDate();
      const { data: sessionRow, error: sessionLookupError } = await supabase
        .from("daily_sessions")
        .select(
          "flashcard_completed_count,recommended_target_at_creation,effective_daily_target_mode",
        )
        .eq("user_id", user.id)
        .eq("session_date", sessionDate)
        .maybeSingle();

      if (sessionLookupError) {
        console.warn(
          "[recordReview] daily_sessions lookup for override check failed",
          sessionLookupError,
        );
      } else if (sessionRow) {
        const row = sessionRow as {
          flashcard_completed_count: number | null;
          recommended_target_at_creation: number | null;
          effective_daily_target_mode: "recommended" | "manual" | null;
        };
        const completed = row.flashcard_completed_count ?? 0;
        const snapshot = row.recommended_target_at_creation;
        const alreadyOverridden = row.effective_daily_target_mode === "manual";

        if (
          typeof snapshot === "number" &&
          snapshot > 0 &&
          completed > snapshot &&
          !alreadyOverridden
        ) {
          const { error: overrideError } = await supabase
            .from("daily_sessions")
            .update({ effective_daily_target_mode: "manual" })
            .eq("user_id", user.id)
            .eq("session_date", sessionDate);
          if (overrideError) {
            console.warn(
              "[recordReview] failed to mark effective_daily_target_mode override",
              overrideError,
            );
          }
        }
      }
    }

    const __perfRpcDone = performance.now();
    // Debug snapshot is consumed only by dev tooling; skip the 3 extra
    // queries on the hot submit path in production. Do not remove this
    // gate — see docs/performance-guardrails.md (debug-on-hot-path rule).
    const debugSnapshot: FlashcardDebugSnapshot =
      process.env.NODE_ENV === "production"
        ? { dailySession: null, currentUserWord: null, lastReviewEvent: null }
        : await getFlashcardDebugSnapshot(payload.wordId);

    console.log(
      `[perf] recordReview total=${Math.round(performance.now() - __perfStart)}ms ` +
        `auth=${Math.round(__perfAuthDone - __perfStart)}ms ` +
        `pre-rpc=${Math.round(__perfPreRpc - __perfAuthDone)}ms ` +
        `rpc=${Math.round(__perfRpcDone - __perfPreRpc)}ms ` +
        `debug=${Math.round(performance.now() - __perfRpcDone)}ms`,
    );
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

export type RecordReadingQuestionAttemptResult =
  | { ok: true; correct: boolean }
  | { ok: false; error: string };

export async function recordReadingQuestionAttempt(payload: {
  textId: string;
  questionId: string;
  selectedOption: number;
  responseMs: number;
}): Promise<RecordReadingQuestionAttemptResult> {
  try {
    const { supabase, user, error: authError } = await getSupabaseServerContextFast();
    if (!supabase) {
      return { ok: false, error: "Supabase client could not be created on the server" };
    }
    if (authError) return { ok: false, error: authError };
    if (!user) return { ok: false, error: "Not authenticated" };

    const { data, error } = await supabase.rpc("record_reading_question_attempt", {
      p_text_id: payload.textId,
      p_question_id: payload.questionId,
      p_selected_option: payload.selectedOption,
      p_response_ms: Math.max(0, Math.round(payload.responseMs)),
    });

    if (error) return { ok: false, error: error.message };
    const row = data as { correct: boolean } | null;
    return { ok: true, correct: Boolean(row?.correct) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to record reading question",
    };
  }
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

  const { supabase, user, error: authError } = await getSupabaseServerContextFast();
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

// INVARIANT: once a daily_sessions row exists, assignedFlashcardCount must be
// returned as-is from the existing row. Do not max it against completed
// counts. The "Do more flashcards" path legitimately mutates the column via
// extendFlashcardsSession, but any other code path reaching this helper with
// an existing row must preserve the value. The other five upsert call sites
// (extendFlashcardsSession, completeReadingStep, completeListeningStep,
// markReadingOpened, markListeningOpened, markListeningPlaybackStarted) all
// pass the result of this helper through to their own upsert payloads,
// relying on this preservation. If you change this helper back to max
// semantics, you silently corrupt research data across all six call sites.
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

  const hasExistingAssigned =
    current?.assigned_flashcard_count != null || current?.new_words_count != null;

  return {
    assignedFlashcardCount: hasExistingAssigned
      ? assignedFlashcardCount
      : Math.max(
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

  return "completed";
}

function getDailySessionCompleted(state: DailySessionProgressState) {
  return resolveDailySessionStage(state) === "completed";
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

  if (dailySession.stage === "completed") {
    return "/done";
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

type AdaptiveDailySessionPatch = {
  variant: SchedulerVariant;
  learnerStateScore: number | null;
  learnerFactor: number | null;
  workloadFactor: number | null;
  adaptiveNewWordCap: number | null;
};

async function upsertDailySession(
  session: TodaySession,
  existingDailySession: DailySessionRow | null,
  adaptive?: AdaptiveDailySessionPatch,
  dailyTargetMode?: "recommended" | "manual",
  recommendedTargetAtCreation?: number,
): Promise<DailySessionRow | null> {
  const { supabase, user } = await getSupabaseServerContextFast();
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

  // These columns capture state at session creation and must never be rewritten.
  // upsertDailySession runs on every /today render (settings save, loop-stage
  // completion, or plain reload all revalidate /today). If these columns sat in
  // the payload on conflict, Supabase's upsert compiles to INSERT ... ON CONFLICT
  // DO UPDATE SET <every column in the payload>, silently overwriting the
  // session-start snapshot with live user_settings and freshly recomputed
  // adaptive values. Omitting them from the payload on the update path means
  // they are absent from the SET list and cannot be touched.
  const isInsert = existingDailySession === null;
  const insertOnlySnapshot = isInsert
    ? {
        daily_target_mode: dailyTargetMode ?? "recommended",
        initial_assigned_flashcard_count: progress.assignedFlashcardCount,
        recommended_target_at_creation: recommendedTargetAtCreation ?? null,
        ...(adaptive
          ? {
              scheduler_variant: adaptive.variant,
              learner_state_score: adaptive.learnerStateScore,
              learner_factor: adaptive.learnerFactor,
              workload_factor: adaptive.workloadFactor,
              adaptive_new_word_cap: adaptive.adaptiveNewWordCap,
            }
          : {}),
      }
    : {};

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
        ...insertOnlySnapshot,
      },
      { onConflict: "user_id,session_date" },
    )
    .select("*")
    .single();

  if (error) return null;
  return data as DailySessionRow;
}

export type ExtendFlashcardsResult =
  | { ok: true }
  | { ok: false; reason: string };

const EXTEND_FLASHCARDS_MAX = 200;

export async function extendFlashcardsSession(
  count: number,
): Promise<ExtendFlashcardsResult> {
  if (!Number.isFinite(count) || count < 1 || count > EXTEND_FLASHCARDS_MAX) {
    return { ok: false, reason: "invalid_count" };
  }

  const { supabase, user, error: authError } = await getSupabaseServerContextFast();
  if (!supabase) return { ok: false, reason: "supabase_unavailable" };
  if (authError) return { ok: false, reason: authError };
  if (!user) return { ok: false, reason: "not_authenticated" };

  const currentDailySession = await getTodayDailySessionRow(supabase, user.id);
  if (!currentDailySession) return { ok: false, reason: "no_session" };
  if (
    currentDailySession.stage !== "reading" &&
    currentDailySession.stage !== "completed"
  ) {
    return { ok: false, reason: "wrong_stage" };
  }
  if (!currentDailySession.flashcards_completed_at) {
    return { ok: false, reason: "flashcards_not_complete" };
  }
  const fromCompleted = currentDailySession.stage === "completed";

  const currentProgress = getDailySessionProgressState(currentDailySession);
  const nextProgress: DailySessionProgressState = {
    ...currentProgress,
    assignedFlashcardCount: currentProgress.assignedFlashcardCount + count,
    assignedNewWordsCount: currentProgress.assignedNewWordsCount + count,
  };
  const stage = resolveDailySessionStage(nextProgress);
  const now = new Date().toISOString();
  const sessionDate = getTodaySessionDate();

  const { error } = await supabase
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
          currentDailySession.flashcard_new_completed_count ?? 0,
        flashcard_review_completed_count:
          currentDailySession.flashcard_review_completed_count ?? 0,
        flashcard_attempts_count:
          currentDailySession.flashcard_attempts_count ?? 0,
        flashcard_retry_count: currentDailySession.flashcard_retry_count ?? 0,
        started_at: currentDailySession.started_at ?? now,
        last_active_at: now,
        flashcards_completed_at: null,
        reading_done: fromCompleted,
        reading_text_id: currentDailySession.reading_text_id,
        reading_opened_at: currentDailySession.reading_opened_at,
        reading_completed_at: currentDailySession.reading_completed_at,
        reading_time_seconds: currentDailySession.reading_time_seconds ?? 0,
        listening_done: fromCompleted,
        listening_asset_id: currentDailySession.listening_asset_id,
        listening_opened_at: currentDailySession.listening_opened_at,
        listening_playback_started_at:
          currentDailySession.listening_playback_started_at,
        listening_completed_at: currentDailySession.listening_completed_at,
        listening_max_position_seconds:
          currentDailySession.listening_max_position_seconds,
        listening_required_seconds:
          currentDailySession.listening_required_seconds,
        listening_transcript_opened:
          currentDailySession.listening_transcript_opened ?? false,
        listening_playback_rate: currentDailySession.listening_playback_rate,
        listening_time_seconds:
          currentDailySession.listening_time_seconds ?? 0,
        completed: false,
        completed_at: fromCompleted ? currentDailySession.completed_at : null,
      },
      { onConflict: "user_id,session_date" },
    );

  if (error) return { ok: false, reason: error.message };

  // After a successful extend, align the user's stated preference (or today's
  // override flag) with what they just committed to. The two cases are
  // mutually exclusive:
  //   - manual: mirror the new assigned count into user_settings so their
  //     preference (and therefore tomorrow's target) reflects today's commitment.
  //   - recommended: today has been overridden, but their preference for
  //     tomorrow stays 'recommended'. Mark the session row so /settings can
  //     disable the recommended radio for the rest of today without mutating
  //     user_settings.
  // Both secondary writes are best-effort: if they fail, the extend itself
  // already succeeded and the user-facing flow must not be blocked.
  const { data: userSettingsRow, error: userSettingsLookupError } = await supabase
    .from("user_settings")
    .select("daily_plan_mode")
    .eq("user_id", user.id)
    .maybeSingle();

  if (userSettingsLookupError) {
    console.warn(
      "[extendFlashcardsSession] user_settings lookup failed; skipping secondary write",
      userSettingsLookupError,
    );
  } else if (userSettingsRow) {
    const dailyPlanMode = (userSettingsRow as { daily_plan_mode: "recommended" | "manual" | null })
      .daily_plan_mode;

    if (dailyPlanMode === "manual") {
      const { error: manualLimitError } = await supabase
        .from("user_settings")
        .update({ manual_daily_card_limit: nextProgress.assignedFlashcardCount })
        .eq("user_id", user.id);
      if (manualLimitError) {
        console.warn(
          "[extendFlashcardsSession] failed to mirror manual_daily_card_limit",
          manualLimitError,
        );
      }
    } else if (dailyPlanMode === "recommended") {
      const { error: overrideError } = await supabase
        .from("daily_sessions")
        .update({ effective_daily_target_mode: "manual" })
        .eq("user_id", user.id)
        .eq("session_date", sessionDate);
      if (overrideError) {
        console.warn(
          "[extendFlashcardsSession] failed to mark effective_daily_target_mode override",
          overrideError,
        );
      }
    }
  }

  revalidatePath("/today");
  return { ok: true };
}

export async function skipFlashcardsToReading() {
  const { supabase, user, error: authError } = await getSupabaseServerContextFast();
  if (!supabase || authError || !user) return;

  const now = new Date().toISOString();
  const sessionDate = getTodaySessionDate();

  await supabase
    .from("daily_sessions")
    .update({
      stage: "reading",
      flashcards_completed_at: now,
      last_active_at: now,
    })
    .eq("user_id", user.id)
    .eq("session_date", sessionDate);

  revalidatePath("/today");
}

export async function completeReadingStep({
  textId,
  readingTimeSeconds = 0,
}: {
  textId: string;
  readingTimeSeconds?: number;
}): Promise<CompleteReadingStepResult> {
  const __perfStart = performance.now();
  try {
    const { supabase, user, error: authError } = await getSupabaseServerContextFast();
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

    // Upsert persistent reading_progress (completed)
    await supabase.from("reading_progress").upsert(
      {
        user_id: user.id,
        text_id: textId,
        status: "completed",
        started_at: now,
        completed_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,text_id" },
    );

    // Narrowed to the pages that read reading_progress or the next-step UI
    // after a reading completion. Do not expand without re-reading
    // docs/performance-guardrails.md.
    revalidatePath("/today"); // perf-ok: next-step card on Today reads completion state
    revalidatePath("/reading"); // perf-ok: reading index shows done/not-done per text
    revalidatePath(`/reader/${textId}`); // perf-ok: the current text's own done state
    if (listeningAsset) {
      revalidatePath(`/listening/${listeningAsset.id}`); // perf-ok: matched audio unlock
    }

    const dailySession = data as DailySessionRow;

    console.log(
      `[perf] completeReadingStep total=${Math.round(performance.now() - __perfStart)}ms`,
    );
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

export async function markReadingComplete({
  textId,
  readingTimeSeconds = 0,
}: {
  textId: string;
  readingTimeSeconds?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, user, error: authError } = await getSupabaseServerContextFast();
    if (!supabase) {
      return { ok: false, error: "Supabase client could not be created on the server" };
    }
    if (authError) return { ok: false, error: authError };
    if (!user) return { ok: false, error: "Not authenticated" };

    const now = new Date().toISOString();

    // Upsert reading_progress as completed
    await supabase.from("reading_progress").upsert(
      {
        user_id: user.id,
        text_id: textId,
        status: "completed",
        started_at: now,
        completed_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,text_id" },
    );

    revalidatePath("/reading");
    revalidatePath(`/reader/${textId}`);

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to mark reading complete",
    };
  }
}

export async function uncompleteReadingStep({
  textId,
}: {
  textId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, user, error: authError } = await getSupabaseServerContextFast();
    if (!supabase) {
      return { ok: false, error: "Supabase client could not be created on the server" };
    }
    if (authError) return { ok: false, error: authError };
    if (!user) return { ok: false, error: "Not authenticated" };

    // Remove persistent reading_progress so the passage appears untouched
    await supabase
      .from("reading_progress")
      .delete()
      .eq("user_id", user.id)
      .eq("text_id", textId);

    revalidatePath("/reading");
    revalidatePath(`/reader/${textId}`);

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to undo reading completion",
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
  const __perfStart = performance.now();
  try {
    const { supabase, user, error: authError } = await getSupabaseServerContextFast();
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
    // "Done for today" is the terminal step of the daily loop. We mark
    // readingDone alongside listeningDone so resolveDailySessionStage can
    // collapse to 'completed' even if the session row's reading_done was
    // somehow still false (e.g. data drift, partial recovery, a flow that
    // bypassed completeReadingStep). Without this, a user who legitimately
    // pressed "Done for today" can compute stage='reading' and land back on
    // /reader/<id> via getNextPathForDailySession.
    const nextProgress: DailySessionProgressState = {
      ...currentProgress,
      readingDone: true,
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
          reading_done: nextProgress.readingDone,
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

    // Upsert persistent listening_progress (completed)
    await supabase.from("listening_progress").upsert(
      {
        user_id: user.id,
        asset_id: listeningAsset.id,
        status: "completed",
        started_at: now,
        completed_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,asset_id" },
    );

    revalidatePath("/today");
    revalidatePath("/listening");
    revalidatePath(`/listening/${listeningAsset.id}`);

    const dailySession = data as DailySessionRow;

    // Fire-and-forget placement recalibration at end of session.
    if (getDailySessionCompleted(nextProgress)) {
      try {
        await recalibratePlacementForUser(supabase, user.id);
      } catch {
        // Recalibration is best-effort; never block the session completion.
      }
    }

    console.log(
      `[perf] completeListeningStep total=${Math.round(performance.now() - __perfStart)}ms`,
    );
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

export async function uncompleteListeningStep({
  assetId,
}: {
  assetId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, user, error: authError } = await getSupabaseServerContextFast();
    if (!supabase) {
      return { ok: false, error: "Supabase client could not be created on the server" };
    }
    if (authError) {
      return { ok: false, error: authError };
    }
    if (!user) {
      return { ok: false, error: "Not authenticated" };
    }

    const { error: deleteError } = await supabase
      .from("listening_progress")
      .delete()
      .eq("user_id", user.id)
      .eq("asset_id", assetId);

    if (deleteError) {
      return { ok: false, error: deleteError.message };
    }

    const currentDailySession = await getTodayDailySessionRow(supabase, user.id);
    if (
      currentDailySession &&
      currentDailySession.listening_asset_id === assetId &&
      currentDailySession.listening_done
    ) {
      const nextProgress = getDailySessionProgressState(currentDailySession);
      nextProgress.listeningDone = false;
      const stage = resolveDailySessionStage(nextProgress);

      const { error: updateError } = await supabase
        .from("daily_sessions")
        .update({
          listening_done: false,
          listening_completed_at: null,
          stage,
          completed: getDailySessionCompleted(nextProgress),
          completed_at: getDailySessionCompleted(nextProgress)
            ? currentDailySession.completed_at
            : null,
        })
        .eq("user_id", user.id)
        .eq("session_date", getTodaySessionDate());

      if (updateError) {
        return { ok: false, error: updateError.message };
      }
    }

    revalidatePath("/today");
    revalidatePath("/listening");
    revalidatePath(`/listening/${assetId}`);

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to undo listening completion",
    };
  }
}

export async function markReadingOpened({
  textId,
}: {
  textId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { supabase, user, error: authError } = await getSupabaseServerContextFast();
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

    // Upsert persistent reading_progress (in_progress)
    await supabase.from("reading_progress").upsert(
      {
        user_id: user.id,
        text_id: textId,
        status: "in_progress",
        started_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,text_id", ignoreDuplicates: true },
    );

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
    const { supabase, user, error: authError } = await getSupabaseServerContextFast();
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

    // Upsert persistent listening_progress (in_progress)
    await supabase.from("listening_progress").upsert(
      {
        user_id: user.id,
        asset_id: listeningAsset.id,
        status: "in_progress",
        started_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,asset_id", ignoreDuplicates: true },
    );

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
    const { supabase, user, error: authError } = await getSupabaseServerContextFast();
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

  const { user } = await getSupabaseServerContextFast();
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

// ---------------------------------------------------------------------------
// Soft-suspend: remove a word from the user's active deck without losing
// history. The row stays in user_words so review_events / exposure_events
// remain joinable, the new-word picker keeps excluding it (NOT EXISTS), and
// the review branch of get_daily_queue gates on status (see migration
// 20260426140000_add_word_suspend.sql). srs_state is the scheduler's private
// state; we never touch it from these actions.
// ---------------------------------------------------------------------------

export type SuspendReason =
  | "already_known"
  | "not_useful"
  | "incorrect"
  | "do_not_want"
  | "other";

export type SuspendWordResult =
  | { ok: true }
  | { ok: false; reason: string };

const SUSPEND_REASONS: ReadonlySet<SuspendReason> = new Set([
  "already_known",
  "not_useful",
  "incorrect",
  "do_not_want",
  "other",
]);

export async function suspendWord(
  wordId: string,
  reason?: SuspendReason | null,
): Promise<SuspendWordResult> {
  const { supabase, user, error: authError } = await getSupabaseServerContextFast();
  if (!supabase) return { ok: false, reason: "supabase_unavailable" };
  if (authError) return { ok: false, reason: authError };
  if (!user) return { ok: false, reason: "not_authenticated" };
  if (!wordId) return { ok: false, reason: "invalid_word_id" };

  const safeReason: SuspendReason | null =
    reason && SUSPEND_REASONS.has(reason) ? reason : null;
  const now = new Date().toISOString();

  // .select() returns the affected rows; an empty array means no row matched
  // (either the row does not exist or RLS denied access — both are surfaced
  // as 'not_found' to the caller). suspendWord must NOT insert: the row only
  // exists once the user has actually engaged with the word.
  const { data, error } = await supabase
    .from("user_words")
    .update({
      status: "suspended",
      suspended_at: now,
      suspended_reason: safeReason,
      updated_at: now,
    })
    .eq("user_id", user.id)
    .eq("word_id", wordId)
    .select("word_id");

  if (error) return { ok: false, reason: error.message };
  if (!data || data.length === 0) return { ok: false, reason: "not_found" };

  // Intentionally NO revalidatePath('/today') here. Revalidating refetches
  // server data and remounts TodaySession with a queue that no longer
  // includes this word, which unmounts the SuspendWordControl before its
  // post-success render is visible — the Undo affordance becomes
  // unreachable. The next natural /today render (Continue / Next / refresh)
  // picks up the new server state correctly because get_daily_queue gates
  // on status='suspended'.
  return { ok: true };
}

export async function unsuspendWord(wordId: string): Promise<SuspendWordResult> {
  const { supabase, user, error: authError } = await getSupabaseServerContextFast();
  if (!supabase) return { ok: false, reason: "supabase_unavailable" };
  if (authError) return { ok: false, reason: authError };
  if (!user) return { ok: false, reason: "not_authenticated" };
  if (!wordId) return { ok: false, reason: "invalid_word_id" };

  const now = new Date().toISOString();

  // Restore to 'learning' so the row re-enters the review queue. We
  // intentionally do NOT touch srs_state, next_due, reps, stability,
  // difficulty, ewma_*, learned_level, or any of the SRS history — the
  // scheduler picks up exactly where it left off.
  const { data, error } = await supabase
    .from("user_words")
    .update({
      status: "learning",
      suspended_at: null,
      suspended_reason: null,
      updated_at: now,
    })
    .eq("user_id", user.id)
    .eq("word_id", wordId)
    .select("word_id");

  if (error) return { ok: false, reason: error.message };
  if (!data || data.length === 0) return { ok: false, reason: "not_found" };

  // Same rationale as suspendWord: no revalidatePath here. The control's
  // local state machine handles the optimistic Undo flow; the next /today
  // render reflects the restored row.
  return { ok: true };
}
