import { describe, it, expect } from "vitest";

import {
  buildExposureMap,
  selectFromPool,
  seededRandom,
  type ExposureMap,
  type PoolCandidate,
  type PriorResponseRow,
} from "./exposure";

function pool(...rows: Array<[string, number]>): PoolCandidate[] {
  return rows.map(([itemBankId, frequencyRank]) => ({ itemBankId, frequencyRank }));
}

function emptyExposure(): ExposureMap {
  return new Map();
}

describe("seededRandom", () => {
  it("is deterministic for the same seed", () => {
    const a = seededRandom("seed-x");
    const b = seededRandom("seed-x");
    const av = [a(), a(), a()];
    const bv = [b(), b(), b()];
    expect(av).toEqual(bv);
  });

  it("differs across seeds", () => {
    const a = seededRandom("seed-1");
    const b = seededRandom("seed-2");
    expect(a()).not.toBe(b());
  });
});

describe("buildExposureMap", () => {
  const rows: PriorResponseRow[] = [
    { run_id: "run-2", item_bank_id: "i-A", answered_at: "2026-04-10T10:00:00Z" },
    { run_id: "run-2", item_bank_id: "i-B", answered_at: "2026-04-10T10:01:00Z" },
    { run_id: "run-1", item_bank_id: "i-A", answered_at: "2026-04-01T10:00:00Z" },
    { run_id: "run-1", item_bank_id: "i-C", answered_at: "2026-04-01T10:01:00Z" },
  ];
  const priorRuns = ["run-2", "run-1"];

  it("flags items from the immediately previous attempt", () => {
    const m = buildExposureMap(rows, priorRuns);
    expect(m.get("i-A")?.inImmediatePrevious).toBe(true);
    expect(m.get("i-B")?.inImmediatePrevious).toBe(true);
    expect(m.get("i-C")?.inImmediatePrevious).toBe(false);
  });

  it("counts distinct prior attempts per item", () => {
    const m = buildExposureMap(rows, priorRuns);
    expect(m.get("i-A")?.attemptCount).toBe(2);
    expect(m.get("i-C")?.attemptCount).toBe(1);
  });

  it("marks items in the recent 3-attempt window", () => {
    const m = buildExposureMap(rows, priorRuns);
    expect(m.get("i-A")?.inRecentWindow).toBe(true);
    expect(m.get("i-C")?.inRecentWindow).toBe(true);
  });

  it("ignores rows with no item_bank_id", () => {
    const m = buildExposureMap(
      [
        { run_id: "run-2", item_bank_id: null, answered_at: "2026-04-10T10:00:00Z" },
      ],
      priorRuns,
    );
    expect(m.size).toBe(0);
  });
});

describe("selectFromPool", () => {
  const sixItems = pool(
    ["a", 480],
    ["b", 500],
    ["c", 510],
    ["d", 520],
    ["e", 540],
    ["f", 560],
  );

  it("returns null on an empty pool", () => {
    const result = selectFromPool([], {
      targetRank: 500,
      excludeIds: new Set(),
      exposure: emptyExposure(),
      seed: "any",
    });
    expect(result).toBeNull();
  });

  it("hard-excludes items used in the current attempt", () => {
    const result = selectFromPool(sixItems, {
      targetRank: 500,
      excludeIds: new Set(["a", "b", "c", "d", "e"]),
      exposure: emptyExposure(),
      seed: "x",
    });
    expect(result?.pickedId).toBe("f");
  });

  it("prefers fresh items over previous-attempt items when both exist", () => {
    const exposure: ExposureMap = new Map([
      ["a", { attemptCount: 1, inImmediatePrevious: true, inRecentWindow: true, lastSeenAt: 0 }],
      ["b", { attemptCount: 1, inImmediatePrevious: true, inRecentWindow: true, lastSeenAt: 0 }],
    ]);
    const result = selectFromPool(sixItems, {
      targetRank: 500,
      excludeIds: new Set(),
      exposure,
      seed: "fresh-pref",
    });
    // The pick must come from {c,d,e,f}, not the previous-attempt items.
    expect(["c", "d", "e", "f"]).toContain(result?.pickedId);
    expect(result?.reuseDueToPoolExhaustion).toBe(false);
    expect(result?.previousAttemptSeen).toBe(false);
    expect(result?.trace.fallbackTier).toBe("fresh");
  });

  it("falls back to penalized_recent when no fully-fresh items exist", () => {
    const exposure: ExposureMap = new Map(
      sixItems.map((c) => [
        c.itemBankId,
        { attemptCount: 1, inImmediatePrevious: false, inRecentWindow: true, lastSeenAt: 0 },
      ]),
    );
    const result = selectFromPool(sixItems, {
      targetRank: 500,
      excludeIds: new Set(),
      exposure,
      seed: "pen",
    });
    expect(result?.reuseDueToPoolExhaustion).toBe(false);
    expect(result?.previousAttemptSeen).toBe(false);
    expect(result?.trace.fallbackTier).toBe("penalized_recent");
  });

  it("falls back to previous-attempt reuse only when forced", () => {
    const exposure: ExposureMap = new Map(
      sixItems.map((c) => [
        c.itemBankId,
        { attemptCount: 1, inImmediatePrevious: true, inRecentWindow: true, lastSeenAt: 0 },
      ]),
    );
    const result = selectFromPool(sixItems, {
      targetRank: 500,
      excludeIds: new Set(),
      exposure,
      seed: "stuck",
    });
    expect(result).not.toBeNull();
    expect(result!.reuseDueToPoolExhaustion).toBe(true);
    expect(result!.previousAttemptSeen).toBe(true);
    expect(result!.trace.fallbackTier).toBe("previous_attempt_reuse");
  });

  it("reproduces the same pick for the same seed", () => {
    const a = selectFromPool(sixItems, {
      targetRank: 500,
      excludeIds: new Set(),
      exposure: emptyExposure(),
      seed: "stable-seed",
    });
    const b = selectFromPool(sixItems, {
      targetRank: 500,
      excludeIds: new Set(),
      exposure: emptyExposure(),
      seed: "stable-seed",
    });
    expect(a?.pickedId).toBe(b?.pickedId);
  });

  it("varies its pick across different seeds (retake differentiation)", () => {
    // Across many seeds, we should see at least 2 distinct picks from the
    // top of the pool — proving retakes won't keep landing on the same item.
    const seen = new Set<string>();
    for (let i = 0; i < 24; i += 1) {
      const r = selectFromPool(sixItems, {
        targetRank: 500,
        excludeIds: new Set(),
        exposure: emptyExposure(),
        seed: `retake-${i}`,
      });
      if (r) seen.add(r.pickedId);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it("favours items closer to the target rank", () => {
    const wide = pool(
      ["far-low", 100],
      ["close-1", 495],
      ["close-2", 505],
      ["far-high", 1500],
    );
    // Run several seeds; the picker should never choose the far outliers.
    for (let i = 0; i < 20; i += 1) {
      const r = selectFromPool(wide, {
        targetRank: 500,
        excludeIds: new Set(),
        exposure: emptyExposure(),
        seed: `tgt-${i}`,
      });
      expect(["close-1", "close-2"]).toContain(r?.pickedId);
    }
  });
});
