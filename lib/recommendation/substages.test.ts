import { describe, expect, it } from "vitest";
import {
  MAX_SUBSTAGE,
  MIN_SUBSTAGE,
  PASSAGE_MODE_ORDER,
  type Candidate,
  type PassageMode,
  getNearbyModes,
  getNearbySubstages,
  pickFromBucketAndMode,
  rankToSubstageIndex,
  targetToPassageMode,
} from "./substages";

describe("rankToSubstageIndex", () => {
  it("null → 1", () => {
    expect(rankToSubstageIndex(null)).toBe(1);
  });
  it("undefined → 1", () => {
    expect(rankToSubstageIndex(undefined)).toBe(1);
  });
  it("NaN → 1", () => {
    expect(rankToSubstageIndex(Number.NaN)).toBe(1);
  });
  it("negative → 1", () => {
    expect(rankToSubstageIndex(-50)).toBe(1);
  });
  it("0 → 1 (lowest possible bucket)", () => {
    expect(rankToSubstageIndex(0)).toBe(1);
  });
  it("100 → 1 (mid stage_01)", () => {
    expect(rankToSubstageIndex(100)).toBe(1);
  });
  it("150 → 1 (boundary inclusive)", () => {
    expect(rankToSubstageIndex(150)).toBe(1);
  });
  it("151 → 2 (just past boundary)", () => {
    expect(rankToSubstageIndex(151)).toBe(2);
  });
  it("1500 → 5 (A1++ upper boundary)", () => {
    expect(rankToSubstageIndex(1500)).toBe(5);
  });
  it("1501 → 6 (A2-- lower)", () => {
    expect(rankToSubstageIndex(1501)).toBe(6);
  });
  it("9200 → 15 (B1++ upper boundary)", () => {
    expect(rankToSubstageIndex(9200)).toBe(15);
  });
  it("35000 → 30 (top of table)", () => {
    expect(rankToSubstageIndex(35000)).toBe(30);
  });
  it("35001 → 30 (clamped)", () => {
    expect(rankToSubstageIndex(35001)).toBe(30);
  });
  it("100000 → 30 (clamped, very large)", () => {
    expect(rankToSubstageIndex(100000)).toBe(30);
  });
});

describe("targetToPassageMode", () => {
  it("null → short", () => {
    expect(targetToPassageMode(null)).toBe("short");
  });
  it("undefined → short", () => {
    expect(targetToPassageMode(undefined)).toBe("short");
  });
  it("NaN → short", () => {
    expect(targetToPassageMode(Number.NaN)).toBe("short");
  });
  it("negative → short (defensive)", () => {
    expect(targetToPassageMode(-5)).toBe("short");
  });
  it("0 → short", () => {
    expect(targetToPassageMode(0)).toBe("short");
  });
  it("30 → short (boundary inclusive)", () => {
    expect(targetToPassageMode(30)).toBe("short");
  });
  it("31 → medium", () => {
    expect(targetToPassageMode(31)).toBe("medium");
  });
  it("70 → medium (boundary inclusive)", () => {
    expect(targetToPassageMode(70)).toBe("medium");
  });
  it("71 → long", () => {
    expect(targetToPassageMode(71)).toBe("long");
  });
  it("130 → long (boundary inclusive)", () => {
    expect(targetToPassageMode(130)).toBe("long");
  });
  it("131 → very_long", () => {
    expect(targetToPassageMode(131)).toBe("very_long");
  });
  it("9999 → very_long (no upper bound)", () => {
    expect(targetToPassageMode(9999)).toBe("very_long");
  });
});

describe("getNearbySubstages", () => {
  it("from middle stage 15: symmetric interleaved walk reaching both ends", () => {
    const result = getNearbySubstages(15);
    expect(result.slice(0, 7)).toEqual([15, 14, 16, 13, 17, 12, 18]);
    expect(result).toHaveLength(MAX_SUBSTAGE);
    expect(new Set(result).size).toBe(MAX_SUBSTAGE);
    expect(result[result.length - 1]).toBe(30);
  });
  it("from stage 1: walks upward only", () => {
    const result = getNearbySubstages(1);
    expect(result).toEqual(
      Array.from({ length: MAX_SUBSTAGE }, (_, i) => i + 1),
    );
  });
  it("from stage 30: walks downward only", () => {
    const result = getNearbySubstages(30);
    expect(result).toEqual(
      Array.from({ length: MAX_SUBSTAGE }, (_, i) => MAX_SUBSTAGE - i),
    );
  });
  it("clamps out-of-range input upward", () => {
    expect(getNearbySubstages(50)[0]).toBe(MAX_SUBSTAGE);
  });
  it("clamps out-of-range input downward", () => {
    expect(getNearbySubstages(-5)[0]).toBe(MIN_SUBSTAGE);
  });
});

describe("getNearbyModes", () => {
  it("short → [short, medium, long, very_long]", () => {
    expect(getNearbyModes("short")).toEqual([
      "short",
      "medium",
      "long",
      "very_long",
    ]);
  });
  it("medium → [medium, short, long, very_long]", () => {
    expect(getNearbyModes("medium")).toEqual([
      "medium",
      "short",
      "long",
      "very_long",
    ]);
  });
  it("long → [long, medium, very_long, short]", () => {
    expect(getNearbyModes("long")).toEqual([
      "long",
      "medium",
      "very_long",
      "short",
    ]);
  });
  it("very_long → [very_long, long, medium, short]", () => {
    expect(getNearbyModes("very_long")).toEqual([
      "very_long",
      "long",
      "medium",
      "short",
    ]);
  });
  it("returns all 4 modes for any input", () => {
    for (const m of PASSAGE_MODE_ORDER) {
      const result = getNearbyModes(m);
      expect(result).toHaveLength(4);
      expect(new Set(result).size).toBe(4);
    }
  });
});

// ── pickFromBucketAndMode ──────────────────────────────────

type Cand = Candidate & { _label?: string };

const makeCand = (
  id: string,
  stageIndex: number | null,
  passageMode: PassageMode | null,
  passageNumber: number | null,
): Cand => ({
  id,
  stageIndex,
  passageMode,
  passageNumber: passageNumber ?? undefined,
});

describe("pickFromBucketAndMode", () => {
  it("empty candidate list returns null", () => {
    expect(
      pickFromBucketAndMode({
        rank: 500,
        target: 20,
        candidates: [],
        excludedIds: new Set(),
      }),
    ).toBeNull();
  });

  it("Phase 1: exact match (substage and mode) wins", () => {
    const target = makeCand("hit", 3, "short", 1);
    const wrong = makeCand("wrong", 5, "long", 1);
    const result = pickFromBucketAndMode({
      rank: 500,
      target: 20,
      candidates: [wrong, target],
      excludedIds: new Set(),
    });
    expect(result?.id).toBe("hit");
  });

  it("Phase 1 tiebreak: lowest passageNumber within bucket", () => {
    const p3 = makeCand("p3", 3, "short", 3);
    const p1 = makeCand("p1", 3, "short", 1);
    const p7 = makeCand("p7", 3, "short", 7);
    const result = pickFromBucketAndMode({
      rank: 500,
      target: 20,
      candidates: [p3, p1, p7],
      excludedIds: new Set(),
    });
    expect(result?.id).toBe("p1");
  });

  it("excluded id is skipped", () => {
    const a = makeCand("a", 3, "short", 1);
    const b = makeCand("b", 3, "short", 2);
    const result = pickFromBucketAndMode({
      rank: 500,
      target: 20,
      candidates: [a, b],
      excludedIds: new Set(["a"]),
    });
    expect(result?.id).toBe("b");
  });

  it("Phase 2: same substage with alternative mode when desired mode missing", () => {
    // rank 500 → stage 3, target 20 → short. No short at stage 3, but medium exists.
    const med = makeCand("med", 3, "medium", 1);
    const result = pickFromBucketAndMode({
      rank: 500,
      target: 20,
      candidates: [med],
      excludedIds: new Set(),
    });
    expect(result?.id).toBe("med");
  });

  it("Phase 3: nearby substage with desired mode beats Phase 4 cross product", () => {
    // rank 500 → stage 3, target 20 → short.
    // No (3, short). At (4, short) and (3, medium-via-phase-2 — nope, only "long" present).
    // Phase 2 doesn't fire (no other mode at stage 3 in this test setup).
    // Phase 3: nearby substages with desired short → tries 2 (no), 4 (yes).
    const stage4short = makeCand("s4short", 4, "short", 1);
    const stage5medium = makeCand("s5med", 5, "medium", 1);
    const result = pickFromBucketAndMode({
      rank: 500,
      target: 20,
      candidates: [stage4short, stage5medium],
      excludedIds: new Set(),
    });
    expect(result?.id).toBe("s4short");
  });

  it("Phase 2 priority: same substage with adjacent mode beats nearby substage with desired mode", () => {
    // rank 500 → stage 3, target 20 → short.
    // (3, medium) exists — Phase 2 picks it before Phase 3 finds (4, short).
    const stage3med = makeCand("s3med", 3, "medium", 1);
    const stage4short = makeCand("s4short", 4, "short", 1);
    const result = pickFromBucketAndMode({
      rank: 500,
      target: 20,
      candidates: [stage4short, stage3med],
      excludedIds: new Set(),
    });
    expect(result?.id).toBe("s3med");
  });

  it("Phase 4: cross product when no exact / phase-2 / phase-3 match", () => {
    // rank 500 → stage 3, target 20 → short.
    // Only candidate: (5, very_long). Phase 4 cross product reaches it.
    const farFar = makeCand("farfar", 5, "very_long", 1);
    const result = pickFromBucketAndMode({
      rank: 500,
      target: 20,
      candidates: [farFar],
      excludedIds: new Set(),
    });
    expect(result?.id).toBe("farfar");
  });

  it("returns null when every candidate is excluded", () => {
    const a = makeCand("a", 3, "short", 1);
    const b = makeCand("b", 5, "very_long", 1);
    const result = pickFromBucketAndMode({
      rank: 500,
      target: 20,
      candidates: [a, b],
      excludedIds: new Set(["a", "b"]),
    });
    expect(result).toBeNull();
  });

  it("defensive: candidate with null stageIndex is skipped", () => {
    const broken = makeCand("broken", null, "short", 1);
    const good = makeCand("good", 4, "short", 1);
    const result = pickFromBucketAndMode({
      rank: 500,
      target: 20,
      candidates: [broken, good],
      excludedIds: new Set(),
    });
    expect(result?.id).toBe("good");
  });

  it("defensive: candidate with null passageMode is skipped", () => {
    const broken = makeCand("broken", 3, null, 1);
    const good = makeCand("good", 4, "short", 1);
    const result = pickFromBucketAndMode({
      rank: 500,
      target: 20,
      candidates: [broken, good],
      excludedIds: new Set(),
    });
    expect(result?.id).toBe("good");
  });

  it("defensive: candidate with null passageNumber is skipped", () => {
    const broken = makeCand("broken", 3, "short", null);
    const good = makeCand("good", 4, "short", 1);
    const result = pickFromBucketAndMode({
      rank: 500,
      target: 20,
      candidates: [broken, good],
      excludedIds: new Set(),
    });
    expect(result?.id).toBe("good");
  });

  it("preserves the original payload via T extends Candidate", () => {
    type Wrapped = Candidate & { extra: string };
    const wrapped: Wrapped = {
      id: "w",
      stageIndex: 3,
      passageMode: "short",
      passageNumber: 1,
      extra: "preserved",
    };
    const result = pickFromBucketAndMode<Wrapped>({
      rank: 500,
      target: 20,
      candidates: [wrapped],
      excludedIds: new Set(),
    });
    expect(result?.extra).toBe("preserved");
  });
});
