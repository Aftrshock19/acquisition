import type { Grade } from "./types";
import {
  MIN_HALF_LIFE_HOURS,
  MAX_HALF_LIFE_HOURS,
  TARGET_P_MIN,
  TARGET_P_MAX,
  BASE_ETA,
  ETA_K,
  ETA_MIN,
  ETA_MAX,
  EWMA_ALPHA,
  GRADE_FACTOR,
} from "./constants";

/**
 * Predicted recall probability after delta_hours since last review.
 * p = 2^(-delta_hours / half_life_hours)
 */
export function recallProbability(
  deltaHours: number,
  halfLifeHours: number,
): number {
  if (halfLifeHours <= 0) return 0;
  const p = Math.pow(2, -deltaHours / halfLifeHours);
  return Math.min(1, Math.max(0, p));
}

/**
 * Next interval in hours to reach target recall probability.
 * interval = half_life_hours * log2(1 / target_p)
 */
export function nextIntervalHours(
  halfLifeHours: number,
  targetP: number,
): number {
  const p = Math.max(TARGET_P_MIN, Math.min(TARGET_P_MAX, targetP));
  return halfLifeHours * Math.log2(1 / p);
}

/**
 * EWMA update: prev * (1 - alpha) + value * alpha
 */
export function updateEwma(prev: number, value: number, alpha: number): number {
  return prev * (1 - alpha) + value * alpha;
}

export type UpdateHalfLifeParams = {
  halfLifeHours: number;
  deltaHours: number;
  correct: boolean;
  grade: Grade;
  ewmaSurprise: number;
  ewmaAbsSurprise: number;
  ewmaAccuracy: number;
  baseEta?: number;
  k?: number;
  etaMin?: number;
  etaMax?: number;
  minHl?: number;
  maxHl?: number;
  alpha?: number;
};

export type UpdateHalfLifeResult = {
  halfLifeAfter: number;
  pPred: number;
  eta: number;
  surprise: number;
  ewmaSurpriseNext: number;
  ewmaAbsSurpriseNext: number;
  ewmaAccuracyNext: number;
};

/**
 * Compute next half-life and related values after a review.
 * half_life_after = clamp(half_life * exp(eta * (r - p) * grade_factor), min_hl, max_hl)
 */
export function updateHalfLife(params: UpdateHalfLifeParams): UpdateHalfLifeResult {
  const {
    halfLifeHours,
    deltaHours,
    correct,
    grade,
    ewmaSurprise,
    ewmaAbsSurprise,
    ewmaAccuracy,
    baseEta = BASE_ETA,
    k = ETA_K,
    etaMin = ETA_MIN,
    etaMax = ETA_MAX,
    minHl = MIN_HALF_LIFE_HOURS,
    maxHl = MAX_HALF_LIFE_HOURS,
    alpha = EWMA_ALPHA,
  } = params;

  const pPred = recallProbability(deltaHours, halfLifeHours);
  const r = correct ? 1 : 0;
  const surprise = r - pPred;
  const gradeFactor = GRADE_FACTOR[grade];

  const ewmaSurpriseNext = updateEwma(ewmaSurprise, surprise, alpha);
  const ewmaAbsSurpriseNext = updateEwma(ewmaAbsSurprise, Math.abs(surprise), alpha);
  const ewmaAccuracyNext = updateEwma(ewmaAccuracy, r, alpha);

  let eta = baseEta + k * ewmaAbsSurpriseNext;
  eta = Math.max(etaMin, Math.min(etaMax, eta));

  let halfLifeAfter = halfLifeHours * Math.exp(eta * surprise * gradeFactor);
  halfLifeAfter = Math.max(minHl, Math.min(maxHl, halfLifeAfter));

  return {
    halfLifeAfter,
    pPred,
    eta,
    surprise,
    ewmaSurpriseNext,
    ewmaAbsSurpriseNext,
    ewmaAccuracyNext,
  };
}

/**
 * Lightweight half-life update for an exposure (r=1, surprise weighted).
 * Does not change reps/lapses. Used for comprehensible input nudges.
 */
export function exposureUpdateHalfLife(
  halfLifeHours: number,
  deltaHours: number,
  targetP: number,
  weight: number,
  ewmaAbsSurprise: number,
  params?: {
    baseEta?: number;
    k?: number;
    etaMin?: number;
    etaMax?: number;
    minHl?: number;
    maxHl?: number;
  },
): number {
  const {
    baseEta = BASE_ETA,
    k = ETA_K,
    etaMin = ETA_MIN,
    etaMax = ETA_MAX,
    minHl = MIN_HALF_LIFE_HOURS,
    maxHl = MAX_HALF_LIFE_HOURS,
  } = params ?? {};

  const pPred = recallProbability(deltaHours, halfLifeHours);
  const r = 1;
  const surpriseWeighted = (r - pPred) * weight;

  let eta = baseEta + k * ewmaAbsSurprise;
  eta = Math.max(etaMin, Math.min(etaMax, eta));

  const halfLifeAfter = halfLifeHours * Math.exp(eta * surpriseWeighted);
  return Math.max(minHl, Math.min(maxHl, halfLifeAfter));
}
