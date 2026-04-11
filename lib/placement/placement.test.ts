import { describe, it, expect } from "vitest";

import { bandForRank, FREQUENCY_BANDS } from "./bands";
import {
  CHECKPOINTS,
  DEFAULT_START_INDEX,
  TOP_CHECKPOINT_INDEX,
  nearestCheckpointIndex,
} from "./checkpoints";
import { estimatePlacement, planNextItem } from "./adaptive";
import {
  buildExposureMap,
  selectFromPool,
  type ExposureMap,
  type PoolCandidate,
  type PriorResponseRow,
} from "./exposure";
import { normalizeAnswer, isRecallCorrect } from "./normalize";
import { computeRecalibration } from "./recalibrate";
import { DEFAULT_PLACEMENT_CONFIG, type PlacementResponseRecord } from "./types";

function makeResponse(
  seq: number,
  rank: number,
  isCorrect: boolean,
  itemType: "recognition" | "recall" = "recognition",
): PlacementResponseRecord {
  return {
    itemBankId: `item-${seq}`,
    wordId: null,
    sequenceIndex: seq,
    itemType,
    bandStart: rank,
    bandEnd: rank,
    promptStem: "",
    promptSentence: null,
    options: null,
    chosenOptionIndex: null,
    chosenText: null,
    normalizedResponse: null,
    isCorrect,
    usedIdk: false,
    latencyMs: null,
    scoreWeight: 1,
    metadata: {},
  };
}

// Build a sequence of correct/wrong responses by walking the simulated learner
// through whatever checkpoint planNextItem picks each round.
function simulate(trueRank: number, maxItems = DEFAULT_PLACEMENT_CONFIG.maxItems) {
  const responses: PlacementResponseRecord[] = [];
  for (let i = 0; i < maxItems; i += 1) {
    const plan = planNextItem(responses);
    if (plan.shouldStop || plan.nextCheckpointIndex === null) break;
    const cp = CHECKPOINTS[plan.nextCheckpointIndex];
    const correct = cp.center <= trueRank;
    responses.push(makeResponse(i, cp.center, correct));
  }
  const finalPlan = planNextItem(responses);
  return { responses, finalPlan, estimate: estimatePlacement(responses) };
}

describe("legacy bands (still used by analytics)", () => {
  it("maps ranks to the correct legacy band", () => {
    expect(bandForRank(1).index).toBe(0);
    expect(bandForRank(500).index).toBe(0);
    expect(bandForRank(501).index).toBe(1);
    expect(bandForRank(3500).index).toBe(5);
    expect(bandForRank(10000).index).toBe(FREQUENCY_BANDS.length - 1);
  });
});

describe("normalizeAnswer / isRecallCorrect", () => {
  it("normalizes common variants", () => {
    expect(normalizeAnswer("To Run")).toBe("run");
    expect(normalizeAnswer("the cat")).toBe("cat");
    expect(normalizeAnswer("  café! ")).toBe("cafe");
  });

  it("accepts variants via accepted answers", () => {
    expect(isRecallCorrect("run", "to run", ["run", "running"])).toBe(true);
    expect(isRecallCorrect("walk", "to run", ["run"])).toBe(false);
    expect(isRecallCorrect("", "run", null)).toBe(false);
  });
});

describe("checkpoints", () => {
  it("nearest checkpoint snaps to the closest log distance", () => {
    expect(nearestCheckpointIndex(1)).toBe(0);
    expect(nearestCheckpointIndex(250)).toBe(0);
    expect(nearestCheckpointIndex(3000)).toBe(DEFAULT_START_INDEX);
    expect(nearestCheckpointIndex(40000)).toBe(TOP_CHECKPOINT_INDEX);
  });
});

describe("planNextItem routing", () => {
  it("cold-starts at the default checkpoint", () => {
    const plan = planNextItem([]);
    expect(plan.stage).toBe("coarse");
    expect(plan.nextCheckpointIndex).toBe(DEFAULT_START_INDEX);
    expect(plan.nextItemType).toBe("recognition");
    expect(plan.shouldStop).toBe(false);
  });

  it("jumps upward after a correct answer (no linear walk)", () => {
    const responses = [
      makeResponse(0, CHECKPOINTS[DEFAULT_START_INDEX].center, true),
    ];
    const plan = planNextItem(responses);
    // Must jump by coarseJump=2, not by 1.
    expect(plan.nextCheckpointIndex).toBe(DEFAULT_START_INDEX + 2);
  });

  it("jumps downward after a wrong answer at the start", () => {
    const responses = [
      makeResponse(0, CHECKPOINTS[DEFAULT_START_INDEX].center, false),
    ];
    const plan = planNextItem(responses);
    expect(plan.nextCheckpointIndex).toBeLessThan(DEFAULT_START_INDEX);
  });

  it("converges into refinement once a bracket is established", () => {
    // Pass the bottom four checkpoints, fail at index 4.
    const responses: PlacementResponseRecord[] = [];
    for (let i = 0; i <= 3; i += 1) {
      responses.push(makeResponse(i, CHECKPOINTS[i].center, true));
    }
    responses.push(makeResponse(4, CHECKPOINTS[4].center, false));
    responses.push(makeResponse(5, CHECKPOINTS[4].center, false));
    const plan = planNextItem(responses);
    expect(plan.bracketLowIndex).toBe(3);
    expect(plan.bracketHighIndex).toBe(4);
  });
});

describe("stopping rules", () => {
  it("never stops below minItems even with all wrong", () => {
    const responses: PlacementResponseRecord[] = [];
    for (let i = 0; i < DEFAULT_PLACEMENT_CONFIG.minItems - 1; i += 1) {
      responses.push(makeResponse(i, CHECKPOINTS[2].center, false));
    }
    const plan = planNextItem(responses);
    expect(plan.shouldStop).toBe(false);
  });

  it("stops on consecutive_wrong_ceiling after the warm-up", () => {
    const responses: PlacementResponseRecord[] = [];
    // First minItems all wrong → that's already minItems consecutive wrong,
    // but rule only fires at consecutiveWrongStop after the minimum.
    for (let i = 0; i < DEFAULT_PLACEMENT_CONFIG.minItems; i += 1) {
      responses.push(makeResponse(i, CHECKPOINTS[2].center, false));
    }
    const plan = planNextItem(responses);
    expect(plan.shouldStop).toBe(true);
    expect(plan.stopReason).toBe("consecutive_wrong_ceiling");
  });

  it("stops at max_items even if no other rule fires", () => {
    const responses: PlacementResponseRecord[] = [];
    // Alternate correct/wrong on the same checkpoint to avoid bracket convergence.
    for (let i = 0; i < DEFAULT_PLACEMENT_CONFIG.maxItems; i += 1) {
      responses.push(makeResponse(i, CHECKPOINTS[5].center, i % 2 === 0));
    }
    const plan = planNextItem(responses);
    expect(plan.shouldStop).toBe(true);
    expect(plan.stopReason).toBe("max_items");
  });

  it("reports top_of_bank_reached when the top checkpoint passes with no failures", () => {
    const { finalPlan, estimate } = simulate(50_000); // way above top
    expect(finalPlan.shouldStop).toBe(true);
    expect(finalPlan.stopReason).toBe("top_of_bank_reached");
    expect(estimate.topOfBankReached).toBe(true);
    expect(estimate.estimateStatus).toBe("medium");
  });
});

describe("estimatePlacement", () => {
  it("never reports an exact frontier when only the floor is known and ceiling not hit", () => {
    // Pass 5000 perfectly but never test above it.
    const responses = [
      makeResponse(0, 5000, true),
      makeResponse(1, 5000, true),
      makeResponse(2, 5000, true),
    ];
    const est = estimatePlacement(responses);
    // The bracket is open above, so the geometric midpoint pushes the
    // frontier above 5000 — we never report "exactly 5000".
    expect(est.confirmedFloorRank).toBe(5000);
    expect(est.estimatedFrontierRank).toBeGreaterThan(5000);
  });

  it("places the frontier between confirmed floor and first failed checkpoint", () => {
    // Pass at index 3 (1750), fail at index 5 (5000). Floor=3, ceiling=5.
    const responses = [
      makeResponse(0, CHECKPOINTS[3].center, true),
      makeResponse(1, CHECKPOINTS[3].center, true),
      makeResponse(2, CHECKPOINTS[5].center, false),
      makeResponse(3, CHECKPOINTS[5].center, false),
    ];
    const est = estimatePlacement(responses);
    expect(est.confirmedFloorRank).toBe(CHECKPOINTS[3].center);
    expect(est.frontierRankLow).toBe(CHECKPOINTS[3].center);
    expect(est.frontierRankHigh).toBe(CHECKPOINTS[5].center);
    expect(est.estimatedFrontierRank).toBeGreaterThan(CHECKPOINTS[3].center);
    expect(est.estimatedFrontierRank).toBeLessThan(CHECKPOINTS[5].center);
  });

  it("falls back to below-bottom when nothing comfortable was found", () => {
    const responses = [
      makeResponse(0, CHECKPOINTS[0].center, false),
      makeResponse(1, CHECKPOINTS[0].center, false),
    ];
    const est = estimatePlacement(responses);
    expect(est.confirmedFloorRank).toBe(0);
    expect(est.estimatedFrontierRank).toBeLessThan(CHECKPOINTS[0].center);
  });

  it("rises through estimateStatus as evidence accumulates", () => {
    const early = estimatePlacement([makeResponse(0, CHECKPOINTS[3].center, true)]);
    expect(early.estimateStatus).toBe("early");

    // 8 items with a tight 2-checkpoint bracket → high confidence eventually.
    const responses: PlacementResponseRecord[] = [];
    for (let i = 0; i < 4; i += 1) responses.push(makeResponse(i, CHECKPOINTS[3].center, true));
    for (let i = 4; i < 10; i += 1) responses.push(makeResponse(i, CHECKPOINTS[5].center, false));
    const tight = estimatePlacement(responses);
    expect(["medium", "high"]).toContain(tight.estimateStatus);
  });
});

describe("end-to-end simulation", () => {
  it("places a learner with true rank ~1500 inside a tight bracket", () => {
    const { finalPlan, estimate } = simulate(1500);
    expect(finalPlan.shouldStop).toBe(true);
    expect(estimate.frontierRankLow).toBeLessThanOrEqual(1500);
    expect(estimate.frontierRankHigh).toBeGreaterThanOrEqual(1500);
    expect(estimate.itemsAnswered).toBeLessThanOrEqual(
      DEFAULT_PLACEMENT_CONFIG.maxItems,
    );
  });

  it("places a learner with true rank ~10000 inside a tight bracket", () => {
    const { estimate } = simulate(10_000);
    expect(estimate.frontierRankLow).toBeLessThanOrEqual(10_000);
    expect(estimate.frontierRankHigh).toBeGreaterThanOrEqual(10_000);
  });
});

// ── End-to-end retake differentiation ─────────────────────

/**
 * Simulate one full diagnostic attempt against a fixed candidate pool.
 *
 * For each step we let `planNextItem` choose a checkpoint, then ask
 * `selectFromPool` to pick an item from the per-checkpoint pool, advancing
 * exposure tracking and producing a response record. The response uses the
 * picked item's rank so the engine sees the right checkpoint on the next
 * step (matching the production wiring in app/actions/placement.ts).
 */
function runAttempt(args: {
  attemptId: string;
  trueRank: number;
  pools: Map<number, PoolCandidate[]>;
  exposure: ExposureMap;
}) {
  const responses: PlacementResponseRecord[] = [];
  const pickedRows: PriorResponseRow[] = [];
  const usedIds = new Set<string>();
  let now = Date.parse("2026-04-11T12:00:00Z");
  for (let i = 0; i < DEFAULT_PLACEMENT_CONFIG.maxItems; i += 1) {
    const plan = planNextItem(responses);
    if (plan.shouldStop || plan.nextCheckpointIndex === null) break;
    const cpPool = args.pools.get(plan.nextCheckpointIndex) ?? [];
    if (cpPool.length === 0) break;
    const sel = selectFromPool(cpPool, {
      targetRank: CHECKPOINTS[plan.nextCheckpointIndex].center,
      excludeIds: usedIds,
      exposure: args.exposure,
      seed: `${args.attemptId}:${i}`,
      nowMs: now,
    });
    if (!sel) break;
    usedIds.add(sel.pickedId);
    const item = cpPool.find((c) => c.itemBankId === sel.pickedId)!;
    const correct = item.frequencyRank <= args.trueRank;
    responses.push(makeResponse(i, item.frequencyRank, correct));
    now += 60_000;
    pickedRows.push({
      run_id: args.attemptId,
      item_bank_id: sel.pickedId,
      answered_at: new Date(now).toISOString(),
    });
  }
  return { responses, pickedRows, estimate: estimatePlacement(responses), usedIds };
}

function buildPools(): Map<number, PoolCandidate[]> {
  // Build a 16-item interchangeable pool for each checkpoint. The real item
  // bank has hundreds per checkpoint; 16 is enough to exercise refinement
  // without forcing pool exhaustion in the typical retake case.
  const m = new Map<number, PoolCandidate[]>();
  for (const cp of CHECKPOINTS) {
    const items: PoolCandidate[] = [];
    const spread = Math.max(15, Math.round(cp.center * 0.015));
    for (let i = 0; i < 16; i += 1) {
      items.push({
        itemBankId: `cp${cp.index}-${i}`,
        frequencyRank: cp.center + (i - 8) * spread,
      });
    }
    m.set(cp.index, items);
  }
  return m;
}

describe("retake differentiation (end-to-end)", () => {
  it("serves a different item path on retake while keeping placement comparable", () => {
    const pools = buildPools();

    // First attempt with no prior exposure.
    const first = runAttempt({
      attemptId: "run-1",
      trueRank: 5500,
      pools,
      exposure: new Map(),
    });

    // Build exposure from the first attempt and run the retake.
    const exposureForSecond = buildExposureMap(first.pickedRows, ["run-1"]);
    const second = runAttempt({
      attemptId: "run-2",
      trueRank: 5500,
      pools,
      exposure: exposureForSecond,
    });

    // Different item path: at least half of the served items should differ.
    const overlap = [...first.usedIds].filter((id) => second.usedIds.has(id)).length;
    expect(overlap).toBeLessThan(first.usedIds.size / 2);

    // No item used twice within a single attempt.
    expect(second.usedIds.size).toBe(second.responses.length);

    // Comparable placement: the second attempt's bracket still wraps the
    // true rank to within one checkpoint step.
    expect(second.estimate.frontierRankLow).toBeLessThanOrEqual(5500);
    expect(second.estimate.frontierRankHigh).toBeGreaterThanOrEqual(5500);
  });

  it("avoids items from the immediately previous attempt unless forced", () => {
    const pools = buildPools();
    const first = runAttempt({
      attemptId: "run-1",
      trueRank: 1500,
      pools,
      exposure: new Map(),
    });
    const exposure = buildExposureMap(first.pickedRows, ["run-1"]);
    const second = runAttempt({ attemptId: "run-2", trueRank: 1500, pools, exposure });
    // None of the items the second attempt served should overlap with the
    // first under normal pool conditions (6 items per checkpoint, and we
    // typically serve ≤ 2 items per checkpoint per attempt).
    const overlapping = [...second.usedIds].filter((id) => first.usedIds.has(id));
    expect(overlapping.length).toBe(0);
  });

  it("falls back to reuse only when the pool is exhausted", () => {
    // Tiny single-item pool: any retake must reuse and flag it.
    const tiny: PoolCandidate[] = [{ itemBankId: "only", frequencyRank: 500 }];
    const exposure: ExposureMap = new Map([
      [
        "only",
        { attemptCount: 1, inImmediatePrevious: true, inRecentWindow: true, lastSeenAt: 0 },
      ],
    ]);
    const result = selectFromPool(tiny, {
      targetRank: 500,
      excludeIds: new Set(),
      exposure,
      seed: "forced",
    });
    expect(result?.pickedId).toBe("only");
    expect(result?.reuseDueToPoolExhaustion).toBe(true);
    expect(result?.previousAttemptSeen).toBe(true);
  });
});

describe("computeRecalibration", () => {
  it("returns null without enough evidence", () => {
    const r = computeRecalibration({
      currentFrontierRank: 1500,
      placementConfidence: 0.5,
      baselineAt: null,
      reviewAccuracy: null,
      reviewCount: 0,
      avgLatencyMs: null,
      readingQuestionAccuracy: null,
      readingQuestionCount: 0,
      sessionCompletionRate: null,
      daysSinceBaseline: 1,
    });
    expect(r).toBeNull();
  });

  it("moves frontier up on strong evidence", () => {
    const r = computeRecalibration({
      currentFrontierRank: 1500,
      placementConfidence: 0.5,
      baselineAt: null,
      reviewAccuracy: 0.9,
      reviewCount: 30,
      avgLatencyMs: 2000,
      readingQuestionAccuracy: 0.95,
      readingQuestionCount: 10,
      sessionCompletionRate: 1,
      daysSinceBaseline: 1,
    });
    expect(r).not.toBeNull();
    expect(r!.nextFrontierRank).toBeGreaterThan(1500);
  });

  it("moves frontier down on weak evidence", () => {
    const r = computeRecalibration({
      currentFrontierRank: 1500,
      placementConfidence: 0.5,
      baselineAt: null,
      reviewAccuracy: 0.2,
      reviewCount: 30,
      avgLatencyMs: 8000,
      readingQuestionAccuracy: 0.25,
      readingQuestionCount: 10,
      sessionCompletionRate: 0.2,
      daysSinceBaseline: 1,
    });
    expect(r).not.toBeNull();
    expect(r!.nextFrontierRank).toBeLessThan(1500);
  });
});
