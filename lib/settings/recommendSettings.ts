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
// CEILING is the hard clamp. The accuracy curve saturates well below it:
// at the maximum reachable accuracy of 1.0 with ACCURACY_REFERENCE=0.85
// and K_UP=2, targetFromAccuracy ≈ 74. Higher recommendations require
// the demonstrated-capacity signal, not accuracy alone. CEILING is a
// defensive upper bound, not a value reachable from the accuracy curve.
export const CEILING = 200;
export const ACCURACY_REFERENCE = 0.85;
/**
 * Bayesian shrinkage strength: number of pseudo-events at the prior
 * (ACCURACY_REFERENCE) blended with the measured weighted accuracy.
 * Larger k pulls low-evidence users harder toward the prior. At k=20 a
 * user with ~20 weighted events is roughly half measurement, half prior.
 */
export const ACCURACY_PRIOR_WEIGHT = 20;
/**
 * Saturation rate of the upward (above-reference) accuracy curve.
 *
 * K_UP < K_DOWN is intentional: high accuracy alone should not produce
 * large target increases. Demonstrated capacity (a separate signal,
 * planned for the next iteration) is the path to higher recommendations.
 * The asymmetry encodes "we recalibrate quickly when you're struggling,
 * we don't push you upward without evidence you can sustain it."
 */
export const K_UP = 2;
export const K_DOWN = 6;
export const INACTIVITY_MAX_DAYS = 21;
export const INACTIVITY_MAX_PENALTY = 0.67;

/**
 * Demonstrated-capacity pull-up signal: a closed-loop feedback that lets a
 * user's recent practice volume act as a soft floor on the recommendation.
 *
 * Lookback: the most recent N completed sessions (where the user actually
 * practiced cards), inside the trailing M-day window. Excludes today, so
 * today's in-progress practice doesn't feed today's target.
 *
 * Gate: requires both enough sessions in the window AND a competence
 * threshold on smoothed accuracy. The gate is intentionally lower than
 * ACCURACY_REFERENCE so a user near the reference still benefits.
 *
 * Floor: 80% of average completed volume. Applied AFTER the inactivity-
 * decayed baseRec; pulls the rec up but never down.
 */
export const CAPACITY_LOOKBACK_SESSIONS = 7;
export const CAPACITY_LOOKBACK_DAYS = 30;
export const CAPACITY_MIN_SESSIONS = 3;
export const CAPACITY_ACCURACY_GATE = 0.80;
export const CAPACITY_FLOOR_MULTIPLIER = 0.8;

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

type CapacitySessionRow = {
  flashcard_completed_count: number;
  session_date: string;
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
 * Card-type-weighted accuracy with Bayesian shrinkage toward the prior.
 * Returns null when there are no events (caller falls back to the
 * reference value via the null-handling in `computeRecommendedTarget`).
 *
 *   smoothed = (n * measured + k * prior) / (n + k)
 *
 * where:
 *   n = Σ w_i (total weighted evidence over the rolling window)
 *   k = ACCURACY_PRIOR_WEIGHT
 *   prior = ACCURACY_REFERENCE
 *
 * Low-evidence users (small n) get pulled strongly toward the prior so
 * a short streak of correct or wrong answers does not slam the target
 * to the rails. High-evidence users (n >> k) are barely affected.
 */
export function computeSmoothedAccuracy(
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
  return (num + ACCURACY_PRIOR_WEIGHT * ACCURACY_REFERENCE) /
    (den + ACCURACY_PRIOR_WEIGHT);
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

/**
 * Subtract `days` days from a YYYY-MM-DD session-date string using the
 * same UTC-anchored arithmetic style as daysBetweenSessionDates.
 *
 * Returns the input unchanged if it can't be parsed (defensive: a bad
 * floor would degenerate the capacity query into "no rows," which is a
 * safe fallback — predicate fails, baseRec wins).
 */
export function computeCapacityWindowFloor(
  todaySessionDate: string,
  days: number,
): string {
  const todayMs = Date.parse(`${todaySessionDate}T00:00:00Z`);
  if (!Number.isFinite(todayMs)) return todaySessionDate;
  const floorMs = todayMs - days * 86400000;
  return new Date(floorMs).toISOString().slice(0, 10);
}

/**
 * Apply the demonstrated-capacity floor to a base recommendation.
 *
 * Predicate (all clauses required):
 *   - capacitySessions.length >= CAPACITY_MIN_SESSIONS
 *   - smoothedAccuracy is non-null
 *   - smoothedAccuracy >= CAPACITY_ACCURACY_GATE
 *
 * When the predicate passes:
 *   avgCapacity = mean(flashcard_completed_count across sessions)
 *   capacityFloor = avgCapacity * CAPACITY_FLOOR_MULTIPLIER
 *   final = max(baseRec, capacityFloor)
 *
 * Otherwise final = baseRec.
 *
 * Returns the final value rounded and clamped to [FLOOR, CEILING].
 * Manual-mode sessions count equally with recommended-mode sessions —
 * capacity is capacity regardless of how the target was set.
 */
export function applyDemonstratedCapacityFloor(args: {
  baseRec: number;
  smoothedAccuracy: number | null;
  capacitySessions: readonly CapacitySessionRow[];
}): number {
  const { baseRec, smoothedAccuracy, capacitySessions } = args;

  const passesGate =
    capacitySessions.length >= CAPACITY_MIN_SESSIONS &&
    smoothedAccuracy !== null &&
    smoothedAccuracy >= CAPACITY_ACCURACY_GATE;

  let final = baseRec;
  if (passesGate) {
    const sum = capacitySessions.reduce(
      (acc, row) => acc + row.flashcard_completed_count,
      0,
    );
    const avgCapacity = sum / capacitySessions.length;
    const capacityFloor = avgCapacity * CAPACITY_FLOOR_MULTIPLIER;
    final = Math.max(baseRec, capacityFloor);
  }

  return Math.round(Math.max(FLOOR, Math.min(CEILING, final)));
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

  const today = getTodaySessionDate();

  const [
    { data: recentEvents, error: eventsError },
    { count: totalEventCount },
    { data: lastSession },
    { data: capacityRows },
  ] = await Promise.all([
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
    supabase
      .from("daily_sessions")
      .select("flashcard_completed_count, session_date")
      .eq("user_id", user.id)
      .gte("session_date", computeCapacityWindowFloor(today, CAPACITY_LOOKBACK_DAYS))
      .lt("session_date", today)
      .gt("flashcard_completed_count", 0)
      .order("session_date", { ascending: false })
      .limit(CAPACITY_LOOKBACK_SESSIONS),
  ]);

  if (eventsError) {
    console.warn("[recommendSettings] review_events query failed", eventsError);
  }

  const events = (recentEvents ?? []) as ReviewEventForAccuracy[];
  const weightedAccuracy = computeSmoothedAccuracy(events);

  const lastSessionDate = (lastSession as { session_date: string } | null)?.session_date ?? null;
  const daysSinceLast = lastSessionDate
    ? daysBetweenSessionDates(lastSessionDate, today)
    : 0;

  const baseRec = computeRecommendedTarget({ weightedAccuracy, daysSinceLast });
  const capacitySessions = (capacityRows ?? []) as CapacitySessionRow[];
  recommendedDailyLimit = applyDemonstratedCapacityFloor({
    baseRec,
    smoothedAccuracy: weightedAccuracy,
    capacitySessions,
  });

  // Card-type recommendation. Single boundary at 200 lifetime reviews:
  // introduce sentence cards once the user has enough recall practice to
  // handle in-context production. Earlier implementations used `events.length`
  // as a proxy, which was capped at 100 by the .limit(100) fetch — making the
  // 200-review branch unreachable. Reading the true count via
  // `{ count: "exact", head: true }` above fixes that.
  const totalReviews = totalEventCount ?? 0;
  if (totalReviews < 200) {
    types = { cloze: true, normal: true, audio: false, mcq: true, sentences: false };
  } else {
    types = { cloze: true, normal: true, audio: false, mcq: true, sentences: true };
  }

  return { recommendedDailyLimit, recommendedTypes: types };
}
