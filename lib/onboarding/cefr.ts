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
  /** Lower bound for the adaptive bracket. */
  frontierRankLow: number;
  /** Upper bound for the adaptive bracket. */
  frontierRankHigh: number;
};

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
    frontierRank: 1200,
    frontierRankLow: 800,
    frontierRankHigh: 1800,
  },
  {
    level: "B1",
    label: "Intermediate",
    canDo: "I can follow clear everyday Spanish but still miss a lot",
    frontierRank: 2500,
    frontierRankLow: 1800,
    frontierRankHigh: 3500,
  },
  {
    level: "B2",
    label: "Upper intermediate",
    canDo:
      "I can handle most normal content and conversations with some gaps",
    frontierRank: 5000,
    frontierRankLow: 3500,
    frontierRankHigh: 7000,
  },
  {
    level: "C1",
    label: "Advanced",
    canDo: "I understand most content comfortably, though not perfectly",
    frontierRank: 9000,
    frontierRankLow: 7000,
    frontierRankHigh: 12000,
  },
] as const;

/**
 * Ranks for the beginner-default path (user said they are new to Spanish).
 * Deliberately lower than A1 self-certification so the adaptive system
 * starts from the very top of the frequency list.
 */
export const BEGINNER_DEFAULT_FRONTIER = {
  frontierRank: 300,
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
