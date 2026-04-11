/**
 * Adaptive placement engine.
 *
 * Two phases:
 *   1. **Coarse routing.** Hop between log-spaced checkpoints by ±coarseJump
 *      indices based on whether the previous answer was correct, until both
 *      a confirmed comfortable checkpoint (`floorIdx`) and a struggling
 *      checkpoint (`ceilingIdx`) bracket the learner's frontier.
 *   2. **Local refinement.** Once the bracket is narrow, ask a couple more
 *      items inside it (one of which can be recall) to confirm.
 *
 * Stops on whichever fires first after min items: precision_reached,
 * consecutive_wrong_ceiling, top_of_bank_reached, or max_items.
 *
 * Pure functions only — no DB access. Caller wires this into a server action.
 */

import {
  CHECKPOINTS,
  DEFAULT_START_INDEX,
  MAX_CHECKPOINT_RANK,
  TOP_CHECKPOINT_INDEX,
  checkpointByIndex,
  nearestCheckpointIndex,
} from "./checkpoints";
import {
  DEFAULT_PLACEMENT_CONFIG,
  type AdaptivePlacementEstimate,
  type PlacementAlgorithmConfig,
  type PlacementEstimateStatus,
  type PlacementItemType,
  type PlacementPlan,
  type PlacementResponseRecord,
  type PlacementStopReason,
} from "./types";

// ── Derived state from response history ────────────────────

type CheckpointStat = {
  index: number;
  answered: number;
  correct: number;
};

function checkpointStats(
  responses: readonly PlacementResponseRecord[],
): Map<number, CheckpointStat> {
  const m = new Map<number, CheckpointStat>();
  for (const r of responses) {
    const center = Math.round((r.bandStart + r.bandEnd) / 2);
    const idx = nearestCheckpointIndex(center);
    const cur = m.get(idx) ?? { index: idx, answered: 0, correct: 0 };
    cur.answered += 1;
    if (r.isCorrect) cur.correct += 1;
    m.set(idx, cur);
  }
  return m;
}

type Bracket = {
  /** Highest checkpoint index where the learner has shown comfort. -1 if none. */
  floorIdx: number;
  /** Lowest checkpoint index where the learner has clearly failed. TOP+1 if none. */
  ceilingIdx: number;
};

const NO_BRACKET: Bracket = { floorIdx: -1, ceilingIdx: TOP_CHECKPOINT_INDEX + 1 };

function deriveBracket(stats: Map<number, CheckpointStat>): Bracket {
  let floorIdx = -1;
  let ceilingIdx = TOP_CHECKPOINT_INDEX + 1;

  // Sort checkpoint indices ascending so we walk from easy → hard.
  const indices = [...stats.keys()].sort((a, b) => a - b);
  for (const idx of indices) {
    const s = stats.get(idx)!;
    const accuracy = s.correct / s.answered;
    // Comfortable: every answer at this checkpoint is correct.
    // (Single-item checkpoints are common in coarse phase.)
    if (s.correct === s.answered && idx > floorIdx) {
      floorIdx = idx;
    }
    // Struggling: at least one wrong AND accuracy ≤ 0.5.
    if (s.answered - s.correct >= 1 && accuracy <= 0.5 && idx < ceilingIdx) {
      ceilingIdx = idx;
    }
  }

  // Bracket sanity: if floor crossed ceiling (oscillation), pin floor below ceiling.
  if (floorIdx >= ceilingIdx) {
    floorIdx = ceilingIdx - 1;
  }

  return { floorIdx, ceilingIdx };
}

function trailingConsecutiveWrong(
  responses: readonly PlacementResponseRecord[],
): number {
  let n = 0;
  for (let i = responses.length - 1; i >= 0; i -= 1) {
    if (responses[i].isCorrect) break;
    n += 1;
  }
  return n;
}

function maxConsecutiveWrong(
  responses: readonly PlacementResponseRecord[],
): number {
  let max = 0;
  let cur = 0;
  for (const r of responses) {
    if (r.isCorrect) {
      cur = 0;
    } else {
      cur += 1;
      if (cur > max) max = cur;
    }
  }
  return max;
}

// ── planNextItem ───────────────────────────────────────────

export type PlanContext = {
  /** Optional prior checkpoint index from a previous run or settings hint. */
  priorCheckpointIndex?: number | null;
};

export function planNextItem(
  responses: readonly PlacementResponseRecord[],
  config: PlacementAlgorithmConfig = DEFAULT_PLACEMENT_CONFIG,
  context: PlanContext = {},
): PlacementPlan {
  const itemsAnswered = responses.length;
  const stats = checkpointStats(responses);
  const bracket = itemsAnswered === 0 ? NO_BRACKET : deriveBracket(stats);
  const consecWrong = trailingConsecutiveWrong(responses);
  const recallAnswered = responses.filter((r) => r.itemType === "recall").length;

  const remainingBudget = Math.max(0, config.maxItems - itemsAnswered);

  // ── Stopping rules ──────────────────────────────────────
  const stopDecision = decideStop({
    itemsAnswered,
    bracket,
    consecWrong,
    config,
  });

  if (stopDecision.shouldStop) {
    return {
      stage: "done",
      nextCheckpointIndex: null,
      nextItemType: null,
      bracketLowIndex: bracket.floorIdx >= 0 ? bracket.floorIdx : null,
      bracketHighIndex:
        bracket.ceilingIdx <= TOP_CHECKPOINT_INDEX ? bracket.ceilingIdx : null,
      itemsAnswered,
      remainingBudget,
      reason: stopDecision.reason,
      shouldStop: true,
      stopReason: stopDecision.stopReason,
    };
  }

  // ── Pick next checkpoint ────────────────────────────────
  const nextIdx = pickNextCheckpoint({
    itemsAnswered,
    bracket,
    stats,
    config,
    priorIdx: context.priorCheckpointIndex ?? null,
  });

  // ── Stage label and item type ───────────────────────────
  const bracketGap =
    bracket.floorIdx >= 0 && bracket.ceilingIdx <= TOP_CHECKPOINT_INDEX
      ? bracket.ceilingIdx - bracket.floorIdx - 1
      : null;
  const inRefinement = bracketGap !== null && bracketGap <= 2;
  const stage = inRefinement ? "refine" : "coarse";

  // Reserve a couple of recall items for the refinement phase, only after
  // the bracket has tightened, so the harder modality probes the *frontier*
  // rather than waste questions during routing.
  const itemType: PlacementItemType =
    inRefinement && recallAnswered < config.recallItemCount && itemsAnswered >= config.minItems - 2
      ? "recall"
      : "recognition";

  return {
    stage,
    nextCheckpointIndex: nextIdx,
    nextItemType: itemType,
    bracketLowIndex: bracket.floorIdx >= 0 ? bracket.floorIdx : null,
    bracketHighIndex:
      bracket.ceilingIdx <= TOP_CHECKPOINT_INDEX ? bracket.ceilingIdx : null,
    itemsAnswered,
    remainingBudget,
    reason:
      itemsAnswered === 0
        ? `cold start at checkpoint ${nextIdx} (rank ${CHECKPOINTS[nextIdx].center})`
        : inRefinement
          ? `refining bracket [${bracket.floorIdx},${bracket.ceilingIdx}] → ${nextIdx}`
          : `coarse routing → ${nextIdx} (floor=${bracket.floorIdx}, ceil=${bracket.ceilingIdx})`,
    shouldStop: false,
    stopReason: "in_progress",
  };
}

// ── Stop decision ──────────────────────────────────────────

function decideStop(args: {
  itemsAnswered: number;
  bracket: Bracket;
  consecWrong: number;
  config: PlacementAlgorithmConfig;
}): { shouldStop: boolean; stopReason: PlacementStopReason; reason: string } {
  const { itemsAnswered, bracket, consecWrong, config } = args;

  if (itemsAnswered >= config.maxItems) {
    return {
      shouldStop: true,
      stopReason: "max_items",
      reason: `reached maxItems=${config.maxItems}`,
    };
  }

  // Below the minimum, we never stop. This guarantees we administer enough
  // items to support the precision/ceiling rules below.
  if (itemsAnswered < config.minItems) {
    return { shouldStop: false, stopReason: "in_progress", reason: "below minItems" };
  }

  // Ceiling rule: 5 consecutive wrong after the warm-up.
  if (consecWrong >= config.consecutiveWrongStop) {
    return {
      shouldStop: true,
      stopReason: "consecutive_wrong_ceiling",
      reason: `${consecWrong} consecutive wrong after minItems`,
    };
  }

  // Top-of-bank: cleared the highest checkpoint and never failed → no
  // ceiling exists. Reporting "exact rank" here is forbidden by the spec.
  if (
    bracket.floorIdx === TOP_CHECKPOINT_INDEX &&
    bracket.ceilingIdx > TOP_CHECKPOINT_INDEX
  ) {
    return {
      shouldStop: true,
      stopReason: "top_of_bank_reached",
      reason: "cleared top checkpoint with no failures",
    };
  }

  // Precision: floor and ceiling exist and the gap between them is tight.
  if (
    bracket.floorIdx >= 0 &&
    bracket.ceilingIdx <= TOP_CHECKPOINT_INDEX &&
    bracket.ceilingIdx - bracket.floorIdx - 1 <= config.precisionBracketWidth
  ) {
    return {
      shouldStop: true,
      stopReason: "precision_reached",
      reason: `bracket [${bracket.floorIdx},${bracket.ceilingIdx}] tight enough`,
    };
  }

  return { shouldStop: false, stopReason: "in_progress", reason: "continuing" };
}

// ── Next-checkpoint selection ──────────────────────────────

function pickNextCheckpoint(args: {
  itemsAnswered: number;
  bracket: Bracket;
  stats: Map<number, CheckpointStat>;
  config: PlacementAlgorithmConfig;
  priorIdx: number | null;
}): number {
  const { itemsAnswered, bracket, stats, config, priorIdx } = args;

  if (itemsAnswered === 0) {
    const start = priorIdx ?? DEFAULT_START_INDEX;
    return clampIndex(start);
  }

  const hasFloor = bracket.floorIdx >= 0;
  const hasCeiling = bracket.ceilingIdx <= TOP_CHECKPOINT_INDEX;

  let next: number;
  if (!hasFloor && !hasCeiling) {
    // Should not happen after item 1, but be safe.
    next = priorIdx ?? DEFAULT_START_INDEX;
  } else if (hasFloor && hasCeiling) {
    // Bracket exists → midpoint between floor+1 and ceiling-1.
    const mid = Math.floor((bracket.floorIdx + bracket.ceilingIdx) / 2);
    next = mid <= bracket.floorIdx ? bracket.floorIdx + 1 : mid;
  } else if (hasFloor) {
    // Only floor → push upward by coarseJump, capped at TOP.
    next = Math.min(TOP_CHECKPOINT_INDEX, bracket.floorIdx + config.coarseJump);
  } else {
    // Only ceiling → drop downward by coarseJump, floored at 0.
    next = Math.max(0, bracket.ceilingIdx - config.coarseJump);
  }

  // Avoid resampling a checkpoint we just answered if a usable neighbour exists.
  const visited = stats.get(next);
  if (visited && visited.answered > 0) {
    if (next < TOP_CHECKPOINT_INDEX && !stats.has(next + 1)) next += 1;
    else if (next > 0 && !stats.has(next - 1)) next -= 1;
  }

  return clampIndex(next);
}

function clampIndex(i: number): number {
  if (i < 0) return 0;
  if (i > TOP_CHECKPOINT_INDEX) return TOP_CHECKPOINT_INDEX;
  return i;
}

// ── Estimator ──────────────────────────────────────────────

export function estimatePlacement(
  responses: readonly PlacementResponseRecord[],
  config: PlacementAlgorithmConfig = DEFAULT_PLACEMENT_CONFIG,
): AdaptivePlacementEstimate {
  const itemsAnswered = responses.length;
  const stats = checkpointStats(responses);
  const bracket = itemsAnswered === 0 ? NO_BRACKET : deriveBracket(stats);
  const consecWrong = trailingConsecutiveWrong(responses);
  const maxConsec = maxConsecutiveWrong(responses);

  const totalCorrect = responses.filter((r) => r.isCorrect).length;
  const rawAccuracy = itemsAnswered > 0 ? totalCorrect / itemsAnswered : 0;

  // ── Confirmed floor ────────────────────────────────────
  // Use the floor checkpoint's center; if no floor at all, treat as below
  // the bottom checkpoint (rank 0). Critically, this is the highest level
  // we have *evidence of comfort for* — never higher than what was tested.
  const confirmedFloorRank =
    bracket.floorIdx >= 0 ? CHECKPOINTS[bracket.floorIdx].center : 0;

  // ── Estimated frontier ─────────────────────────────────
  // Geometric midpoint between confirmed floor and the first failed
  // checkpoint, so a perfect-at-5000 case never lands at exactly 5000.
  let estimatedFrontierRank: number;
  let frontierLow: number;
  let frontierHigh: number;
  let topOfBankReached = false;

  if (bracket.floorIdx === TOP_CHECKPOINT_INDEX && bracket.ceilingIdx > TOP_CHECKPOINT_INDEX) {
    // Cleared the top with no failures.
    topOfBankReached = true;
    estimatedFrontierRank = MAX_CHECKPOINT_RANK;
    frontierLow = MAX_CHECKPOINT_RANK;
    frontierHigh = MAX_CHECKPOINT_RANK;
  } else if (bracket.floorIdx < 0) {
    // No comfort anywhere yet — frontier is below the lowest checkpoint.
    estimatedFrontierRank = Math.round(CHECKPOINTS[0].center / 2);
    frontierLow = 1;
    frontierHigh = CHECKPOINTS[0].center;
  } else if (bracket.ceilingIdx > TOP_CHECKPOINT_INDEX) {
    // Has a floor but no failure — push frontier above the floor by half a
    // checkpoint step (geometric), since we don't actually know how far above.
    const floorCenter = CHECKPOINTS[bracket.floorIdx].center;
    const nextCp = checkpointByIndex(bracket.floorIdx + 1);
    estimatedFrontierRank = nextCp
      ? Math.round(Math.sqrt(floorCenter * nextCp.center))
      : floorCenter;
    frontierLow = floorCenter;
    frontierHigh = nextCp?.center ?? floorCenter;
  } else {
    // Both bounds known → geometric midpoint.
    const floorCenter = CHECKPOINTS[bracket.floorIdx].center;
    const ceilCenter = CHECKPOINTS[bracket.ceilingIdx].center;
    estimatedFrontierRank = Math.round(Math.sqrt(floorCenter * ceilCenter));
    frontierLow = floorCenter;
    frontierHigh = ceilCenter;
  }

  // ── Status ─────────────────────────────────────────────
  const estimateStatus = computeStatus({
    itemsAnswered,
    bracket,
    config,
    topOfBankReached,
  });

  // ── Estimated receptive vocab ──────────────────────────
  // Descriptive projection only: a fraction of the confirmed floor.
  // Accuracy on the floor weights the projection.
  const estimatedReceptiveVocab = Math.round(confirmedFloorRank * Math.max(0.5, rawAccuracy));

  return {
    confirmedFloorRank,
    estimatedFrontierRank,
    frontierRankLow: Math.min(frontierLow, frontierHigh),
    frontierRankHigh: Math.max(frontierLow, frontierHigh),
    estimateStatus,
    topOfBankReached,
    bracketLowIndex: bracket.floorIdx >= 0 ? bracket.floorIdx : null,
    bracketHighIndex:
      bracket.ceilingIdx <= TOP_CHECKPOINT_INDEX ? bracket.ceilingIdx : null,
    consecutiveWrong: consecWrong,
    maxConsecutiveWrong: maxConsec,
    itemsAnswered,
    rawAccuracy,
    estimatedReceptiveVocab,
  };
}

function computeStatus(args: {
  itemsAnswered: number;
  bracket: Bracket;
  config: PlacementAlgorithmConfig;
  topOfBankReached: boolean;
}): PlacementEstimateStatus {
  const { itemsAnswered, bracket, config, topOfBankReached } = args;

  if (itemsAnswered < config.minItems) return "early";
  if (topOfBankReached) return "medium";

  const hasFloor = bracket.floorIdx >= 0;
  const hasCeiling = bracket.ceilingIdx <= TOP_CHECKPOINT_INDEX;
  if (!hasFloor || !hasCeiling) return "provisional";

  const gap = bracket.ceilingIdx - bracket.floorIdx - 1;
  if (gap <= config.precisionBracketWidth && itemsAnswered >= config.minItems + 2) {
    return "high";
  }
  if (gap <= config.precisionBracketWidth + 1) return "medium";
  return "provisional";
}

// ── Helper: planned upper bound for UI ─────────────────────

export function totalPlanned(
  config: PlacementAlgorithmConfig = DEFAULT_PLACEMENT_CONFIG,
): number {
  // Display target — the *expected* item count, not the cap. Halfway
  // between min and max keeps the UI honest about the test being adaptive.
  return Math.round((config.minItems + config.maxItems) / 2);
}

export function determineStage(
  responses: readonly PlacementResponseRecord[],
  config: PlacementAlgorithmConfig = DEFAULT_PLACEMENT_CONFIG,
) {
  return planNextItem(responses, config).stage;
}
