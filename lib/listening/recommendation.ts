import type { ListeningIndexAsset } from "@/lib/loop/listening";
import type { UserSettingsRow } from "@/lib/settings/types";
import { CEFR_OPTIONS } from "@/lib/onboarding/cefr";

// ── Types ────────────────────────────────────────────────────

export type ListeningRecommendation = {
  asset: ListeningIndexAsset;
  reason: string;
};

// ── Frontier rank → stage_index mapping ─────────────────────
//
// stage_index 1..5 = A1 (frontier ~1..800)
// stage_index 6..10 = A2 (frontier ~800..1800)
// stage_index 11..15 = B1 (frontier ~1800..3500)
// stage_index 16..20 = B2 (frontier ~3500..7000)
// stage_index 21..25 = C1 (frontier ~7000..12000)
// stage_index 26..30 = C2 (frontier ~12000+)

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

export function stageIndexToCefrLabel(stageIndex: number): string {
  if (stageIndex <= 5) return "A1";
  if (stageIndex <= 10) return "A2";
  if (stageIndex <= 15) return "B1";
  if (stageIndex <= 20) return "B2";
  if (stageIndex <= 25) return "C1";
  return "C2";
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

function withinBucketScore(asset: ListeningIndexAsset): number {
  const mode = asset.text?.passageMode ?? "medium";
  const passageNumber = asset.text?.passageNumber ?? 1;
  const modeBonus = MODE_DURATION_BONUS[mode] ?? 0;
  return modeBonus - passageNumber * 0.01;
}

export function buildReason(asset: ListeningIndexAsset): string {
  const stageIndex = asset.text?.stageIndex ?? 3;
  const passageMode = asset.text?.passageMode ?? "medium";
  const duration = asset.durationSeconds
    ? asset.durationSeconds < 60
      ? `${Math.round(asset.durationSeconds)}s`
      : `${Math.round(asset.durationSeconds / 60)} min`
    : null;

  const parts = [stageIndexToCefrLabel(stageIndex)];
  if (duration) parts.push(duration);
  if (passageMode === "short") parts.push("short passage");
  else if (passageMode === "medium") parts.push("medium passage");

  return parts.join(" · ");
}

/**
 * Pick the single best fresh listening recommendation for a user.
 *
 * Walks stage buckets outward from the user's stage:
 *   [user, user-1, user+1, user-2, user+2, user+3, user+4, ... up to 29]
 * Returns the first bucket with a non-excluded candidate; within a bucket
 * picks by mode bonus with passage-number tiebreak.
 */
export function getListeningRecommendation(
  allAssets: ListeningIndexAsset[],
  settings: UserSettingsRow,
  excludedAssetIds: Set<string>,
): ListeningRecommendation | null {
  const userStage = getUserStageIndex(settings);
  const tryStages = buildTryStageOrder(userStage);

  for (const stage of tryStages) {
    if (stage < MIN_STAGE || stage > MAX_STAGE) continue;

    const candidates = allAssets.filter(
      (a) =>
        a.text != null &&
        a.text.stageIndex === stage &&
        !excludedAssetIds.has(a.id),
    );

    if (candidates.length === 0) continue;

    const best = candidates.reduce((a, b) =>
      withinBucketScore(a) >= withinBucketScore(b) ? a : b,
    );

    return {
      asset: best,
      reason: buildReason(best),
    };
  }

  return null;
}
