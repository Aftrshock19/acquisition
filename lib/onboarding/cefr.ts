/**
 * CEFR levels offered in the self-certification picker.
 *
 * These map to an approximate Spanish word-frequency rank that the existing
 * adaptive system already uses (`current_frontier_rank` on user_settings,
 * scale 1..~34000). The rank is only a *starting point* — the recalibration
 * layer will continue to move it up or down as the user practises, so
 * self-certification is not a permanent lock.
 */

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export type CefrOption = {
  level: CefrLevel;
  label: string;
  canDo: string;
  /** Approximate target word-frequency rank used as the initial frontier. */
  frontierRank: number;
  /**
   * Legacy field. Not consumed by any routing logic; retained for back-compat
   * with earlier placement bracket UI. Inconsistent with frontierRank under
   * the floor-based calibration documented on CEFR_OPTIONS below.
   */
  frontierRankLow: number;
  /** Legacy field; see frontierRankLow. */
  frontierRankHigh: number;
};

/**
 * Self-certified CEFR levels offered in onboarding's "Choose my own level"
 * picker.
 *
 * Each level's `frontierRank` is set to the FLOOR of that letter's lowest
 * substage (the "--" variant) under the 30-row SUBSTAGE_TABLE in
 * lib/recommendation/substages.ts:
 *
 *   A1 → stage 3  (A1, 351-650)        → 500   (no "--" variant; midpoint)
 *   A2 → stage 6  (A2--, 1501-1900)    → 1501
 *   B1 → stage 11 (B1--, 4301-5050)    → 4301
 *   B2 → stage 16 (B2--, 9201-10500)   → 9201
 *   C1 → stage 21 (C1--, 17001-18900)  → 17001
 *
 * Why the floor and not the midpoint? Self-assessment of L2 ability is
 * systematically optimistic — learners overestimate their level, especially
 * around band thresholds. Starting at the floor of the chosen letter gives
 * the recommender the gentlest content within the user's stated range; if
 * their actual ability is higher, the post-loop recalibration in
 * lib/placement/recalibrate.ts moves the rank upward as evidence
 * accumulates. Erring "too easy" recovers via easy reads and recalibration;
 * erring "too hard" risks early disengagement.
 *
 * References:
 *   - Ross, S. (1998). "Self-assessment in second language testing: a
 *     meta-analysis and analysis of experiential factors." Language Testing
 *     15(1), 1-20.
 *   - Edele, A., Seuring, J., Kristen, C., & Stanat, P. (2015). "Why bother
 *     with testing? The validity of immigrants' self-assessed language
 *     proficiency." Social Science Research 52, 99-123.
 */
export const CEFR_OPTIONS: readonly CefrOption[] = [
  {
    level: "A1",
    label: "Beginner",
    canDo: "I only know a few words or phrases",
    frontierRank: 500,
    frontierRankLow: 1,
    frontierRankHigh: 800,
  },
  {
    level: "A2",
    label: "Elementary",
    canDo:
      "I understand very simple Spanish and familiar everyday expressions",
    frontierRank: 1501,
    frontierRankLow: 800,
    frontierRankHigh: 1800,
  },
  {
    level: "B1",
    label: "Intermediate",
    canDo: "I can follow clear everyday Spanish but still miss a lot",
    frontierRank: 4301,
    frontierRankLow: 1800,
    frontierRankHigh: 3500,
  },
  {
    level: "B2",
    label: "Upper intermediate",
    canDo:
      "I can handle most normal content and conversations with some gaps",
    frontierRank: 9201,
    frontierRankLow: 3500,
    frontierRankHigh: 7000,
  },
  {
    level: "C1",
    label: "Advanced",
    canDo: "I understand most content comfortably, though not perfectly",
    frontierRank: 17001,
    frontierRankLow: 7000,
    frontierRankHigh: 12000,
  },
] as const;

/**
 * Ranks for the beginner-default path (user said they are new to Spanish).
 * frontierRank=0 represents true zero knowledge — the user enters at the
 * very floor of substage 1 (A1--, 0-150). The recalibration layer
 * (lib/placement/recalibrate.ts) lifts this as recall evidence accumulates.
 *
 * frontierRankLow / frontierRankHigh are legacy fields (see CefrOption type
 * doc) — not consumed by routing logic.
 */
export const BEGINNER_DEFAULT_FRONTIER = {
  frontierRank: 0,
  frontierRankLow: 1,
  frontierRankHigh: 600,
} as const;

export function cefrOption(level: CefrLevel): CefrOption {
  const match = CEFR_OPTIONS.find((o) => o.level === level);
  if (!match) {
    throw new Error(`Unknown CEFR level: ${level}`);
  }
  return match;
}

export function isCefrLevel(value: unknown): value is CefrLevel {
  return (
    typeof value === "string" &&
    (CEFR_LEVELS as readonly string[]).includes(value)
  );
}
