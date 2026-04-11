/**
 * Dynamic daily workload controller.
 *
 * Computes a `workload_factor` ∈ [WORKLOAD_FACTOR_MIN, WORKLOAD_FACTOR_MAX]
 * that scales the base daily new-word budget. Conservative by design:
 * struggling learners and large backlogs reduce or hold the budget;
 * strong learners can only modestly increase it; poor completion blocks
 * any increase.
 */

export const WORKLOAD_FACTOR_MIN = 0.70;
export const WORKLOAD_FACTOR_MAX = 1.30;
export const WORKLOAD_FACTOR_NEUTRAL = 1.0;

export type WorkloadInput = {
  /** Output of computeLearnerState (centered around 0). */
  learnerStateScore: number;
  /** Sample size of learner-state evidence (0 → neutral fallback). */
  sampleSize: number;
  /** Recent session completion rate, 0..1. */
  completionRate: number | null;
  /** Recent retry burden ratio (>= 0). */
  retryBurden: number | null;
  /** Currently overdue items count. */
  overdueCount: number;
  /** Expected per-day load (used to normalize backlog). */
  expectedDailyLoad: number;
};

export type WorkloadAdjustment = {
  workloadFactor: number;
  adaptiveNewWordCap: (baseLimit: number) => number;
  reasons: string[];
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function computeWorkloadFactor(input: WorkloadInput): WorkloadAdjustment {
  const reasons: string[] = [];

  if (input.sampleSize === 0) {
    return {
      workloadFactor: WORKLOAD_FACTOR_NEUTRAL,
      adaptiveNewWordCap: (b) => Math.max(0, Math.round(b)),
      reasons: ["sparse-data → neutral"],
    };
  }

  // Start from learner-state score (already in [-1, +1])
  let factor = WORKLOAD_FACTOR_NEUTRAL + 0.20 * clamp(input.learnerStateScore, -1, 1);
  reasons.push(`base from learner_state=${input.learnerStateScore.toFixed(2)}`);

  // Backlog pressure: 1 day of expected load == 1 unit
  const expectedLoad = Math.max(1, input.expectedDailyLoad);
  const backlogDays = Math.max(0, input.overdueCount) / expectedLoad;
  if (backlogDays >= 3) {
    factor = Math.min(factor, WORKLOAD_FACTOR_NEUTRAL - 0.20);
    reasons.push(`backlog=${backlogDays.toFixed(1)}d → reduce`);
  } else if (backlogDays >= 1.5) {
    factor = Math.min(factor, WORKLOAD_FACTOR_NEUTRAL);
    reasons.push(`backlog=${backlogDays.toFixed(1)}d → hold`);
  }

  // Poor completion rate blocks increases above 1.0 entirely.
  if (input.completionRate != null && input.completionRate < 0.7) {
    factor = Math.min(factor, WORKLOAD_FACTOR_NEUTRAL);
    reasons.push(
      `completion=${(input.completionRate * 100).toFixed(0)}% < 70% → no increase`,
    );
  }

  // High retry burden blocks increases too.
  if (input.retryBurden != null && input.retryBurden > 0.4) {
    factor = Math.min(factor, WORKLOAD_FACTOR_NEUTRAL);
    reasons.push(`retry burden=${input.retryBurden.toFixed(2)} → no increase`);
  }

  factor = clamp(factor, WORKLOAD_FACTOR_MIN, WORKLOAD_FACTOR_MAX);

  return {
    workloadFactor: factor,
    adaptiveNewWordCap: (baseLimit: number) =>
      Math.max(0, Math.round(baseLimit * factor)),
    reasons,
  };
}
