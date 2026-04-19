import type { ListeningIndexAsset } from "@/lib/loop/listening";
import type { UserSettingsRow } from "@/lib/settings/types";
import { CEFR_OPTIONS } from "@/lib/onboarding/cefr";

// ── Types ────────────────────────────────────────────────────

export type ListeningRecommendation = {
  kind: "continue" | "recommended";
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

const CEFR_TO_STAGE_MID: Record<string, number> = {
  A1: 3,
  A2: 8,
  B1: 13,
  B2: 18,
  C1: 23,
  C2: 28,
};

/**
 * Convert a frontier rank to an approximate stage_index (1–30).
 */
export function frontierRankToStageIndex(rank: number): number {
  for (const band of RANK_BANDS) {
    if (rank < band.high) {
      const t = Math.min(1, Math.max(0, (rank - band.low) / (band.high - band.low)));
      return Math.round(band.stageBase + t * 4);
    }
  }
  return 30; // beyond C2
}

/**
 * Get the user's estimated stage_index from the best available signal.
 *
 * Priority:
 * 1. current_frontier_rank (from placement or adaptive recalibration)
 * 2. self_certified_cefr_level → mapped to frontier rank → stage_index
 * 3. fallback: stage 3 (A1 midpoint)
 */
export function getUserStageIndex(settings: UserSettingsRow): number {
  // 1. Frontier rank (most precise — from baseline test or adaptive recalibration)
  if (settings.current_frontier_rank != null && settings.current_frontier_rank > 0) {
    return frontierRankToStageIndex(settings.current_frontier_rank);
  }

  // 2. Self-certified CEFR level
  if (settings.self_certified_cefr_level) {
    const option = CEFR_OPTIONS.find((o) => o.level === settings.self_certified_cefr_level);
    if (option) {
      return frontierRankToStageIndex(option.frontierRank);
    }
  }

  // 3. Fallback: A1 midpoint
  return 3;
}

/**
 * Get a descriptive CEFR label for a stage_index.
 */
export function stageIndexToCefrLabel(stageIndex: number): string {
  if (stageIndex <= 5) return "A1";
  if (stageIndex <= 10) return "A2";
  if (stageIndex <= 15) return "B1";
  if (stageIndex <= 20) return "B2";
  if (stageIndex <= 25) return "C1";
  return "C2";
}

// ── Mode preferences (shorter = easier to start) ────────────

const MODE_DURATION_BONUS: Record<string, number> = {
  short: 3,
  medium: 1,
  long: -1,
  very_long: -3,
};

// ── Scoring ─────────────────────────────────────────────────

export type ScoredAsset = {
  asset: ListeningIndexAsset;
  score: number;
  reason: string;
};

/**
 * Score a single listening asset for recommendation.
 *
 * Pure scoring — does NOT consider exclusion. Callers must filter
 * started/completed assets out before calling this.
 */
export function scoreAsset(
  asset: ListeningIndexAsset,
  userStageIndex: number,
): ScoredAsset {
  const textStageIndex = asset.text?.stageIndex ?? 3;
  const passageMode = asset.text?.passageMode ?? "medium";

  // Level distance: 0 = perfect match, negative = easier, positive = harder
  const levelDelta = textStageIndex - userStageIndex;
  const absDelta = Math.abs(levelDelta);

  // Base score: closeness to level (max 20, decays with distance)
  let score = Math.max(0, 20 - absDelta * 3);

  // Bonus for at-level or slightly below (comprehensible input sweet spot)
  if (levelDelta >= -2 && levelDelta <= 0) {
    score += 5;
  } else if (levelDelta === 1) {
    // One step above is still OK (i+1)
    score += 2;
  }

  // Penalty for too hard (more than 3 stages above)
  if (levelDelta > 3) {
    score -= (levelDelta - 3) * 4;
  }

  // Duration/mode bonus (shorter = easier to start)
  score += MODE_DURATION_BONUS[passageMode] ?? 0;

  // Tiebreaker: prefer lower passage_number (first in progression)
  const passageNumber = asset.text?.passageNumber ?? 1;
  score -= passageNumber * 0.01;

  // Build reason string
  const cefrLabel = stageIndexToCefrLabel(textStageIndex);
  const duration = asset.durationSeconds
    ? asset.durationSeconds < 60
      ? `${Math.round(asset.durationSeconds)}s`
      : `${Math.round(asset.durationSeconds / 60)} min`
    : null;

  const parts = [cefrLabel];
  if (duration) parts.push(duration);
  if (passageMode === "short") parts.push("short passage");
  else if (passageMode === "medium") parts.push("medium passage");

  const reason = parts.join(" · ");

  return { asset, score, reason };
}

/**
 * Pick the single best listening recommendation for a user.
 *
 * Returns null if there are no viable candidates.
 *
 * @param inProgressAsset - The most recently updated in-progress asset (from listening_progress)
 * @param allAssets - All available listening assets
 * @param settings - The user's settings (for level estimation)
 * @param excludedAssetIds - Asset IDs the user has started or completed (from listening_progress).
 *        These are hard-excluded before scoring — they can never appear in Recommended.
 */
export function getListeningRecommendation(
  inProgressAsset: ListeningIndexAsset | null,
  allAssets: ListeningIndexAsset[],
  settings: UserSettingsRow,
  excludedAssetIds: Set<string>,
): ListeningRecommendation | null {
  // Priority 1: Resume in-progress listening
  if (inProgressAsset) {
    return {
      kind: "continue",
      asset: inProgressAsset,
      reason: "Continue where you left off",
    };
  }

  // Priority 2: Recommend a new passage based on level
  // Hard-exclude all assets the user has any progress record for
  const freshAssets = allAssets.filter(
    (a) => a.text != null && !excludedAssetIds.has(a.id),
  );

  if (freshAssets.length === 0) return null;

  const userStage = getUserStageIndex(settings);

  const scored = freshAssets
    .map((a) => scoreAsset(a, userStage))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < -10) return null;

  return {
    kind: "recommended",
    asset: best.asset,
    reason: best.reason,
  };
}
