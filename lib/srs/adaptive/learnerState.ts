/**
 * Learner-state model.
 *
 * Computes a smoothed `learner_state_score` in roughly [-1, +1] from
 * recent persisted data, then maps it to an interval `learner_factor`
 * conservatively clamped to [LEARNER_FACTOR_MIN, LEARNER_FACTOR_MAX].
 *
 * Inputs are intentionally robust:
 *   • flashcard first-pass accuracy   (strongest, weight 0.40)
 *   • retry burden (1 - main accuracy of retries)  (weight 0.20, negative)
 *   • reading-question accuracy        (weight 0.20)
 *   • session completion rate          (weight 0.10)
 *   • backlog pressure (overdue/expected) (weight 0.05, negative)
 *   • median correct response-time z-ish refinement (weight 0.05)
 *
 * Sparse data falls back to neutral (0.0 → factor 1.0). The model never
 * lets a single anomalous session dominate because we cap each session's
 * contribution and use medians for latency.
 */

export const LEARNER_FACTOR_MIN = 0.90;
export const LEARNER_FACTOR_MAX = 1.10;
export const LEARNER_FACTOR_NEUTRAL = 1.0;

/** Number of recent completed sessions to consider. */
export const RECENT_SESSIONS_WINDOW = 3;
/** Calendar fallback window. */
export const RECENT_DAYS_FALLBACK = 7;

/** Latency cap to prevent outliers dominating. */
export const LATENCY_OUTLIER_MAX_MS = 60_000;
export const LATENCY_REFERENCE_MS = 18_000;

export type SessionSignal = {
  /** main-queue first-try correct / main-queue attempts */
  firstPassAccuracy: number | null;
  /** retry attempts / main attempts (>= 0) */
  retryBurden: number | null;
  /** reading question accuracy 0..1 */
  readingQuestionAccuracy: number | null;
  /** completion rate 0..1 */
  completionRate: number | null;
  /** median ms_spent on correct first-pass attempts */
  medianResponseMs: number | null;
};

export type LearnerStateInput = {
  recentSessions: SessionSignal[];
  /** items currently overdue */
  overdueCount: number;
  /** average daily new+review introduction recently */
  expectedDailyLoad: number;
};

export type LearnerStateResult = {
  learnerStateScore: number;
  learnerFactor: number;
  components: {
    accuracy: number | null;
    retryBurden: number | null;
    readingQuestionAccuracy: number | null;
    completionRate: number | null;
    backlogPressure: number;
    latencyRefinement: number;
  };
  sampleSize: number;
};

/** Median of finite numbers, or null. */
export function median(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (finite.length === 0) return null;
  return finite.reduce((acc, v) => acc + v, 0) / finite.length;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Pure learner-state computation. Returns neutral when there is no
 * recent data at all.
 */
export function computeLearnerState(input: LearnerStateInput): LearnerStateResult {
  const sessions = input.recentSessions ?? [];
  const sampleSize = sessions.length;

  const accuracy = average(sessions.map((s) => s.firstPassAccuracy));
  const retryBurden = average(sessions.map((s) => s.retryBurden));
  const readingQuestionAccuracy = average(
    sessions.map((s) => s.readingQuestionAccuracy),
  );
  const completionRate = average(sessions.map((s) => s.completionRate));

  const expectedLoad = Math.max(1, input.expectedDailyLoad);
  const backlogRatio = Math.max(0, input.overdueCount) / expectedLoad;
  // Backlog pressure: negative contribution, capped at -1
  const backlogPressure = -Math.min(1, backlogRatio / 3);

  // Latency refinement: faster than reference → small positive,
  // much slower → small negative. Capped to [-0.2, +0.2].
  const latencies = sessions
    .map((s) => s.medianResponseMs)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .map((v) => Math.min(LATENCY_OUTLIER_MAX_MS, Math.max(0, v)));
  const medianLatency = median(latencies);
  let latencyRefinement = 0;
  if (medianLatency != null && medianLatency > 0) {
    const ratio = LATENCY_REFERENCE_MS / medianLatency; // >1 = fast, <1 = slow
    latencyRefinement = clamp(0.5 * (ratio - 1), -0.2, 0.2);
  }

  // Center every signal around 0 in the same units (each in roughly [-1,+1])
  const accuracyCentered = accuracy == null ? 0 : 2 * accuracy - 1;
  const retryCentered = retryBurden == null ? 0 : -clamp(retryBurden, 0, 1);
  const readingCentered =
    readingQuestionAccuracy == null ? 0 : 2 * readingQuestionAccuracy - 1;
  const completionCentered = completionRate == null ? 0 : 2 * completionRate - 1;

  const score =
    0.40 * accuracyCentered +
    0.20 * retryCentered +
    0.20 * readingCentered +
    0.10 * completionCentered +
    0.05 * backlogPressure +
    0.05 * latencyRefinement;

  // Map score to factor with a 0.10 swing per unit score
  const factorRaw = LEARNER_FACTOR_NEUTRAL + 0.10 * clamp(score, -1, 1);
  const learnerFactor =
    sampleSize === 0
      ? LEARNER_FACTOR_NEUTRAL
      : clamp(factorRaw, LEARNER_FACTOR_MIN, LEARNER_FACTOR_MAX);

  return {
    learnerStateScore: clamp(score, -1, 1),
    learnerFactor,
    components: {
      accuracy,
      retryBurden,
      readingQuestionAccuracy,
      completionRate,
      backlogPressure,
      latencyRefinement,
    },
    sampleSize,
  };
}
