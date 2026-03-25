import type { Grade, ReviewState } from "./types";
import {
  DEFAULT_EASE_FACTOR,
  MIN_EASE_FACTOR,
  MIN_INTERVAL_DAYS,
  MAX_INTERVAL_DAYS,
  INITIAL_INTERVAL_DAYS,
  AGAIN_INTERVAL_DAYS,
  HARD_MODIFIER,
  GOOD_MODIFIER,
  EASY_MODIFIER,
  EASE_DELTA_AGAIN,
  EASE_DELTA_HARD,
  EASE_DELTA_GOOD,
  EASE_DELTA_EASY,
} from "./constants";

const GRADE_TO_QUALITY: Record<Grade, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

function clampEase(e: number): number {
  return Math.max(MIN_EASE_FACTOR, Math.min(3, e));
}

function clampInterval(days: number): number {
  return Math.max(MIN_INTERVAL_DAYS, Math.min(MAX_INTERVAL_DAYS, days));
}

/**
 * Returns the next review state after grading. For first exposure, pass null for current.
 */
export function nextReviewState(
  grade: Grade,
  current: ReviewState | null,
): ReviewState {
  const now = new Date();
  const quality = GRADE_TO_QUALITY[grade];

  const prevInterval = current?.interval_days ?? 0;
  const prevEase = current?.ease_factor ?? DEFAULT_EASE_FACTOR;
  const prevReps = current?.repetitions ?? 0;

  let nextInterval: number;
  let nextEase: number;
  let nextReps: number;

  if (quality === 1) {
    // Again: reset / short interval
    nextInterval = AGAIN_INTERVAL_DAYS;
    nextEase = clampEase(prevEase + EASE_DELTA_AGAIN);
    nextReps = 0;
  } else {
    // Hard / Good / Easy
    const modifier =
      quality === 2 ? HARD_MODIFIER : quality === 3 ? GOOD_MODIFIER : EASY_MODIFIER;
    const easeDelta =
      quality === 2 ? EASE_DELTA_HARD : quality === 3 ? EASE_DELTA_GOOD : EASE_DELTA_EASY;

    nextEase = clampEase(prevEase + easeDelta);

    if (prevReps === 0) {
      nextInterval = INITIAL_INTERVAL_DAYS * modifier;
    } else {
      nextInterval = prevInterval * nextEase * modifier;
    }
    nextInterval = clampInterval(nextInterval);
    nextReps = prevReps + 1;
  }

  const nextDue = new Date(now.getTime() + nextInterval * 24 * 60 * 60 * 1000);

  return {
    next_review: nextDue.toISOString(),
    interval_days: nextInterval,
    ease_factor: nextEase,
    repetitions: nextReps,
  };
}
