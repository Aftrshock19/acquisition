import type { ReadingPassageSummary } from "./types";
import type { UserSettingsRow } from "@/lib/settings/types";
import { CEFR_OPTIONS } from "@/lib/onboarding/cefr";

// ── Types ────────────────────────────────────────────────────

export type ReadingRecommendation = {
  passage: ReadingPassageSummary;
  reason: string;
};

// ── Frontier rank → stage_index mapping ─────────────────────
// (Same bands as listening recommendation)

const RANK_BANDS = [
  { low: 0, high: 800, stageBase: 1 },
  { low: 800, high: 1800, stageBase: 6 },
  { low: 1800, high: 3500, stageBase: 11 },
  { low: 3500, high: 7000, stageBase: 16 },
  { low: 7000, high: 12000, stageBase: 21 },
  { low: 12000, high: 34000, stageBase: 26 },
] as const;

export function frontierRankToStageIndex(rank: number): number {
  for (const band of RANK_BANDS) {
    if (rank < band.high) {
      const t = Math.min(1, Math.max(0, (rank - band.low) / (band.high - band.low)));
      return Math.round(band.stageBase + t * 4);
    }
  }
  return 30;
}

export function getUserStageIndex(settings: UserSettingsRow): number {
  if (settings.current_frontier_rank != null && settings.current_frontier_rank > 0) {
    return frontierRankToStageIndex(settings.current_frontier_rank);
  }
  if (settings.self_certified_cefr_level) {
    const option = CEFR_OPTIONS.find((o) => o.level === settings.self_certified_cefr_level);
    if (option) {
      return frontierRankToStageIndex(option.frontierRank);
    }
  }
  return 3;
}

// ── Helpers ─────────────────────────────────────────────────

const MIN_STAGE = 0;
const MAX_STAGE = 29;

const MODE_DURATION_BONUS: Record<string, number> = {
  short: 3,
  medium: 1,
  long: -1,
  very_long: -3,
};

function stageIndexToCefrLabel(stageIndex: number): string {
  if (stageIndex <= 5) return "A1";
  if (stageIndex <= 10) return "A2";
  if (stageIndex <= 15) return "B1";
  if (stageIndex <= 20) return "B2";
  if (stageIndex <= 25) return "C1";
  return "C2";
}

export function buildTryStageOrder(userStage: number): number[] {
  const order: number[] = [
    userStage,
    userStage - 1,
    userStage + 1,
    userStage - 2,
    userStage + 2,
  ];
  for (let s = userStage + 3; s <= MAX_STAGE; s++) {
    order.push(s);
  }
  return order;
}

function withinBucketScore(passage: ReadingPassageSummary): number {
  const modeBonus = MODE_DURATION_BONUS[passage.mode] ?? 0;
  return modeBonus - passage.passageNumber * 0.01;
}

export function buildReason(passage: ReadingPassageSummary): string {
  const parts = [stageIndexToCefrLabel(passage.stageIndex)];
  if (passage.estimatedMinutes) parts.push(`${passage.estimatedMinutes} min`);
  if (passage.mode === "short") parts.push("short passage");
  else if (passage.mode === "medium") parts.push("medium passage");
  return parts.join(" · ");
}

/**
 * Pick the single best fresh reading recommendation for a user.
 *
 * Walks stage buckets outward from the user's stage:
 *   [user, user-1, user+1, user-2, user+2, user+3, user+4, ... up to 29]
 * Returns the first bucket with a non-excluded candidate; within a bucket
 * picks by mode bonus with passage-number tiebreak.
 */
export function getReadingRecommendation(
  allPassages: ReadingPassageSummary[],
  settings: UserSettingsRow,
  excludedTextIds: Set<string>,
): ReadingRecommendation | null {
  const userStage = getUserStageIndex(settings);
  const tryStages = buildTryStageOrder(userStage);

  for (const stage of tryStages) {
    if (stage < MIN_STAGE || stage > MAX_STAGE) continue;

    const candidates = allPassages.filter(
      (p) => p.stageIndex === stage && !excludedTextIds.has(p.id),
    );

    if (candidates.length === 0) continue;

    const best = candidates.reduce((a, b) =>
      withinBucketScore(a) >= withinBucketScore(b) ? a : b,
    );

    return {
      passage: best,
      reason: buildReason(best),
    };
  }

  return null;
}
