import { getSupabaseServerContext } from "@/lib/supabase/server";
import { getTodaySessionDate } from "@/lib/loop/dailySessions";
import type { RecommendedSettings, RecommendedTypes } from "./types";

/**
 * Recommended daily flashcard target.
 *
 * Pilot (v1, stateless) implementation of the adaptive-target formula from
 * the design doc. Drives the "Recommended" number shown on /settings and the
 * Today panel. Two signals: card-type-weighted accuracy over the last 100
 * reviews, and days since the user's last daily session (inactivity decay).
 *
 * Formula (see `computeRecommendedTarget` below):
 *   target = clamp(
 *     (ANCHOR ± exponential response to (accuracy - ACCURACY_REFERENCE))
 *       * (1 - inactivity penalty on log(1 + days)),
 *     [FLOOR, CEILING]
 *   )
 *
 * Card-type weights collapse the design-doc directional values because
 * `review_events` has no direction column (cloze en→es and es→en are both
 * stored as `'cloze'`). Cloze is set to the midpoint of the two directional
 * weights (2.0 and 1.4 → 1.7).
 *
 * This is the pilot (v1). A stateful controller with day-over-day recursion
 * and a three-consecutive-day gate is out of scope here — planned for v2.
 */

export const ANCHOR = 30;
export const FLOOR = 10;
export const CEILING = 200;
export const ACCURACY_REFERENCE = 0.80;
export const K_UP = 6;
export const K_DOWN = 6;
export const INACTIVITY_MAX_DAYS = 21;
export const INACTIVITY_MAX_PENALTY = 0.67;

/**
 * Card-type weights, collapsed from the design doc's directional values.
 * `review_events.card_type` is one of: cloze | normal | audio | mcq | sentences.
 * Weights reflect the cognitive load of each card type during recall.
 */
export const CARD_TYPE_WEIGHTS: Record<string, number> = {
  cloze: 1.7,
  sentences: 1.7,
  audio: 1.5,
  mcq: 1.2,
  normal: 1.1,
};

/** Default weight for unknown card_type values (defensive; the CHECK constraint should prevent this). */
const DEFAULT_CARD_TYPE_WEIGHT = 1.0;

export type ReviewEventForAccuracy = {
  correct: boolean;
  card_type: string;
};

/**
 * Card-type-weighted accuracy. Returns null when there are no events.
 *
 * A = Σ(w_i * correct_i) / Σ(w_i)
 *
 * where w_i = CARD_TYPE_WEIGHTS[card_type] (fallback 1.0 for unknown types).
 */
export function computeWeightedAccuracy(
  events: readonly ReviewEventForAccuracy[],
): number | null {
  if (events.length === 0) return null;
  let num = 0;
  let den = 0;
  for (const e of events) {
    const w = CARD_TYPE_WEIGHTS[e.card_type] ?? DEFAULT_CARD_TYPE_WEIGHT;
    num += w * (e.correct ? 1 : 0);
    den += w;
  }
  if (den <= 0) return null;
  return num / den;
}

/**
 * Map card-type-weighted accuracy and days-since-last-session to a
 * recommended daily target in [FLOOR, CEILING].
 *
 * Null weightedAccuracy (no data) is treated as ACCURACY_REFERENCE so the
 * delta is zero and the target sits at ANCHOR before the inactivity penalty.
 *
 * Pure: no I/O. All values are integers after rounding.
 */
export function computeRecommendedTarget(input: {
  weightedAccuracy: number | null;
  daysSinceLast: number;
}): number {
  const accuracy = input.weightedAccuracy ?? ACCURACY_REFERENCE;
  const delta = accuracy - ACCURACY_REFERENCE;
  const upward = Math.max(0, delta);
  const downward = Math.max(0, -delta);

  const targetFromAccuracy =
    ANCHOR +
    (CEILING - ANCHOR) * (1 - Math.exp(-K_UP * upward)) -
    (ANCHOR - FLOOR) * (1 - Math.exp(-K_DOWN * downward));

  const days = Math.max(0, input.daysSinceLast);
  const inactivityPenalty =
    INACTIVITY_MAX_PENALTY *
    Math.min(1, Math.log(1 + days) / Math.log(1 + INACTIVITY_MAX_DAYS));

  const inactivityMultiplier = 1 - inactivityPenalty;

  const raw = targetFromAccuracy * inactivityMultiplier;
  return Math.round(Math.max(FLOOR, Math.min(CEILING, raw)));
}

/**
 * Diff (in whole days) between two session-date strings in YYYY-MM-DD form.
 * Returns 0 when `from` is after `to` or either value is unparseable.
 */
function daysBetweenSessionDates(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return Math.floor((to - from) / 86400000);
}

export async function recommendSettings(): Promise<RecommendedSettings> {
  let recommendedDailyLimit = ANCHOR;
  let types: RecommendedTypes = {
    cloze: true,
    normal: true,
    audio: false,
    mcq: false,
    sentences: false,
  };

  const { supabase, user } = await getSupabaseServerContext();
  if (!supabase || !user) {
    return { recommendedDailyLimit, recommendedTypes: types };
  }

  // Backlog query retained per spec. Not consumed by the new target formula;
  // kept for now to avoid a behavioural change elsewhere. Safe to remove in
  // a follow-up once it is confirmed that no other caller depends on the
  // side effect of this fetch.
  const [
    { count: _backlogDueCount },
    { data: recentEvents, error: eventsError },
    { count: totalEventCount },
    { data: lastSession },
  ] = await Promise.all([
    supabase
      .from("user_words")
      .select("word_id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .lte("due_at", new Date().toISOString()),
    supabase
      .from("review_events")
      .select("correct,card_type")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("review_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("daily_sessions")
      .select("session_date")
      .eq("user_id", user.id)
      .order("session_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  void _backlogDueCount;

  if (eventsError) {
    console.warn("[recommendSettings] review_events query failed", eventsError);
  }

  const events = (recentEvents ?? []) as ReviewEventForAccuracy[];
  const weightedAccuracy = computeWeightedAccuracy(events);

  const lastSessionDate = (lastSession as { session_date: string } | null)?.session_date ?? null;
  const daysSinceLast = lastSessionDate
    ? daysBetweenSessionDates(lastSessionDate, getTodaySessionDate())
    : 0;

  recommendedDailyLimit = computeRecommendedTarget({ weightedAccuracy, daysSinceLast });

  // Card-type recommendation (behaviour preserved from prior implementation).
  // Previously used `events.length` as a review-count proxy, which was capped
  // at 100 by the .limit(100) fetch — making the 200-review branch unreachable.
  // Fixed by reading the true count via `{ count: "exact", head: true }` above.
  const totalReviews = totalEventCount ?? 0;
  if (totalReviews < 50) {
    types = { cloze: true, normal: true, audio: false, mcq: true, sentences: false };
  } else if (totalReviews < 200) {
    types = { cloze: true, normal: true, audio: false, mcq: true, sentences: false };
  } else {
    types = { cloze: true, normal: true, audio: false, mcq: true, sentences: true };
  }

  return { recommendedDailyLimit, recommendedTypes: types };
}
