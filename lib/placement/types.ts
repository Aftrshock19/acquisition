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

import type { CognateClass } from "./cognate";
import type { MorphologyClass } from "./morphology";

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
  cognateClass: CognateClass;
  morphologyClass: MorphologyClass;
  isInflectedForm: boolean;
  lemmaRank: number;
  effectiveDiagnosticRank: number;
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
  // Adaptive v3 fairness fields. Populated by submitPlacementAnswer; absent
  // values (legacy rows) default to non_cognate / base / 1.0.
  floorIndex: number | null;
  floorSequence: number | null;
  cognateClass: CognateClass;
  morphologyClass: MorphologyClass;
  isInflectedForm: boolean;
  lemmaRank: number | null;
  effectiveDiagnosticRank: number | null;
  lexicalWeight: number;
  morphologyWeight: number;
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
  | "top_of_bank_reached"
  | "floor_failed_at_bottom"
  | "floor_unresolved";

export type FloorOutcome =
  | "in_progress"
  | "cleared"
  | "tentative_cleared"
  | "unresolved"
  | "failed";

export type FrontierEvidenceQuality = "low" | "medium" | "high";

export type FloorState = {
  checkpointIndex: number;
  floorSequence: number;
  itemsServed: number;
  correct: number;
  /** Sum of lexical_weight * morphology_weight for all served items. */
  weightedTotal: number;
  /** Sum of lexical_weight * morphology_weight for correct items. */
  weightedCorrect: number;
  nonCognateServed: number;
  nonCognateCorrect: number;
  markedFormsServed: number;
  markedFormsCorrect: number;
  outcome: FloorOutcome;
};

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
  /** Current floor sequence number (0-indexed). */
  currentFloorSequence: number | null;
  /** Items served within the current floor so far. */
  currentFloorItemsServed: number;
  /** Snapshot of all floors visited in this run, in order. */
  floors: readonly FloorState[];
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
  // Adaptive v3 fairness metadata.
  highestClearedFloorIndex: number | null;
  highestTentativeFloorIndex: number | null;
  totalFloorsVisited: number;
  floorOutcomes: readonly FloorState[];
  frontierEvidenceQuality: FrontierEvidenceQuality;
  nonCognateSupportPresent: boolean;
  cognateHeavyEstimate: boolean;
  morphologyHeavyEstimate: boolean;
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
  /**
   * Items served per floor. Floor outcomes resolve after this many items
   * unless early termination fires (≥3 wrong ⇒ failed, ≥4 correct with
   * non-cognate support ⇒ cleared).
   */
  itemsPerFloor: number;
  /** Correct-count threshold at or above which a non-top floor is cleared. */
  clearThreshold: number;
  /** Correct-count threshold below which a floor is tentative. */
  tentativeThreshold: number;
  /**
   * Top floor requires both a full sweep (clearThresholdTop) *and* at least
   * this many non-cognate correct answers to be strongly cleared.
   */
  clearThresholdTop: number;
  topFloorMinNonCognateCorrect: number;
};

export const DEFAULT_PLACEMENT_CONFIG: PlacementAlgorithmConfig = {
  minItems: 10,
  maxItems: 26,
  consecutiveWrongStop: 5,
  precisionBracketWidth: 1,
  recallItemCount: 2,
  itemsPerFloor: 5,
  clearThreshold: 4,
  tentativeThreshold: 3,
  clearThresholdTop: 5,
  topFloorMinNonCognateCorrect: 2,
};

export const PLACEMENT_ALGORITHM_VERSION = "v3-floors";
