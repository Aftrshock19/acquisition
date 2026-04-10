export const NORMAL_REVIEW_BUDGET_MS   = 360_000; // 6 min
export const COMEBACK_REVIEW_BUDGET_MS = 480_000; // 8 min
export const P50_FALLBACK_MS           = 18_000;  // 18 s — used when no history
export const CONTINUATION_REVIEW_CHUNK = 12;
export const CONTINUATION_NEW_CHUNK    = 5;
export const COMEBACK_DAYS_THRESHOLD   = 7;

export interface WorkloadPolicy {
  isComeback: boolean;
  recommendedReviews: number;
  recommendedNewWords: number;
  continuationReviewChunk: number;
  continuationNewChunk: number;
  p50ReviewMs: number;
}

export function computeWorkloadPolicy(opts: {
  p50ReviewMs: number | null;
  daysSinceLastSession: number | null;
  overdueCount: number;
  scheduledNewCount: number;
}): WorkloadPolicy {
  const p50 = opts.p50ReviewMs ?? P50_FALLBACK_MS;
  const normalBatch   = clamp(Math.floor(NORMAL_REVIEW_BUDGET_MS   / p50), 12, 30);
  const comebackBatch = clamp(Math.floor(COMEBACK_REVIEW_BUDGET_MS / p50), 18, 40);

  const isComeback =
    (opts.daysSinceLastSession ?? 0) >= COMEBACK_DAYS_THRESHOLD ||
    opts.overdueCount >= 3 * normalBatch;

  const recommendedReviews  = isComeback ? comebackBatch : normalBatch;
  const recommendedNewWords = isComeback
    ? Math.min(opts.scheduledNewCount, 3)
    : opts.scheduledNewCount;

  return {
    isComeback,
    recommendedReviews,
    recommendedNewWords,
    continuationReviewChunk: CONTINUATION_REVIEW_CHUNK,
    continuationNewChunk: CONTINUATION_NEW_CHUNK,
    p50ReviewMs: p50,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
