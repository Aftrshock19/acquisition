/**
 * Adaptive placement engine — v3 (floor-based, cognate/morphology fair).
 *
 * The old v2 engine advanced one checkpoint per correct answer with a
 * coarse-jump of ±2. That let one lucky hit rocket a user upward, and made
 * the test vulnerable to transparent cognates and rare inflected forms.
 *
 * v3 replaces single-item routing with **floor modules**. Each floor maps
 * one-to-one to a checkpoint and runs for up to `itemsPerFloor` items (5
 * default). Floors resolve with one of four outcomes:
 *
 *   - cleared           (≥4/5 correct AND non-cognate support present, or
 *                        5/5 on the top floor with ≥2 non-cognate correct)
 *   - tentative_cleared (4/5 without non-cognate support; 4/5 on top floor)
 *   - unresolved        (3/5 — hold at this level, don't climb)
 *   - failed            (≤2/5, or mathematically impossible to reach 4/5)
 *
 * Routing rules:
 *   - A floor in progress serves its next item at the same checkpoint.
 *   - `cleared` / `tentative_cleared` ⇒ advance by exactly +1 checkpoint.
 *   - `failed` ⇒ drop by exactly -1 checkpoint.
 *   - `unresolved` ⇒ stop upward progression.
 *   - No skipping in the lower/mid range; no coarse-jump anywhere.
 *
 * Stopping rules (any fires):
 *   - precision_reached: the floor immediately above a cleared floor has
 *     been failed or unresolved, producing a tight bracket.
 *   - floor_failed_at_bottom: cp 0 failed with no cleared floor below.
 *   - top_of_bank_reached: top floor cleared.
 *   - consecutive_wrong_ceiling: config.consecutiveWrongStop in a row.
 *   - max_items: config hard cap.
 *
 * Pure functions only — no DB. The caller supplies `PlacementResponseRecord`s
 * whose `bandStart` / `bandEnd` already encode the intended checkpoint
 * center (see app/actions/placement.ts for the round-trip).
 */

import {
  CHECKPOINTS,
  DEFAULT_START_INDEX,
  MAX_CHECKPOINT_RANK,
  TOP_CHECKPOINT_INDEX,
  checkpointByIndex,
  nearestCheckpointIndex,
} from "./checkpoints";
import { lexicalWeightForCognate, type CognateClass } from "./cognate";
import type { MorphologyClass } from "./morphology";
import {
  DEFAULT_PLACEMENT_CONFIG,
  type AdaptivePlacementEstimate,
  type FloorOutcome,
  type FloorState,
  type FrontierEvidenceQuality,
  type PlacementAlgorithmConfig,
  type PlacementEstimateStatus,
  type PlacementItemType,
  type PlacementPlan,
  type PlacementResponseRecord,
  type PlacementStopReason,
} from "./types";

// ── Floor construction ────────────────────────────────────

/**
 * Walk the response history in order and produce one FloorState per
 * contiguous run at the same checkpoint. A user who goes 4→5→4 produces
 * three separate floor modules so that each visit is scored on its own
 * merits — but in practice the engine never re-opens a closed floor
 * (repeat visits only happen when walking downward after a failure).
 */
function buildFloors(
  responses: readonly PlacementResponseRecord[],
  config: PlacementAlgorithmConfig,
): FloorState[] {
  const floors: FloorState[] = [];
  let current: FloorState | null = null;
  for (const r of responses) {
    const cpIdx = r.floorIndex ?? nearestCheckpointIndex(
      Math.round((r.bandStart + r.bandEnd) / 2),
    );
    // Start a new floor when the checkpoint changes, when no floor is open,
    // or when the current floor has already hit its target item count. We
    // keep appending same-cp items into an already-resolved floor (e.g. the
    // 5th item after an early 4/5 clear) so fairness rules can downgrade the
    // outcome as more evidence arrives.
    const needNewFloor =
      current === null ||
      current.checkpointIndex !== cpIdx ||
      current.itemsServed >= config.itemsPerFloor;
    let floor: FloorState;
    if (needNewFloor) {
      floor = {
        checkpointIndex: cpIdx,
        floorSequence: floors.length,
        itemsServed: 0,
        correct: 0,
        weightedTotal: 0,
        weightedCorrect: 0,
        nonCognateServed: 0,
        nonCognateCorrect: 0,
        markedFormsServed: 0,
        markedFormsCorrect: 0,
        outcome: "in_progress",
      };
      floors.push(floor);
      current = floor;
    } else {
      floor = current!;
    }
    // Fallback weights for legacy rows without classifier metadata.
    const cognateClass: CognateClass = r.cognateClass ?? "non_cognate";
    const morphClass: MorphologyClass = r.morphologyClass ?? "base";
    const lexW = r.lexicalWeight ?? lexicalWeightForCognate(cognateClass);
    const morphW = r.morphologyWeight ?? 1.0;
    const w = lexW * morphW;
    floor.itemsServed += 1;
    floor.weightedTotal += w;
    if (r.isCorrect) {
      floor.correct += 1;
      floor.weightedCorrect += w;
    }
    if (cognateClass === "non_cognate") {
      floor.nonCognateServed += 1;
      if (r.isCorrect) floor.nonCognateCorrect += 1;
    }
    if (morphClass === "irregular_or_marked_inflection") {
      floor.markedFormsServed += 1;
      if (r.isCorrect) floor.markedFormsCorrect += 1;
    }
    floor.outcome = resolveOutcome(floor, config);
  }
  return floors;
}

/**
 * Compute a floor's outcome given its current item tally. Called repeatedly
 * as items arrive; safe to invoke when itemsServed < itemsPerFloor.
 */
export function resolveOutcome(
  f: Omit<FloorState, "outcome"> & { outcome?: FloorOutcome },
  config: PlacementAlgorithmConfig = DEFAULT_PLACEMENT_CONFIG,
): FloorOutcome {
  const target = config.itemsPerFloor;
  const served = f.itemsServed;
  const correct = f.correct;
  const wrong = served - correct;
  const isTop = f.checkpointIndex === TOP_CHECKPOINT_INDEX;
  const nonCognateSupport =
    f.nonCognateServed === 0 || f.nonCognateCorrect >= 1;
  const topNonCognateSupport = f.nonCognateCorrect >= config.topFloorMinNonCognateCorrect;

  // Early fail: too many wrong to ever reach the clear threshold.
  if (correct + (target - served) < config.tentativeThreshold) {
    return "failed";
  }

  // Early clear: ≥ clearThreshold correct already and not top floor.
  if (!isTop && correct >= config.clearThreshold) {
    return nonCognateSupport ? "cleared" : "tentative_cleared";
  }

  // Top floor early clear: needs full sweep, can only resolve at target.
  if (isTop && served >= target) {
    if (correct >= config.clearThresholdTop && topNonCognateSupport) {
      return "cleared";
    }
    if (correct >= config.clearThreshold) {
      return "tentative_cleared";
    }
    if (correct >= config.tentativeThreshold) {
      return "unresolved";
    }
    return "failed";
  }

  // Still collecting evidence.
  if (served < target) return "in_progress";

  // Floor complete (non-top path).
  if (correct >= config.clearThreshold) {
    return nonCognateSupport ? "cleared" : "tentative_cleared";
  }
  if (correct >= config.tentativeThreshold) return "unresolved";
  // wrong >= target - tentativeThreshold + 1 ⇒ failed handled above.
  void wrong;
  return "failed";
}

// ── Bracket derivation from floor outcomes ────────────────

type Bracket = {
  floorIdx: number;
  ceilingIdx: number;
};

const NO_BRACKET: Bracket = { floorIdx: -1, ceilingIdx: TOP_CHECKPOINT_INDEX + 1 };

function deriveBracket(floors: readonly FloorState[]): Bracket {
  let floorIdx = -1;
  let ceilingIdx = TOP_CHECKPOINT_INDEX + 1;
  for (const f of floors) {
    if (f.outcome === "cleared" || f.outcome === "tentative_cleared") {
      if (f.checkpointIndex > floorIdx) floorIdx = f.checkpointIndex;
    }
    if (f.outcome === "failed" || f.outcome === "unresolved") {
      if (f.checkpointIndex < ceilingIdx) ceilingIdx = f.checkpointIndex;
    }
  }
  if (floorIdx >= ceilingIdx) floorIdx = ceilingIdx - 1;
  return { floorIdx, ceilingIdx };
}

// ── Consecutive wrong (kept for ceiling-stop rule) ────────

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
  priorCheckpointIndex?: number | null;
};

export function planNextItem(
  responses: readonly PlacementResponseRecord[],
  config: PlacementAlgorithmConfig = DEFAULT_PLACEMENT_CONFIG,
  context: PlanContext = {},
): PlacementPlan {
  const itemsAnswered = responses.length;
  const floors = buildFloors(responses, config);
  const bracket = floors.length === 0 ? NO_BRACKET : deriveBracket(floors);
  const consecWrong = trailingConsecutiveWrong(responses);
  const recallAnswered = responses.filter((r) => r.itemType === "recall").length;
  const remainingBudget = Math.max(0, config.maxItems - itemsAnswered);

  const lastFloor = floors[floors.length - 1] ?? null;
  const currentFloorItemsServed = lastFloor && lastFloor.outcome === "in_progress"
    ? lastFloor.itemsServed
    : 0;
  const currentFloorSequence = lastFloor?.floorSequence ?? null;

  // ── Stopping rules ──────────────────────────────────────
  const stopDecision = decideStop({
    itemsAnswered,
    floors,
    bracket,
    consecWrong,
    config,
    lastFloor,
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
      currentFloorSequence,
      currentFloorItemsServed,
      floors,
    };
  }

  // ── Pick next checkpoint ────────────────────────────────
  const nextIdx = pickNextCheckpoint({
    floors,
    lastFloor,
    priorIdx: context.priorCheckpointIndex ?? null,
  });

  // ── Stage label and item type ───────────────────────────
  const bracketGap =
    bracket.floorIdx >= 0 && bracket.ceilingIdx <= TOP_CHECKPOINT_INDEX
      ? bracket.ceilingIdx - bracket.floorIdx - 1
      : null;
  const inRefinement = bracketGap !== null && bracketGap <= 2;
  const stage = inRefinement ? "refine" : "coarse";

  // Reserve recall items for the refinement phase and near the frontier.
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
    reason: buildReason({ floors, lastFloor, nextIdx, inRefinement, itemsAnswered }),
    shouldStop: false,
    stopReason: "in_progress",
    currentFloorSequence: lastFloor?.outcome === "in_progress"
      ? currentFloorSequence
      : floors.length, // next served item opens a new floor
    currentFloorItemsServed,
    floors,
  };
}

function buildReason(args: {
  floors: readonly FloorState[];
  lastFloor: FloorState | null;
  nextIdx: number;
  inRefinement: boolean;
  itemsAnswered: number;
}): string {
  if (args.itemsAnswered === 0) {
    return `cold start at checkpoint ${args.nextIdx} (rank ${CHECKPOINTS[args.nextIdx].center})`;
  }
  if (args.lastFloor?.outcome === "in_progress") {
    return `floor ${args.lastFloor.checkpointIndex} in progress (${args.lastFloor.correct}/${args.lastFloor.itemsServed})`;
  }
  if (args.lastFloor) {
    const direction =
      args.nextIdx > args.lastFloor.checkpointIndex
        ? "up"
        : args.nextIdx < args.lastFloor.checkpointIndex
          ? "down"
          : "hold";
    return `floor ${args.lastFloor.checkpointIndex} → ${args.lastFloor.outcome}; step ${direction} to ${args.nextIdx}`;
  }
  return `next floor ${args.nextIdx}`;
}

// ── Stop decision ──────────────────────────────────────────

function decideStop(args: {
  itemsAnswered: number;
  floors: readonly FloorState[];
  bracket: Bracket;
  consecWrong: number;
  config: PlacementAlgorithmConfig;
  lastFloor: FloorState | null;
}): { shouldStop: boolean; stopReason: PlacementStopReason; reason: string } {
  const { itemsAnswered, floors, bracket, consecWrong, config, lastFloor } = args;

  if (itemsAnswered >= config.maxItems) {
    return {
      shouldStop: true,
      stopReason: "max_items",
      reason: `reached maxItems=${config.maxItems}`,
    };
  }

  // Consecutive wrong ceiling — still a useful safety net and applies any
  // time after minItems is satisfied.
  if (itemsAnswered >= config.minItems && consecWrong >= config.consecutiveWrongStop) {
    return {
      shouldStop: true,
      stopReason: "consecutive_wrong_ceiling",
      reason: `${consecWrong} consecutive wrong after minItems`,
    };
  }

  // Top-of-bank cleared.
  const topFloor = floors.find(
    (f) => f.checkpointIndex === TOP_CHECKPOINT_INDEX && f.outcome === "cleared",
  );
  if (topFloor) {
    return {
      shouldStop: true,
      stopReason: "top_of_bank_reached",
      reason: "top floor cleared",
    };
  }

  // Below minItems we keep going unless a *definitive* bracket already
  // exists. A definitive bracket means: a cleared floor with a failed floor
  // immediately above it (no unresolved in between).
  const definitiveBracket =
    bracket.floorIdx >= 0 &&
    bracket.ceilingIdx <= TOP_CHECKPOINT_INDEX &&
    bracket.ceilingIdx - bracket.floorIdx === 1 &&
    floors.some(
      (f) => f.checkpointIndex === bracket.ceilingIdx && f.outcome === "failed",
    );

  if (itemsAnswered < config.minItems && !definitiveBracket) {
    return { shouldStop: false, stopReason: "in_progress", reason: "below minItems" };
  }

  // Floor at cp 0 failed with no cleared floor anywhere ⇒ below the bank.
  if (
    lastFloor &&
    lastFloor.checkpointIndex === 0 &&
    lastFloor.outcome === "failed" &&
    bracket.floorIdx < 0
  ) {
    return {
      shouldStop: true,
      stopReason: "floor_failed_at_bottom",
      reason: "failed the lowest floor with no comfort zone",
    };
  }

  // Precision: cleared floor with a failed/unresolved floor one step above.
  if (
    bracket.floorIdx >= 0 &&
    bracket.ceilingIdx <= TOP_CHECKPOINT_INDEX &&
    bracket.ceilingIdx - bracket.floorIdx - 1 <= config.precisionBracketWidth
  ) {
    return {
      shouldStop: true,
      stopReason: "precision_reached",
      reason: `bracket [${bracket.floorIdx},${bracket.ceilingIdx}] tight`,
    };
  }

  // Unresolved floor above a cleared floor with no further room to climb.
  if (lastFloor && lastFloor.outcome === "unresolved" && bracket.floorIdx >= 0) {
    return {
      shouldStop: true,
      stopReason: "floor_unresolved",
      reason: `floor ${lastFloor.checkpointIndex} unresolved above cleared floor ${bracket.floorIdx}`,
    };
  }

  return { shouldStop: false, stopReason: "in_progress", reason: "continuing" };
}

// ── Next-checkpoint selection ──────────────────────────────

function pickNextCheckpoint(args: {
  floors: readonly FloorState[];
  lastFloor: FloorState | null;
  priorIdx: number | null;
}): number {
  if (!args.lastFloor) {
    // Cold start.
    return clampIndex(args.priorIdx ?? DEFAULT_START_INDEX);
  }

  const last = args.lastFloor;

  // Same floor still open — serve the next item at the same checkpoint.
  if (last.outcome === "in_progress") {
    return last.checkpointIndex;
  }

  // Advance / retreat by exactly one — no skipping.
  let next: number;
  if (last.outcome === "cleared" || last.outcome === "tentative_cleared") {
    next = last.checkpointIndex + 1;
  } else if (last.outcome === "failed") {
    next = last.checkpointIndex - 1;
  } else {
    // Unresolved ⇒ this branch should be caught by decideStop, but if we
    // somehow land here keep probing the same level one more time.
    next = last.checkpointIndex;
  }

  // If we're about to re-open a floor we already closed, clamp to the side
  // that still has unexplored room.
  const seen = new Set(args.floors.map((f) => f.checkpointIndex));
  if (seen.has(next)) {
    if (next < TOP_CHECKPOINT_INDEX && !seen.has(next + 1)) next += 1;
    else if (next > 0 && !seen.has(next - 1)) next -= 1;
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
  const floors = buildFloors(responses, config);
  const bracket = floors.length === 0 ? NO_BRACKET : deriveBracket(floors);
  const consecWrong = trailingConsecutiveWrong(responses);
  const maxConsec = maxConsecutiveWrong(responses);

  const totalCorrect = responses.filter((r) => r.isCorrect).length;
  const rawAccuracy = itemsAnswered > 0 ? totalCorrect / itemsAnswered : 0;

  // Highest fully and tentatively cleared floor.
  let highestCleared = -1;
  let highestTentative = -1;
  for (const f of floors) {
    if (f.outcome === "cleared" && f.checkpointIndex > highestCleared) {
      highestCleared = f.checkpointIndex;
    }
    if (
      (f.outcome === "cleared" || f.outcome === "tentative_cleared") &&
      f.checkpointIndex > highestTentative
    ) {
      highestTentative = f.checkpointIndex;
    }
  }

  const confirmedFloorRank =
    highestCleared >= 0
      ? CHECKPOINTS[highestCleared].center
      : highestTentative >= 0
        ? CHECKPOINTS[highestTentative].center
        : 0;

  // Frontier estimation.
  let estimatedFrontierRank: number;
  let frontierLow: number;
  let frontierHigh: number;
  let topOfBankReached = false;

  const topCleared = floors.some(
    (f) => f.checkpointIndex === TOP_CHECKPOINT_INDEX && f.outcome === "cleared",
  );

  if (topCleared) {
    topOfBankReached = true;
    estimatedFrontierRank = MAX_CHECKPOINT_RANK;
    frontierLow = MAX_CHECKPOINT_RANK;
    frontierHigh = MAX_CHECKPOINT_RANK;
  } else if (highestTentative < 0) {
    // No comfort evidence anywhere.
    estimatedFrontierRank = Math.round(CHECKPOINTS[0].center / 2);
    frontierLow = 1;
    frontierHigh = CHECKPOINTS[0].center;
  } else if (bracket.ceilingIdx > TOP_CHECKPOINT_INDEX) {
    // Has cleared/tentative but no upper failure — step half a checkpoint up.
    const floorCenter = CHECKPOINTS[highestTentative].center;
    const nextCp = checkpointByIndex(highestTentative + 1);
    estimatedFrontierRank = nextCp
      ? Math.round(Math.sqrt(floorCenter * nextCp.center))
      : floorCenter;
    frontierLow = floorCenter;
    frontierHigh = nextCp?.center ?? floorCenter;
  } else {
    const floorCenter = CHECKPOINTS[highestTentative].center;
    const ceilCenter = CHECKPOINTS[bracket.ceilingIdx].center;
    estimatedFrontierRank = Math.round(Math.sqrt(floorCenter * ceilCenter));
    frontierLow = floorCenter;
    frontierHigh = ceilCenter;
  }

  // Evidence quality: based on the highest cleared/tentative floor's
  // cognate and morphology composition.
  const { frontierEvidenceQuality, nonCognateSupportPresent, cognateHeavy, morphHeavy } =
    computeEvidenceQuality(floors, highestTentative);

  // Status.
  const estimateStatus = computeStatus({
    itemsAnswered,
    floors,
    bracket,
    config,
    topOfBankReached,
    frontierEvidenceQuality,
  });

  const estimatedReceptiveVocab = Math.round(
    confirmedFloorRank * Math.max(0.5, rawAccuracy),
  );

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
    highestClearedFloorIndex: highestCleared >= 0 ? highestCleared : null,
    highestTentativeFloorIndex: highestTentative >= 0 ? highestTentative : null,
    totalFloorsVisited: floors.length,
    floorOutcomes: floors,
    frontierEvidenceQuality,
    nonCognateSupportPresent,
    cognateHeavyEstimate: cognateHeavy,
    morphologyHeavyEstimate: morphHeavy,
  };
}

function computeEvidenceQuality(
  floors: readonly FloorState[],
  highestTentative: number,
): {
  frontierEvidenceQuality: FrontierEvidenceQuality;
  nonCognateSupportPresent: boolean;
  cognateHeavy: boolean;
  morphHeavy: boolean;
} {
  if (highestTentative < 0) {
    return {
      frontierEvidenceQuality: "low",
      nonCognateSupportPresent: false,
      cognateHeavy: false,
      morphHeavy: false,
    };
  }
  // Look at the top two tentative-or-cleared floors.
  const topFloors = floors
    .filter(
      (f) =>
        (f.outcome === "cleared" || f.outcome === "tentative_cleared") &&
        f.checkpointIndex >= highestTentative - 1,
    )
    .slice(-2);
  let nonCognateCorrect = 0;
  let totalCorrect = 0;
  let markedCorrect = 0;
  for (const f of topFloors) {
    nonCognateCorrect += f.nonCognateCorrect;
    totalCorrect += f.correct;
    markedCorrect += f.markedFormsCorrect;
  }
  const nonCognateSupportPresent = nonCognateCorrect >= 1;
  const cognateHeavy =
    totalCorrect >= 2 && nonCognateCorrect / totalCorrect < 0.5;
  const morphHeavy = totalCorrect >= 2 && markedCorrect / totalCorrect >= 0.5;

  const topFloorCleared = topFloors.some((f) => f.outcome === "cleared");
  let q: FrontierEvidenceQuality;
  if (topFloorCleared && nonCognateSupportPresent && !cognateHeavy && !morphHeavy) {
    q = "high";
  } else if (topFloorCleared && nonCognateSupportPresent) {
    q = "medium";
  } else {
    q = "low";
  }
  return {
    frontierEvidenceQuality: q,
    nonCognateSupportPresent,
    cognateHeavy,
    morphHeavy,
  };
}

function computeStatus(args: {
  itemsAnswered: number;
  floors: readonly FloorState[];
  bracket: Bracket;
  config: PlacementAlgorithmConfig;
  topOfBankReached: boolean;
  frontierEvidenceQuality: FrontierEvidenceQuality;
}): PlacementEstimateStatus {
  const { itemsAnswered, bracket, config, topOfBankReached, frontierEvidenceQuality } = args;

  if (itemsAnswered < config.minItems - 2) return "early";
  if (topOfBankReached) {
    return frontierEvidenceQuality === "high" ? "high" : "medium";
  }
  const hasFloor = bracket.floorIdx >= 0;
  const hasCeiling = bracket.ceilingIdx <= TOP_CHECKPOINT_INDEX;
  if (!hasFloor || !hasCeiling) return "provisional";

  const gap = bracket.ceilingIdx - bracket.floorIdx - 1;
  if (
    gap <= config.precisionBracketWidth &&
    itemsAnswered >= config.minItems &&
    frontierEvidenceQuality !== "low"
  ) {
    return "high";
  }
  if (gap <= config.precisionBracketWidth + 1) return "medium";
  return "provisional";
}

// ── UI helpers (unchanged signatures) ──────────────────────

export function totalPlanned(
  config: PlacementAlgorithmConfig = DEFAULT_PLACEMENT_CONFIG,
): number {
  return Math.round((config.minItems + config.maxItems) / 2);
}

export function determineStage(
  responses: readonly PlacementResponseRecord[],
  config: PlacementAlgorithmConfig = DEFAULT_PLACEMENT_CONFIG,
) {
  return planNextItem(responses, config).stage;
}
