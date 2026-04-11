export type PlacementItemType = "recognition" | "recall";

export type PlacementRunStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "abandoned"
  | "skipped";

export type PlacementSource =
  | "baseline_only"
  | "baseline_plus_usage"
  | "usage_only";

export type PlacementStatus =
  | "unknown"
  | "estimated"
  | "calibrating"
  | "stable";

export type PlacementItem = {
  id: string;
  language: string;
  wordId: string | null;
  lemma: string;
  frequencyRank: number;
  pos: string | null;
  itemType: PlacementItemType;
  promptSentence: string | null;
  promptStem: string;
  correctAnswer: string;
  acceptedAnswers: string[] | null;
  options: string[] | null;
  bandStart: number;
  bandEnd: number;
};

export type PlacementResponseRecord = {
  itemBankId: string | null;
  wordId: string | null;
  sequenceIndex: number;
  itemType: PlacementItemType;
  bandStart: number;
  bandEnd: number;
  promptStem: string;
  promptSentence: string | null;
  options: string[] | null;
  chosenOptionIndex: number | null;
  chosenText: string | null;
  normalizedResponse: string | null;
  isCorrect: boolean;
  usedIdk: boolean;
  latencyMs: number | null;
  scoreWeight: number;
  metadata: Record<string, unknown>;
};

export type BandStat = {
  bandIndex: number;
  bandStart: number;
  bandEnd: number;
  answered: number;
  correct: number;
  idk: number;
  smoothedAccuracy: number;
};

export type PlacementEstimate = {
  frontierRank: number;
  frontierRankLow: number;
  frontierRankHigh: number;
  estimatedReceptiveVocab: number;
  confidence: number;
  rawRecognitionAccuracy: number;
  rawRecallAccuracy: number;
  bands: BandStat[];
};

export type PlacementStageName = "coarse" | "refine" | "done";

export type PlacementStopReason =
  | "in_progress"
  | "precision_reached"
  | "consecutive_wrong_ceiling"
  | "max_items"
  | "top_of_bank_reached";

export type PlacementEstimateStatus = "early" | "provisional" | "medium" | "high";

export type PlacementPlan = {
  stage: PlacementStageName;
  nextCheckpointIndex: number | null;
  nextItemType: PlacementItemType | null;
  bracketLowIndex: number | null;
  bracketHighIndex: number | null;
  itemsAnswered: number;
  remainingBudget: number;
  reason: string;
  shouldStop: boolean;
  stopReason: PlacementStopReason;
};

export type AdaptivePlacementEstimate = {
  confirmedFloorRank: number;
  estimatedFrontierRank: number;
  frontierRankLow: number;
  frontierRankHigh: number;
  estimateStatus: PlacementEstimateStatus;
  topOfBankReached: boolean;
  bracketLowIndex: number | null;
  bracketHighIndex: number | null;
  consecutiveWrong: number;
  maxConsecutiveWrong: number;
  itemsAnswered: number;
  rawAccuracy: number;
  estimatedReceptiveVocab: number;
};

export type PlacementAlgorithmConfig = {
  /** Don't stop before this many items, even if precision is reached. */
  minItems: number;
  /** Hard cap on items administered. */
  maxItems: number;
  /** After minItems, this many wrong-in-a-row triggers consecutive_wrong stop. */
  consecutiveWrongStop: number;
  /** Bracket index width at or below which precision_reached can fire. */
  precisionBracketWidth: number;
  /** Recall items reserved near the frontier (subset of maxItems). */
  recallItemCount: number;
  /** Initial coarse jump magnitude in checkpoint indices. */
  coarseJump: number;
};

export const DEFAULT_PLACEMENT_CONFIG: PlacementAlgorithmConfig = {
  minItems: 8,
  maxItems: 24,
  consecutiveWrongStop: 5,
  precisionBracketWidth: 1,
  recallItemCount: 2,
  coarseJump: 2,
};

export const PLACEMENT_ALGORITHM_VERSION = "v2-adaptive";
