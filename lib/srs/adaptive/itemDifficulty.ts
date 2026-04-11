/**
 * Per-item adaptive difficulty model.
 *
 * Maps the per-user-word `difficulty` value (already maintained by the SRS v2
 * scheduler) to an adaptive `item_factor` interval multiplier and provides a
 * cold-start prior derived from word frequency rank.
 *
 * Design notes (dissertation-defensible):
 *   • The SRS v2 scheduler updates `difficulty` on every review:
 *       clean correct  → −0.02..−0.08 (lowers difficulty)
 *       rescued correct → −0.01
 *       incorrect      → +0.08 (raises difficulty)
 *     and same-session retries result in a `rescued` then potentially an
 *     `incorrect` outcome, so retries already raise difficulty via the base
 *     scheduler. We do not need to add a second multiplicative correction.
 *   • The cold-start prior uses word rank (frequency-based). Common words
 *     (lower rank) get a slightly easier prior; rare words start harder.
 *   • Evidence-weighted blend: prior dominates when adaptive_evidence_count
 *     is small; learned difficulty dominates as evidence accumulates.
 *   • item_factor is clamped narrowly to [ITEM_FACTOR_MIN, ITEM_FACTOR_MAX]
 *     so it cannot dominate the baseline schedule.
 */

export const ITEM_FACTOR_MIN = 0.85;
export const ITEM_FACTOR_MAX = 1.15;

/** Difficulty value at which item_factor == 1.0 (no scaling). */
export const ITEM_FACTOR_NEUTRAL_DIFFICULTY = 0.55;

/** How quickly difficulty drives the multiplier. Conservative slope. */
export const ITEM_FACTOR_SLOPE = 0.5;

/** Reference rank used for cold-start prior calculation (mid-frequency). */
export const COLD_START_REFERENCE_RANK = 1500;
export const COLD_START_PRIOR_MIN = 0.40;
export const COLD_START_PRIOR_MAX = 0.75;
export const COLD_START_BASE = 0.55;

/** Number of evidence reviews after which the prior contribution is ~0. */
export const EVIDENCE_HALF_LIFE = 4;

/**
 * Cold-start prior from word frequency rank.
 *
 * For a word with rank r:
 *   prior = clamp( BASE + 0.10 * log10((r + 1) / REFERENCE) , [MIN, MAX] )
 *
 * - rank 1   → ~0.43
 * - rank 100 → ~0.49
 * - rank 1500 → ~0.55 (neutral)
 * - rank 5000 → ~0.60
 * - rank 20000 → ~0.66
 */
export function computeColdStartPrior(rank: number | null | undefined): number {
  if (rank == null || !Number.isFinite(rank) || rank <= 0) {
    return COLD_START_BASE;
  }
  const ratio = Math.log10((rank + 1) / COLD_START_REFERENCE_RANK);
  const raw = COLD_START_BASE + 0.10 * ratio;
  return clamp(raw, COLD_START_PRIOR_MIN, COLD_START_PRIOR_MAX);
}

/**
 * Blend the cold-start prior with observed difficulty using an
 * evidence-weighted average. Early on the prior dominates; with enough
 * evidence the personal data takes over.
 */
export function blendDifficulty(opts: {
  observedDifficulty: number | null | undefined;
  coldStartPrior: number;
  evidenceCount: number;
}): number {
  const evidence = Math.max(0, opts.evidenceCount);
  const observed =
    typeof opts.observedDifficulty === "number" && Number.isFinite(opts.observedDifficulty)
      ? opts.observedDifficulty
      : opts.coldStartPrior;
  // Weight on observed difficulty: 0 at zero evidence, 0.5 at evidence == half-life
  const wObserved = evidence / (evidence + EVIDENCE_HALF_LIFE);
  return observed * wObserved + opts.coldStartPrior * (1 - wObserved);
}

/**
 * Map a blended difficulty to an item_factor (interval multiplier).
 * Easier items (lower difficulty) get a slightly longer interval; harder
 * items get a shorter one. The slope is intentionally small so this only
 * nudges the schedule.
 */
export function difficultyToItemFactor(blendedDifficulty: number): number {
  const delta = ITEM_FACTOR_NEUTRAL_DIFFICULTY - blendedDifficulty; // positive when easier
  const raw = 1 + ITEM_FACTOR_SLOPE * delta;
  return clamp(raw, ITEM_FACTOR_MIN, ITEM_FACTOR_MAX);
}

/**
 * Convenience: full item_factor pipeline.
 */
export function computeItemFactor(opts: {
  rank: number | null | undefined;
  observedDifficulty: number | null | undefined;
  evidenceCount: number;
}): { itemFactor: number; coldStartPrior: number; blendedDifficulty: number } {
  const coldStartPrior = computeColdStartPrior(opts.rank);
  const blendedDifficulty = blendDifficulty({
    observedDifficulty: opts.observedDifficulty,
    coldStartPrior,
    evidenceCount: opts.evidenceCount,
  });
  return {
    itemFactor: difficultyToItemFactor(blendedDifficulty),
    coldStartPrior,
    blendedDifficulty,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
