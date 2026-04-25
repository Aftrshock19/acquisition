import type { ReadingPassageSummary } from "./types";
import type { UserSettingsRow } from "@/lib/settings/types";
import { CEFR_OPTIONS } from "@/lib/onboarding/cefr";
import {
  pickFromBucketAndMode,
  type PassageMode,
} from "@/lib/recommendation/substages";

// ── Types ────────────────────────────────────────────────────

export type ReadingRecommendation = {
  passage: ReadingPassageSummary;
  reason: string;
};

// ── Frontier rank → stage_index mapping (LEGACY, 6-band linear) ────
//
// Retained for the accordion's defaultOpenBand and any other consumer that
// expects the 1-30 stage_index space derived from the prior CEFR-band mapping.
// The new picker (pickFromBucketAndMode) uses rankToSubstageIndex from
// lib/recommendation/substages.ts instead — that function reads the
// SUBSTAGE_TABLE rank ranges, which differ from the bands below.

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
 * Driven by two signals — vocabulary frontier rank and today's flashcard
 * target. See lib/recommendation/substages.ts for the rank→substage table,
 * the target→mode table, and the 4-phase fallback ladder.
 */
export function getReadingRecommendation(
  allPassages: readonly ReadingPassageSummary[],
  rank: number | null | undefined,
  target: number | null | undefined,
  excludedTextIds: ReadonlySet<string>,
): ReadingRecommendation | null {
  type Wrapped = {
    id: string;
    stageIndex: number | null | undefined;
    passageMode: PassageMode | string | null | undefined;
    passageNumber: number | null | undefined;
    original: ReadingPassageSummary;
  };
  const candidates: Wrapped[] = allPassages.map((p) => ({
    id: p.id,
    stageIndex: p.stageIndex,
    passageMode: p.mode,
    passageNumber: p.passageNumber,
    original: p,
  }));

  const picked = pickFromBucketAndMode<Wrapped>({
    rank,
    target,
    candidates,
    excludedIds: excludedTextIds,
  });
  if (!picked) return null;

  return {
    passage: picked.original,
    reason: buildReason(picked.original),
  };
}
