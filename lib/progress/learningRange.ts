import type { SupabaseClient } from "@supabase/supabase-js";
import { CEFR_OPTIONS } from "@/lib/onboarding/cefr";
import { getLocalDate } from "@/lib/recommendation/daily";
import {
  MAX_SUBSTAGE,
  rankToSubstageIndex,
  SUBSTAGE_TABLE,
  targetToPassageMode,
  type PassageMode,
} from "@/lib/recommendation/substages";
import { recommendSettings } from "@/lib/settings/recommendSettings";

export type LearningRangeSource =
  | "placement"
  | "self_certified"
  | "beginner_default"
  | "none";

export type LearningRangeViewModel = {
  /** e.g. "B1++" */
  label: string;
  /** First rank in the current substage band (inclusive). */
  rankMin: number;
  /** Last rank in the current substage band (inclusive). */
  rankMax: number;
  /** Resolved frontier rank, or null when no placement signal exists. */
  frontierRank: number | null;
  /** Learner-facing rendering of the frontier rank. */
  frontierDisplay: string;
  /** 0..100, position within the current substage band. */
  progressWithinRangePercent: number;
  /** Words from the current rank to the start of the next band; null at top. */
  wordsUntilNextRange: number | null;
  /** Label of the next substage, e.g. "C1--"; null at top of bank. */
  nextLabel: string | null;
  passageMode: PassageMode;
  /** Today's resolved flashcard target (drives passage mode). */
  targetCards: number;
  source: LearningRangeSource;
  /** Learner-facing label for the source, e.g. "Placement test". */
  sourceLabel: string;
  /** True if the rank came from any signal (placement, self-cert, default). */
  hasPlacement: boolean;
  /** True when the user is at substage 30 (C2++). */
  isTopOfBank: boolean;
  /** Short explanation under the section. */
  helperCopy: string;
};

export type RawRangeInputs = {
  currentFrontierRank: number | null;
  selfCertifiedCefr: "A1" | "A2" | "B1" | "B2" | "C1" | null;
  onboardingEntryMode:
    | "beginner_default"
    | "baseline"
    | "self_certified"
    | null;
  target: number;
};

/**
 * Resolve the active flashcard target from session data.
 *
 * Priority: assigned_flashcard_count > 0  ▸  recommended_target_at_creation > 0
 * ▸  caller-supplied fallback. The fallback is only used when neither of the
 * session signals is positive; pass 0 from the loader to mean "no fallback —
 * I'll call the live recommender."
 */
export function resolveTargetFromSession(
  assigned: number | null,
  snapshot: number | null,
  fallback: number,
): number {
  if (assigned != null && assigned > 0) return assigned;
  if (snapshot != null && snapshot > 0) return snapshot;
  return fallback;
}

function resolveSourceLabel(source: LearningRangeSource): string {
  switch (source) {
    case "placement":
      return "Placement test";
    case "self_certified":
      return "Self-certified";
    case "beginner_default":
      return "Default starting range";
    case "none":
      return "Placement not set";
  }
}

/**
 * Pure derivation: maps raw signals to the view model the section renders.
 *
 * Source priority for the rank:
 *   1. current_frontier_rank > 0 (refined by onboarding_entry_mode for source)
 *   2. self_certified_cefr_level via CEFR_OPTIONS
 *   3. null (no placement signal at all)
 */
export function buildLearningRangeViewModel(
  args: RawRangeInputs,
): LearningRangeViewModel {
  const { currentFrontierRank, selfCertifiedCefr, onboardingEntryMode, target } =
    args;

  let rank: number | null = null;
  let source: LearningRangeSource = "none";

  if (currentFrontierRank != null && currentFrontierRank > 0) {
    rank = currentFrontierRank;
    source =
      onboardingEntryMode === "self_certified"
        ? "self_certified"
        : onboardingEntryMode === "beginner_default"
          ? "beginner_default"
          : onboardingEntryMode === "baseline"
            ? "placement"
            : // Legacy users may have a rank but no mode tag; default to
              // "placement" as the most likely source for an existing rank.
              "placement";
  } else if (selfCertifiedCefr) {
    const opt = CEFR_OPTIONS.find((o) => o.level === selfCertifiedCefr);
    if (opt) {
      rank = opt.frontierRank;
      source = "self_certified";
    }
  }

  const hasPlacement = rank != null;
  const substageIndex = rankToSubstageIndex(rank);
  const substageRow = SUBSTAGE_TABLE[substageIndex - 1];
  const isTopOfBank = substageIndex === MAX_SUBSTAGE;
  const nextRow = isTopOfBank ? null : SUBSTAGE_TABLE[substageIndex];

  const bandSize = substageRow.rankMax - substageRow.rankMin + 1;
  const progressWithinRangePercent = (() => {
    if (rank == null) return 0;
    if (isTopOfBank) return 100;
    const positionInBand = Math.max(
      0,
      Math.min(bandSize, rank - substageRow.rankMin + 1),
    );
    return Math.round((positionInBand / bandSize) * 100);
  })();

  const wordsUntilNextRange =
    nextRow == null || rank == null
      ? null
      : Math.max(0, nextRow.rankMin - rank);

  const frontierDisplay =
    rank == null
      ? "Not set yet"
      : `around the top ${rank.toLocaleString("en-US")} Spanish words`;

  const passageMode = targetToPassageMode(target);
  const sourceLabel = resolveSourceLabel(source);

  let helperCopy: string;
  if (!hasPlacement) {
    helperCopy =
      "Placement not set yet. Take the placement test for a more accurate range.";
  } else if (isTopOfBank) {
    helperCopy =
      "Top of the current word bank. Difficulty stays at C2++; passage length still follows your daily flashcard workload.";
  } else {
    helperCopy =
      "Difficulty follows your vocabulary frontier. Passage length follows today's flashcard workload.";
  }

  return {
    label: substageRow.label,
    rankMin: substageRow.rankMin,
    rankMax: substageRow.rankMax,
    frontierRank: rank,
    frontierDisplay,
    progressWithinRangePercent,
    wordsUntilNextRange,
    nextLabel: nextRow?.label ?? null,
    passageMode,
    targetCards: target,
    source,
    sourceLabel,
    hasPlacement,
    isTopOfBank,
    helperCopy,
  };
}

/**
 * Server-side loader for the /progress "Current learning range" section.
 *
 * Two queries (sequential — daily_sessions needs the user's timezone), plus
 * an optional fallback to the live recommender when neither the active session
 * row nor its frozen snapshot supplies a positive target.
 */
export async function loadCurrentLearningRange(
  supabase: SupabaseClient,
  userId: string,
): Promise<LearningRangeViewModel> {
  const { data: settingsData } = await supabase
    .from("user_settings")
    .select(
      "current_frontier_rank, self_certified_cefr_level, placement_status, timezone, onboarding_entry_mode",
    )
    .eq("user_id", userId)
    .maybeSingle();

  const settings = settingsData as {
    current_frontier_rank: number | null;
    self_certified_cefr_level: "A1" | "A2" | "B1" | "B2" | "C1" | null;
    placement_status: string | null;
    timezone: string | null;
    onboarding_entry_mode:
      | "beginner_default"
      | "baseline"
      | "self_certified"
      | null;
  } | null;

  const today = getLocalDate(settings?.timezone ?? "UTC");

  const { data: sessionData } = await supabase
    .from("daily_sessions")
    .select("assigned_flashcard_count, recommended_target_at_creation")
    .eq("user_id", userId)
    .eq("session_date", today)
    .maybeSingle();

  const session = sessionData as {
    assigned_flashcard_count: number | null;
    recommended_target_at_creation: number | null;
  } | null;

  // Pass 0 as the fallback sentinel; if the result is still 0 we drop to the
  // live recommender. This keeps the helper pure (no async fallback inside).
  let target = resolveTargetFromSession(
    session?.assigned_flashcard_count ?? null,
    session?.recommended_target_at_creation ?? null,
    0,
  );
  if (target <= 0) {
    const rec = await recommendSettings();
    target = rec.recommendedDailyLimit;
  }

  return buildLearningRangeViewModel({
    currentFrontierRank: settings?.current_frontier_rank ?? null,
    selfCertifiedCefr: settings?.self_certified_cefr_level ?? null,
    onboardingEntryMode: settings?.onboarding_entry_mode ?? null,
    target,
  });
}
