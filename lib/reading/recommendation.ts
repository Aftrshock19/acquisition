import type { ReadingPassageSummary } from "./types";
import type { UserSettingsRow } from "@/lib/settings/types";
import { CEFR_OPTIONS } from "@/lib/onboarding/cefr";

// ── Types ────────────────────────────────────────────────────

export type ReadingRecommendation = {
  kind: "continue" | "recommended";
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

function stageIndexToCefrLabel(stageIndex: number): string {
  if (stageIndex <= 5) return "A1";
  if (stageIndex <= 10) return "A2";
  if (stageIndex <= 15) return "B1";
  if (stageIndex <= 20) return "B2";
  if (stageIndex <= 25) return "C1";
  return "C2";
}

const MODE_DURATION_BONUS: Record<string, number> = {
  short: 3,
  medium: 1,
  long: -1,
  very_long: -3,
};

// ── Scoring ─────────────────────────────────────────────────

export type ScoredPassage = {
  passage: ReadingPassageSummary;
  score: number;
  reason: string;
};

/**
 * Score a reading passage for recommendation.
 *
 * Pure scoring — does NOT consider exclusion. Callers must filter
 * started/completed passages out before calling this.
 */
export function scorePassage(
  passage: ReadingPassageSummary,
  userStageIndex: number,
): ScoredPassage {
  const levelDelta = passage.stageIndex - userStageIndex;
  const absDelta = Math.abs(levelDelta);

  let score = Math.max(0, 20 - absDelta * 3);

  // Bonus for at-level or slightly below (comprehensible input sweet spot)
  if (levelDelta >= -2 && levelDelta <= 0) {
    score += 5;
  } else if (levelDelta === 1) {
    score += 2;
  }

  // Penalty for too hard
  if (levelDelta > 3) {
    score -= (levelDelta - 3) * 4;
  }

  // Mode bonus
  score += MODE_DURATION_BONUS[passage.mode] ?? 0;

  // Tiebreaker: prefer lower passage_number
  score -= passage.passageNumber * 0.01;

  // Build reason
  const cefrLabel = stageIndexToCefrLabel(passage.stageIndex);
  const parts = [cefrLabel];
  if (passage.estimatedMinutes) parts.push(`${passage.estimatedMinutes} min`);
  if (passage.mode === "short") parts.push("short passage");
  else if (passage.mode === "medium") parts.push("medium passage");

  return { passage, score, reason: parts.join(" · ") };
}

/**
 * Pick the single best reading recommendation for a user.
 *
 * @param inProgressPassage - The most recently updated in-progress passage (from reading_progress)
 * @param allPassages - All available reading passages
 * @param settings - User settings for level estimation
 * @param excludedTextIds - Text IDs the user has started or completed (from reading_progress).
 *        These are hard-excluded before scoring — they can never appear in Recommended.
 */
export function getReadingRecommendation(
  inProgressPassage: ReadingPassageSummary | null,
  allPassages: ReadingPassageSummary[],
  settings: UserSettingsRow,
  excludedTextIds: Set<string>,
): ReadingRecommendation | null {
  // Priority 1: Resume in-progress reading
  if (inProgressPassage) {
    return {
      kind: "continue",
      passage: inProgressPassage,
      reason: "Continue where you left off",
    };
  }

  // Priority 2: Recommend a new passage based on level
  // Hard-exclude all passages the user has any progress record for
  const freshPassages = allPassages.filter((p) => !excludedTextIds.has(p.id));

  if (freshPassages.length === 0) return null;

  const userStage = getUserStageIndex(settings);

  const scored = freshPassages
    .map((p) => scorePassage(p, userStage))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return null;

  return {
    kind: "recommended",
    passage: best.passage,
    reason: best.reason,
  };
}
