/**
 * Adaptive scheduling layer — orchestrator.
 *
 * Wires together learner-state, item-difficulty, and workload modules
 * against the real persisted data. The output of `computeAdaptiveContext`
 * is consumed by:
 *   • the recordReview server action  → learner_factor + item_factor passed to RPC
 *   • the getTodayFlashcards action   → workload_factor caps the new-word budget
 *   • daily_sessions instrumentation  → learner_state_score, factors persisted
 */

import {
  computeLearnerState,
  type LearnerStateResult,
  type SessionSignal,
  RECENT_SESSIONS_WINDOW,
  RECENT_DAYS_FALLBACK,
  LATENCY_OUTLIER_MAX_MS,
  median,
} from "./learnerState";
import {
  computeItemFactor,
  ITEM_FACTOR_NEUTRAL_DIFFICULTY,
} from "./itemDifficulty";
import {
  computeWorkloadFactor,
  WORKLOAD_FACTOR_NEUTRAL,
  type WorkloadAdjustment,
} from "./workloadController";
import { getTodaySessionDate } from "@/lib/loop/dailySessions";

export type SchedulerVariant = "baseline" | "adaptive";

// Untyped escape hatch. The project's supabase client is not generic-typed,
// so we accept it here as `any` and confine it to this module.
type SupabaseLike = {
  from: (table: string) => unknown;
};

export type AdaptiveContext = {
  variant: SchedulerVariant;
  learnerState: LearnerStateResult;
  workload: WorkloadAdjustment;
  overdueCount: number;
  expectedDailyLoad: number;
};

export const NEUTRAL_LEARNER_STATE: LearnerStateResult = {
  learnerStateScore: 0,
  learnerFactor: 1.0,
  components: {
    accuracy: null,
    retryBurden: null,
    readingQuestionAccuracy: null,
    completionRate: null,
    backlogPressure: 0,
    latencyRefinement: 0,
  },
  sampleSize: 0,
};

export const NEUTRAL_WORKLOAD: WorkloadAdjustment = {
  workloadFactor: WORKLOAD_FACTOR_NEUTRAL,
  adaptiveNewWordCap: (b: number) => Math.max(0, Math.round(b)),
  reasons: ["baseline mode"],
};

type SessionRow = {
  id: string;
  session_date: string;
  assigned_flashcard_count: number | null;
  flashcard_completed_count: number | null;
  flashcard_attempts_count: number | null;
  flashcard_retry_count: number | null;
  flashcard_new_completed_count: number | null;
  flashcard_review_completed_count: number | null;
  reading_question_accuracy: number | null;
  reading_question_attempts_count: number | null;
  completed: boolean | null;
};

type ReviewRow = {
  daily_session_id: string | null;
  session_date: string | null;
  queue_source: string;
  correct: boolean;
  first_try: boolean | null;
  ms_spent: number | null;
};

/**
 * Build the adaptive context for a single user. Always safe to call:
 * returns NEUTRAL-equivalent values when data is sparse.
 */
export async function computeAdaptiveContext(
  supabase: SupabaseLike,
  userId: string,
  variant: SchedulerVariant,
): Promise<AdaptiveContext> {
  const today = getTodaySessionDate();

  // 1. Pull recent daily sessions (most-recent first), limited to N+1.
  const sessionsResult = await ((supabase as unknown) as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          lte: (c: string, v: string) => {
            order: (c: string, opts: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: SessionRow[] | null; error: unknown }>;
            };
          };
        };
      };
    };
  })
    .from("daily_sessions")
    .select(
      "id,session_date,assigned_flashcard_count,flashcard_completed_count,flashcard_attempts_count,flashcard_retry_count,flashcard_new_completed_count,flashcard_review_completed_count,reading_question_accuracy,reading_question_attempts_count,completed",
    )
    .eq("user_id", userId)
    .lte("session_date", today)
    .order("session_date", { ascending: false })
    .limit(RECENT_SESSIONS_WINDOW + 1);

  const rawSessions = sessionsResult.data ?? [];
  const completedSessions = rawSessions.filter(
    (row) => (row.flashcard_attempts_count ?? 0) > 0,
  );
  const useSessions = completedSessions.slice(0, RECENT_SESSIONS_WINDOW);

  // 2. Pull review events for those sessions, or fall back to a 7-day window.
  const sessionIds = useSessions.map((s) => s.id);
  const cutoffDate = new Date(`${today}T00:00:00Z`);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - RECENT_DAYS_FALLBACK);
  const cutoffIso = cutoffDate.toISOString().slice(0, 10);
  const useFallback = sessionIds.length === 0;

  let reviewRows: ReviewRow[] = [];
  if (useFallback) {
    const r = await ((supabase as unknown) as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => {
            gte: (c: string, v: string) => Promise<{ data: ReviewRow[] | null }>;
          };
        };
      };
    })
      .from("review_events")
      .select("daily_session_id,session_date,queue_source,correct,first_try,ms_spent")
      .eq("user_id", userId)
      .gte("session_date", cutoffIso);
    reviewRows = r.data ?? [];
  } else {
    const r = await ((supabase as unknown) as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => {
            in: (c: string, v: string[]) => Promise<{ data: ReviewRow[] | null }>;
          };
        };
      };
    })
      .from("review_events")
      .select("daily_session_id,session_date,queue_source,correct,first_try,ms_spent")
      .eq("user_id", userId)
      .in("daily_session_id", sessionIds);
    reviewRows = r.data ?? [];
  }

  // 3. Group review events by session and synthesize signals.
  const bySession = new Map<string, ReviewRow[]>();
  for (const row of reviewRows) {
    const key = row.daily_session_id ?? row.session_date ?? "_unknown";
    const arr = bySession.get(key);
    if (arr) arr.push(row);
    else bySession.set(key, [row]);
  }

  const recentSessions: SessionSignal[] = useFallback
    ? buildFallbackSignals(reviewRows, rawSessions)
    : useSessions.map((sess) => buildSignalForSession(sess, bySession.get(sess.id) ?? []));

  // 4. Overdue count + expected daily load.
  const overdueResult = await ((supabase as unknown) as {
    from: (t: string) => {
      select: (
        c: string,
        opts: { count: "exact"; head: true },
      ) => {
        eq: (c: string, v: string) => {
          lte: (c: string, v: string) => {
            not: (c: string, op: string, v: null) => Promise<{ count: number | null }>;
          };
        };
      };
    };
  })
    .from("user_words")
    .select("word_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .lte("next_due", new Date().toISOString())
    .not("last_review_at", "is", null);

  const overdueCount = overdueResult.count ?? 0;

  const totalAssigned = useSessions.reduce(
    (acc, s) => acc + (s.assigned_flashcard_count ?? 0),
    0,
  );
  const expectedDailyLoad =
    useSessions.length > 0 ? Math.max(1, totalAssigned / useSessions.length) : 10;

  // 5. Compute learner state and workload.
  const learnerState = computeLearnerState({
    recentSessions,
    overdueCount,
    expectedDailyLoad,
  });

  const completionRate =
    recentSessions.length === 0
      ? null
      : recentSessions.reduce((acc, s) => acc + (s.completionRate ?? 0), 0) /
        recentSessions.length;
  const retryBurden =
    recentSessions.length === 0
      ? null
      : recentSessions.reduce((acc, s) => acc + (s.retryBurden ?? 0), 0) /
        recentSessions.length;

  const workload = computeWorkloadFactor({
    learnerStateScore: learnerState.learnerStateScore,
    sampleSize: learnerState.sampleSize,
    completionRate,
    retryBurden,
    overdueCount,
    expectedDailyLoad,
  });

  if (variant === "baseline") {
    return {
      variant: "baseline",
      learnerState: { ...learnerState, learnerFactor: 1.0 },
      workload: NEUTRAL_WORKLOAD,
      overdueCount,
      expectedDailyLoad,
    };
  }

  return { variant, learnerState, workload, overdueCount, expectedDailyLoad };
}

function buildSignalForSession(
  sessionRow: SessionRow,
  events: ReviewRow[],
): SessionSignal {
  const main = events.filter((e) => e.queue_source !== "retry");
  const firstPassCorrect = main.filter((e) => e.correct && (e.first_try ?? true)).length;
  const firstPassAccuracy = main.length > 0 ? firstPassCorrect / main.length : null;
  const retries = events.filter((e) => e.queue_source === "retry").length;
  const retryBurden = main.length > 0 ? retries / main.length : null;
  const correctMs = main
    .filter((e) => e.correct && typeof e.ms_spent === "number" && e.ms_spent! > 0)
    .map((e) => Math.min(LATENCY_OUTLIER_MAX_MS, e.ms_spent as number));
  const medianResponseMs = median(correctMs);

  const assigned = sessionRow.assigned_flashcard_count ?? 0;
  const completed = sessionRow.flashcard_completed_count ?? 0;
  const completionRate = assigned > 0 ? Math.min(1, completed / assigned) : null;

  return {
    firstPassAccuracy,
    retryBurden,
    readingQuestionAccuracy: sessionRow.reading_question_accuracy,
    completionRate,
    medianResponseMs,
  };
}

function buildFallbackSignals(
  reviewRows: ReviewRow[],
  rawSessions: SessionRow[],
): SessionSignal[] {
  if (reviewRows.length === 0) return [];
  const main = reviewRows.filter((e) => e.queue_source !== "retry");
  const firstPassCorrect = main.filter((e) => e.correct && (e.first_try ?? true)).length;
  const firstPassAccuracy = main.length > 0 ? firstPassCorrect / main.length : null;
  const retries = reviewRows.filter((e) => e.queue_source === "retry").length;
  const retryBurden = main.length > 0 ? retries / main.length : null;
  const correctMs = main
    .filter((e) => e.correct && typeof e.ms_spent === "number" && e.ms_spent! > 0)
    .map((e) => Math.min(LATENCY_OUTLIER_MAX_MS, e.ms_spent as number));
  const medianResponseMs = median(correctMs);

  const completionRates = rawSessions
    .filter((s) => (s.assigned_flashcard_count ?? 0) > 0)
    .map((s) =>
      Math.min(
        1,
        (s.flashcard_completed_count ?? 0) / (s.assigned_flashcard_count ?? 1),
      ),
    );
  const completionRate =
    completionRates.length > 0
      ? completionRates.reduce((acc, v) => acc + v, 0) / completionRates.length
      : null;

  const readingAccs = rawSessions
    .map((s) => s.reading_question_accuracy)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const readingAcc =
    readingAccs.length > 0
      ? readingAccs.reduce((acc, v) => acc + v, 0) / readingAccs.length
      : null;

  return [
    {
      firstPassAccuracy,
      retryBurden,
      readingQuestionAccuracy: readingAcc,
      completionRate,
      medianResponseMs,
    },
  ];
}

export { ITEM_FACTOR_NEUTRAL_DIFFICULTY, computeItemFactor };
