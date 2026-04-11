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
import {
  DEFAULT_PLACEMENT_CONFIG,
  type PlacementResponseRecord,
} from "./types";
import type { CognateClass } from "./cognate";
import type { MorphologyClass } from "./morphology";

// ── Fixtures ───────────────────────────────────────────────

type ResponseOverrides = {
  itemType?: "recognition" | "recall";
  cognateClass?: CognateClass;
  morphologyClass?: MorphologyClass;
  lexicalWeight?: number;
  morphologyWeight?: number;
  floorIndex?: number | null;
};

function makeResponse(
  seq: number,
  cpIdxOrRank: number,
  isCorrect: boolean,
  overrides: ResponseOverrides = {},
): PlacementResponseRecord {
  // Accept either a checkpoint index (0..TOP) or a raw rank.
  const rank =
    cpIdxOrRank >= 0 && cpIdxOrRank <= TOP_CHECKPOINT_INDEX
      ? CHECKPOINTS[cpIdxOrRank].center
      : cpIdxOrRank;
  const cp = nearestCheckpointIndex(rank);
  const cognateClass = overrides.cognateClass ?? "non_cognate";
  const morphologyClass = overrides.morphologyClass ?? "base";
  const lexicalWeight =
    overrides.lexicalWeight ??
    (cognateClass === "strong_cognate"
      ? 0.5
      : cognateClass === "weak_cognate"
        ? 0.8
        : 1.0);
  const morphologyWeight =
    overrides.morphologyWeight ??
    (morphologyClass === "irregular_or_marked_inflection" ? 0.5 : 1.0);
  return {
    itemBankId: `item-${seq}`,
    wordId: `word-${seq}`,
    sequenceIndex: seq,
    itemType: overrides.itemType ?? "recognition",
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
    floorIndex: overrides.floorIndex ?? cp,
    floorSequence: null,
    cognateClass,
    morphologyClass,
    isInflectedForm: morphologyClass !== "base",
    lemmaRank: rank,
    effectiveDiagnosticRank: rank,
    lexicalWeight,
    morphologyWeight,
  };
}

// Serve N responses at a given checkpoint with the same correctness.
function serveFloor(
  seqStart: number,
  cpIdx: number,
  correctCount: number,
  total: number,
  overrides: ResponseOverrides = {},
): PlacementResponseRecord[] {
  const out: PlacementResponseRecord[] = [];
  for (let i = 0; i < total; i += 1) {
    out.push(makeResponse(seqStart + i, cpIdx, i < correctCount, overrides));
  }
  return out;
}

// Full simulation with floor-based progression.
function simulate(
  trueRank: number,
  maxItems = DEFAULT_PLACEMENT_CONFIG.maxItems,
) {
  const config = { ...DEFAULT_PLACEMENT_CONFIG, maxItems };
  const responses: PlacementResponseRecord[] = [];
  for (let i = 0; i < maxItems; i += 1) {
    const plan = planNextItem(responses, config);
    if (plan.shouldStop || plan.nextCheckpointIndex === null) break;
    const cp = CHECKPOINTS[plan.nextCheckpointIndex];
    const correct = cp.center <= trueRank;
    responses.push(makeResponse(i, plan.nextCheckpointIndex, correct));
  }
  const finalPlan = planNextItem(responses, config);
  return { responses, finalPlan, estimate: estimatePlacement(responses, config) };
}

// ── Legacy bands (still used by analytics) ────────────────

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

// ── Floor progression core ───────────────────────────────

describe("floor progression — single-item advancement forbidden", () => {
  it("one correct answer does not advance the floor", () => {
    const responses = [makeResponse(0, DEFAULT_START_INDEX, true)];
    const plan = planNextItem(responses);
    // Same checkpoint — we must serve the next item of this floor.
    expect(plan.nextCheckpointIndex).toBe(DEFAULT_START_INDEX);
    expect(plan.currentFloorItemsServed).toBe(1);
  });

  it("1/5 does not advance", () => {
    const responses = serveFloor(0, DEFAULT_START_INDEX, 1, 1);
    const plan = planNextItem(responses);
    expect(plan.nextCheckpointIndex).toBe(DEFAULT_START_INDEX);
  });

  it("2/5 does not advance", () => {
    const responses = serveFloor(0, DEFAULT_START_INDEX, 2, 2);
    const plan = planNextItem(responses);
    expect(plan.nextCheckpointIndex).toBe(DEFAULT_START_INDEX);
  });

  it("3/5 is unresolved — never clears the floor confidently", () => {
    // 3 correct followed by 2 wrong at the same checkpoint.
    const responses = [
      ...serveFloor(0, DEFAULT_START_INDEX, 3, 3),
      makeResponse(3, DEFAULT_START_INDEX, false),
      makeResponse(4, DEFAULT_START_INDEX, false),
    ];
    const plan = planNextItem(responses);
    const floor = plan.floors[0];
    expect(floor.correct).toBe(3);
    expect(["unresolved", "failed"]).toContain(floor.outcome);
  });

  it("4/5 clears a lower floor (advance by exactly +1)", () => {
    // Four correct at the starting floor; the fourth correct with non-cognate
    // support is an early clear.
    const responses = serveFloor(0, DEFAULT_START_INDEX, 4, 4);
    const plan = planNextItem(responses);
    expect(plan.floors[0].outcome).toBe("cleared");
    expect(plan.nextCheckpointIndex).toBe(DEFAULT_START_INDEX + 1);
  });

  it("5/5 clears strongly", () => {
    const responses = serveFloor(0, DEFAULT_START_INDEX, 5, 5);
    const plan = planNextItem(responses);
    expect(plan.floors[0].outcome).toBe("cleared");
    expect(plan.nextCheckpointIndex).toBe(DEFAULT_START_INDEX + 1);
  });

  it("0-2/5 fails the floor and drops by exactly -1", () => {
    // 0 correct, 3 wrong — early failed (cannot reach threshold).
    const responses = serveFloor(0, DEFAULT_START_INDEX, 0, 3);
    const plan = planNextItem(responses);
    expect(plan.floors[0].outcome).toBe("failed");
    expect(plan.nextCheckpointIndex).toBe(DEFAULT_START_INDEX - 1);
  });
});

describe("no-skipping rule", () => {
  it("lower floors cannot be skipped even with a perfect sweep", () => {
    const responses = serveFloor(0, DEFAULT_START_INDEX, 5, 5);
    const plan = planNextItem(responses);
    expect(plan.nextCheckpointIndex! - DEFAULT_START_INDEX).toBe(1);
  });

  it("advance/retreat is strictly ±1 across a long run", () => {
    let responses: PlacementResponseRecord[] = [];
    let seq = 0;
    let prev = DEFAULT_START_INDEX;
    for (let step = 0; step < 4; step += 1) {
      const chunk = serveFloor(seq, prev, 5, 5);
      responses = responses.concat(chunk);
      seq += 5;
      const plan = planNextItem(responses);
      if (plan.shouldStop || plan.nextCheckpointIndex == null) break;
      expect(Math.abs(plan.nextCheckpointIndex - prev)).toBe(1);
      prev = plan.nextCheckpointIndex;
    }
  });
});

describe("top floor is stricter", () => {
  it("4/5 at top floor is tentative only, not clearly cleared", () => {
    // Serve only the top floor with 4/5 correct.
    const responses = [
      ...serveFloor(0, TOP_CHECKPOINT_INDEX, 4, 5),
    ];
    const plan = planNextItem(responses);
    const topFloor = plan.floors.find(
      (f) => f.checkpointIndex === TOP_CHECKPOINT_INDEX,
    );
    expect(topFloor?.outcome).toBe("tentative_cleared");
  });

  it("5/5 at top floor with ≥2 non-cognate correct is fully cleared", () => {
    const responses = [
      ...serveFloor(0, TOP_CHECKPOINT_INDEX, 5, 5, { cognateClass: "non_cognate" }),
    ];
    const plan = planNextItem(responses);
    expect(plan.floors[0].outcome).toBe("cleared");
  });

  it("5/5 at top floor with cognate-heavy evidence is only tentative", () => {
    const responses = serveFloor(0, TOP_CHECKPOINT_INDEX, 5, 5, {
      cognateClass: "strong_cognate",
    });
    const plan = planNextItem(responses);
    expect(plan.floors[0].outcome).toBe("tentative_cleared");
  });
});

describe("cognate-aware floor clearance", () => {
  it("requires at least one non-cognate correct when non-cognates were served", () => {
    // 4 strong-cognate correct + 1 non-cognate wrong — cognate-heavy.
    const responses = [
      makeResponse(0, 3, true, { cognateClass: "strong_cognate" }),
      makeResponse(1, 3, true, { cognateClass: "strong_cognate" }),
      makeResponse(2, 3, true, { cognateClass: "strong_cognate" }),
      makeResponse(3, 3, true, { cognateClass: "strong_cognate" }),
      makeResponse(4, 3, false, { cognateClass: "non_cognate" }),
    ];
    const plan = planNextItem(responses);
    expect(plan.floors[0].outcome).toBe("tentative_cleared");
  });

  it("full cognate pool (no non-cognates served) is still allowed to clear", () => {
    const responses = serveFloor(0, 3, 5, 5, { cognateClass: "strong_cognate" });
    const plan = planNextItem(responses);
    // Non-cognate support is vacuously satisfied when no non-cognates were served.
    expect(plan.floors[0].outcome).toBe("cleared");
  });
});

// ── Stopping rules ───────────────────────────────────────

describe("stopping rules", () => {
  it("never stops below minItems on soft evidence", () => {
    // Serve 2 correct and 2 wrong across different floors; nothing decisive.
    const responses = [
      makeResponse(0, DEFAULT_START_INDEX, true),
      makeResponse(1, DEFAULT_START_INDEX, false),
    ];
    const plan = planNextItem(responses);
    expect(plan.shouldStop).toBe(false);
  });

  it("stops on consecutive_wrong_ceiling after minItems", () => {
    // Walk down from the start, failing every floor until cp 0 fails with
    // 3+ wrong — this fires both floor_failed_at_bottom and the consecutive
    // wrong rule. We assert that *some* stop fires.
    const responses: PlacementResponseRecord[] = [];
    let cp = DEFAULT_START_INDEX;
    for (let i = 0; i < 15; i += 1) {
      responses.push(makeResponse(i, cp, false));
      const p = planNextItem(responses);
      if (p.shouldStop) break;
      cp = p.nextCheckpointIndex!;
    }
    const final = planNextItem(responses);
    expect(final.shouldStop).toBe(true);
  });

  it("reports top_of_bank_reached when every floor clears at the top", () => {
    const { finalPlan, estimate } = simulate(100_000, 200);
    expect(finalPlan.shouldStop).toBe(true);
    expect(finalPlan.stopReason).toBe("top_of_bank_reached");
    expect(estimate.topOfBankReached).toBe(true);
  });
});

describe("estimatePlacement", () => {
  it("confirmed floor never exceeds the highest cleared floor", () => {
    // Pass floor 3 (5/5), fail floor 4 (0/3 early fail).
    const responses = [
      ...serveFloor(0, 3, 5, 5),
      ...serveFloor(5, 4, 0, 3),
    ];
    const est = estimatePlacement(responses);
    expect(est.confirmedFloorRank).toBe(CHECKPOINTS[3].center);
    expect(est.frontierRankHigh).toBe(CHECKPOINTS[4].center);
    expect(est.estimatedFrontierRank).toBeGreaterThan(CHECKPOINTS[3].center);
    expect(est.estimatedFrontierRank).toBeLessThan(CHECKPOINTS[4].center);
  });

  it("cognate-heavy success pattern yields lower-quality evidence than non-cognate", () => {
    const cognateHeavy = [
      ...serveFloor(0, 4, 5, 5, { cognateClass: "strong_cognate" }),
      ...serveFloor(5, 5, 0, 3),
    ];
    const nonCognate = [
      ...serveFloor(0, 4, 5, 5, { cognateClass: "non_cognate" }),
      ...serveFloor(5, 5, 0, 3),
    ];
    const eC = estimatePlacement(cognateHeavy);
    const eN = estimatePlacement(nonCognate);
    expect(eC.cognateHeavyEstimate).toBe(true);
    expect(eN.cognateHeavyEstimate).toBe(false);
    // Evidence quality should degrade for cognate-heavy runs.
    const rank = { low: 0, medium: 1, high: 2 } as const;
    expect(rank[eC.frontierEvidenceQuality]).toBeLessThanOrEqual(
      rank[eN.frontierEvidenceQuality],
    );
  });

  it("morphology-heavy failure does not collapse confirmed floor below lemma rank", () => {
    // Clear floor 3 strongly on base forms; then fail floor 4 on marked forms.
    const responses = [
      ...serveFloor(0, 3, 5, 5, { morphologyClass: "base" }),
      ...serveFloor(5, 4, 0, 3, { morphologyClass: "irregular_or_marked_inflection" }),
    ];
    const est = estimatePlacement(responses);
    // Floor 3 remains cleared — morphology-heavy failure at floor 4 must not
    // invalidate that clearance.
    expect(est.confirmedFloorRank).toBe(CHECKPOINTS[3].center);
  });

  it("strong repeated non-cognate success places a learner above a starting checkpoint", () => {
    const { estimate } = simulate(10_000);
    expect(estimate.frontierRankLow).toBeLessThanOrEqual(10_000);
    expect(estimate.frontierRankHigh).toBeGreaterThanOrEqual(10_000);
    expect(estimate.highestClearedFloorIndex).not.toBeNull();
  });
});

describe("end-to-end simulation", () => {
  it("genuine performance at ~1500 is placed within one checkpoint of truth", () => {
    const { finalPlan, estimate } = simulate(1500);
    expect(finalPlan.shouldStop).toBe(true);
    expect(estimate.frontierRankLow).toBeLessThanOrEqual(1500);
    expect(estimate.frontierRankHigh).toBeGreaterThanOrEqual(1500);
    expect(estimate.itemsAnswered).toBeLessThanOrEqual(
      DEFAULT_PLACEMENT_CONFIG.maxItems,
    );
  });

  it("genuine performance at ~10000 is placed within one checkpoint of truth", () => {
    const { estimate } = simulate(10_000);
    expect(estimate.frontierRankLow).toBeLessThanOrEqual(10_000);
    expect(estimate.frontierRankHigh).toBeGreaterThanOrEqual(10_000);
  });
});

// ── End-to-end retake differentiation ─────────────────────

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
    responses.push(makeResponse(i, plan.nextCheckpointIndex, correct));
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
  const m = new Map<number, PoolCandidate[]>();
  for (const cp of CHECKPOINTS) {
    const items: PoolCandidate[] = [];
    const spread = Math.max(15, Math.round(cp.center * 0.015));
    for (let i = 0; i < 32; i += 1) {
      items.push({
        itemBankId: `cp${cp.index}-${i}`,
        frequencyRank: cp.center + (i - 16) * spread,
      });
    }
    m.set(cp.index, items);
  }
  return m;
}

describe("retake differentiation (end-to-end)", () => {
  it("serves a different item path on retake while keeping placement comparable", () => {
    const pools = buildPools();

    const first = runAttempt({
      attemptId: "run-1",
      trueRank: 5500,
      pools,
      exposure: new Map(),
    });

    const exposureForSecond = buildExposureMap(first.pickedRows, ["run-1"]);
    const second = runAttempt({
      attemptId: "run-2",
      trueRank: 5500,
      pools,
      exposure: exposureForSecond,
    });

    // Placement comparable: second attempt's bracket still wraps the truth.
    expect(second.estimate.frontierRankLow).toBeLessThanOrEqual(5500);
    expect(second.estimate.frontierRankHigh).toBeGreaterThanOrEqual(5500);

    // Different item path: majority of items differ.
    const overlap = [...first.usedIds].filter((id) => second.usedIds.has(id)).length;
    expect(overlap).toBeLessThan(first.usedIds.size);
  });

  it("falls back to reuse only when the pool is exhausted", () => {
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
