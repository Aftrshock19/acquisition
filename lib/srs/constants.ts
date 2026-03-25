export const MAX_DUE_REVIEWS = 50;
export const MAX_NEW_WORDS = 10;

// Non-stationary half-life SRS (match Postgres RPC constants)
export const MIN_HALF_LIFE_HOURS = 0.25;
export const MAX_HALF_LIFE_HOURS = 24 * 365 * 2; // 17520
export const TARGET_P_DEFAULT = 0.85;
export const TARGET_P_MIN = 0.75;
export const TARGET_P_MAX = 0.95;
export const INITIAL_HALF_LIFE_HOURS = 8;
export const BASE_ETA = 0.4;
export const ETA_K = 0.2;
export const ETA_MIN = 0.1;
export const ETA_MAX = 1.0;
export const EWMA_ALPHA = 0.3;
export const RELEARN_MINUTES = 10;
export const EXPOSURE_WEIGHT_DEFAULT = 0.1;
export const EXPOSURE_WEIGHT_MIN = 0.05;
export const EXPOSURE_WEIGHT_MAX = 0.25;

export const GRADE_FACTOR: Record<"again" | "hard" | "good" | "easy", number> = {
  again: 0.6,
  hard: 0.85,
  good: 1.0,
  easy: 1.15,
};

// SM-2 (legacy / reference only)
export const INITIAL_INTERVAL_DAYS = 1;
export const MIN_INTERVAL_DAYS = 0.04;
export const MAX_INTERVAL_DAYS = 365;
export const DEFAULT_EASE_FACTOR = 2.5;
export const MIN_EASE_FACTOR = 1.3;
export const AGAIN_INTERVAL_DAYS = 0.04;
export const HARD_MODIFIER = 0.8;
export const GOOD_MODIFIER = 1;
export const EASY_MODIFIER = 1.3;
export const EASE_DELTA_AGAIN = -0.2;
export const EASE_DELTA_HARD = -0.15;
export const EASE_DELTA_GOOD = 0;
export const EASE_DELTA_EASY = 0.15;
