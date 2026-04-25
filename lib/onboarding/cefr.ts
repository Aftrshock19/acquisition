/**
 * CEFR levels offered in the self-certification picker.
 *
 * These map to an approximate Spanish word-frequency rank that the existing
 * adaptive system already uses (`current_frontier_rank` on user_settings,
 * scale 1..~34000). The rank is only a *starting point* — the recalibration
 * layer will continue to move it up or down as the user practises, so
 * self-certification is not a permanent lock.
 */

export const CEFR_LEVELS = ["A0", "A1", "A2", "B1", "B2", "C1"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/**
 * Subset of CEFR_LEVELS that maps to a real self-certified frontier rank
 * stored in user_settings.self_certified_cefr_level. A0 is excluded — A0
 * users route to completeOnboardingAsBeginner instead, which leaves the
 * column null.
 */
export const SELF_CERT_CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type SelfCertCefrLevel = (typeof SELF_CERT_CEFR_LEVELS)[number];

export type CefrOption = {
  level: CefrLevel;
  label: string;
  /** Short, action-oriented primary line shown on the picker. */
  canDo: string;
  /**
   * Longer behavioural descriptor shown as a secondary line on the picker.
   * Paraphrased from the Council of Europe CEFR self-assessment grid
   * (Council of Europe 2001; CEFR Companion Volume 2020), prioritising
   * listening and reading descriptors since (a) this app trains receptive
   * vocabulary via reading and listening, and (b) self-rating is more
   * accurate for receptive than productive skills (Ross 1998 meta-analysis;
   * LittleNorth 2019).
   */
  canDoExpanded: string;
  /** Approximate target word-frequency rank used as the initial frontier. */
  frontierRank: number;
  /**
   * Lower bound for the new-word picker's selection window. Written to
   * user_settings.current_frontier_rank_low at onboarding, then read by
   * pickNewWordsNearFrontier (lib/placement/newWordPicker.ts) — the
   * picker computes its query lower bound as
   *   max(1, round(frontierRankLow * 0.85)).
   *
   * Set to the floor of the substage one below the "--" substage of this
   * level's band (0 for A1/beginner). This anchors the picker's window
   * within the band while leaving a small conservative tail below for
   * back-fill as upper-rank words get learned.
   */
  frontierRankLow: number;
  /**
   * Upper bound conceptually associated with this level's band — set to
   * the ceiling of the "++" substage. NOT currently consumed by routing
   * or the new-word picker (which hardcodes its upper window to
   * frontierRank + 300). Retained as documentation of the band's
   * intended ceiling and for possible future consumers.
   */
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
    level: "A0",
    label: "Just starting",
    canDo: "I'm completely new to Spanish",
    canDoExpanded: "I have little or no experience with Spanish.",
    frontierRank: 0,
    frontierRankLow: 0,
    frontierRankHigh: 0,
  },
  {
    level: "A1",
    label: "Beginner",
    canDo:
      "I know everyday phrases like greetings, numbers, and basic questions",
    canDoExpanded:
      "I can recognise familiar words and very basic phrases about myself, my family, and concrete surroundings when people speak slowly and clearly. I can read very short, simple texts and find specific information in everyday material like menus or timetables.",
    frontierRank: 500,
    frontierRankLow: 0,
    frontierRankHigh: 1500,
  },
  {
    level: "A2",
    label: "Elementary",
    canDo: "I can understand simple everyday sentences",
    canDoExpanded:
      "I can understand frequently used expressions related to areas of immediate relevance (shopping, family, local geography, employment). I can read short, simple texts on familiar matters and understand short, simple personal letters.",
    frontierRank: 1501,
    frontierRankLow: 1051,
    frontierRankHigh: 4300,
  },
  {
    level: "B1",
    label: "Intermediate",
    canDo:
      "I can follow everyday conversations when people speak clearly",
    canDoExpanded:
      "I can understand the main points of clear standard speech on familiar matters regularly encountered in work, school, and leisure. I can read straightforward factual texts on subjects related to my interests with a satisfactory level of comprehension.",
    frontierRank: 4301,
    frontierRankLow: 3621,
    frontierRankHigh: 9200,
  },
  {
    level: "B2",
    label: "Upper intermediate",
    canDo: "I can understand most Spanish content with some gaps",
    canDoExpanded:
      "I can understand extended speech and lectures and follow complex lines of argument provided the topic is reasonably familiar. I can read articles and reports concerned with contemporary problems, and understand contemporary literary prose.",
    frontierRank: 9201,
    frontierRankLow: 8001,
    frontierRankHigh: 17000,
  },
  {
    level: "C1",
    label: "Advanced",
    canDo:
      "I'm comfortable with complex Spanish and rarely get lost",
    canDoExpanded:
      "I can understand extended speech even when it is not clearly structured and when relationships are only implied. I can understand long and complex factual and literary texts, appreciating distinctions of style.",
    frontierRank: 17001,
    frontierRankLow: 15251,
    frontierRankHigh: 27500,
  },
] as const;

/**
 * Ranks for the beginner-default path (user said they are new to Spanish).
 * frontierRank=0 represents true zero knowledge — the user enters at the
 * very floor of substage 1 (A1--, 0-150). The recalibration layer
 * (lib/placement/recalibrate.ts) lifts this as recall evidence accumulates.
 *
 * Note: the new-word picker is gated by `frontierRank > 200` in
 * app/actions/srs.ts, so for the default beginner (frontierRank=0) the
 * picker is skipped entirely and the default RPC serves rank-1-ASC. The
 * `frontierRankLow`/`frontierRankHigh` values below are therefore not
 * consumed for beginner users today, but are kept consistent with the
 * A1 entry for predictability if the gate ever changes.
 */
export const BEGINNER_DEFAULT_FRONTIER = {
  frontierRank: 0,
  frontierRankLow: 0,
  frontierRankHigh: 1500,
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

export function isSelfCertCefrLevel(
  value: unknown,
): value is SelfCertCefrLevel {
  return (
    typeof value === "string" &&
    (SELF_CERT_CEFR_LEVELS as readonly string[]).includes(value)
  );
}
