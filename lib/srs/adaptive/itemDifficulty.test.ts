import { describe, it, expect } from "vitest";
import {
  computeColdStartPrior,
  blendDifficulty,
  difficultyToItemFactor,
  computeItemFactor,
  ITEM_FACTOR_MIN,
  ITEM_FACTOR_MAX,
  ITEM_FACTOR_NEUTRAL_DIFFICULTY,
  COLD_START_BASE,
  COLD_START_PRIOR_MIN,
  COLD_START_PRIOR_MAX,
  EVIDENCE_HALF_LIFE,
} from "./itemDifficulty";

describe("computeColdStartPrior", () => {
  it("returns BASE for null or invalid rank", () => {
    expect(computeColdStartPrior(null)).toBe(COLD_START_BASE);
    expect(computeColdStartPrior(undefined)).toBe(COLD_START_BASE);
    expect(computeColdStartPrior(0)).toBe(COLD_START_BASE);
    expect(computeColdStartPrior(-5)).toBe(COLD_START_BASE);
    expect(computeColdStartPrior(Number.NaN)).toBe(COLD_START_BASE);
  });

  it("gives lower prior for common words (low rank)", () => {
    const common = computeColdStartPrior(1);
    expect(common).toBeLessThan(COLD_START_BASE);
    expect(common).toBeGreaterThanOrEqual(COLD_START_PRIOR_MIN);
  });

  it("gives higher prior for rare words (high rank)", () => {
    const rare = computeColdStartPrior(20_000);
    expect(rare).toBeGreaterThan(COLD_START_BASE);
    expect(rare).toBeLessThanOrEqual(COLD_START_PRIOR_MAX);
  });

  it("is approximately neutral at reference rank (1500)", () => {
    expect(computeColdStartPrior(1499)).toBeCloseTo(COLD_START_BASE, 2);
  });

  it("is monotonic in rank", () => {
    const ranks = [1, 10, 100, 1000, 5000, 20_000];
    const priors = ranks.map((r) => computeColdStartPrior(r));
    for (let i = 1; i < priors.length; i++) {
      expect(priors[i]).toBeGreaterThanOrEqual(priors[i - 1]);
    }
  });
});

describe("blendDifficulty", () => {
  it("returns pure prior when evidenceCount is 0", () => {
    const blended = blendDifficulty({
      observedDifficulty: 0.9,
      coldStartPrior: 0.5,
      evidenceCount: 0,
    });
    expect(blended).toBeCloseTo(0.5, 6);
  });

  it("hits 50/50 at evidenceCount == half-life", () => {
    const blended = blendDifficulty({
      observedDifficulty: 0.8,
      coldStartPrior: 0.4,
      evidenceCount: EVIDENCE_HALF_LIFE,
    });
    expect(blended).toBeCloseTo(0.6, 6);
  });

  it("converges to observed with many reviews", () => {
    const blended = blendDifficulty({
      observedDifficulty: 0.9,
      coldStartPrior: 0.5,
      evidenceCount: 1000,
    });
    expect(blended).toBeGreaterThan(0.88);
  });

  it("falls back to prior when observed is null", () => {
    const blended = blendDifficulty({
      observedDifficulty: null,
      coldStartPrior: 0.5,
      evidenceCount: 10,
    });
    expect(blended).toBe(0.5);
  });
});

describe("difficultyToItemFactor", () => {
  it("returns 1.0 at neutral difficulty", () => {
    expect(difficultyToItemFactor(ITEM_FACTOR_NEUTRAL_DIFFICULTY)).toBeCloseTo(1.0, 6);
  });

  it("clamps to ITEM_FACTOR_MAX for very easy items", () => {
    expect(difficultyToItemFactor(0)).toBe(ITEM_FACTOR_MAX);
  });

  it("clamps to ITEM_FACTOR_MIN for very hard items", () => {
    expect(difficultyToItemFactor(1.0)).toBe(ITEM_FACTOR_MIN);
  });

  it("easier items get larger factor than harder", () => {
    expect(difficultyToItemFactor(0.3)).toBeGreaterThan(difficultyToItemFactor(0.8));
  });
});

describe("computeItemFactor pipeline", () => {
  it("is always within configured clamp range", () => {
    const cases = [
      { rank: 1, observedDifficulty: 0.1, evidenceCount: 0 },
      { rank: 1, observedDifficulty: 0.9, evidenceCount: 100 },
      { rank: 50_000, observedDifficulty: null, evidenceCount: 0 },
      { rank: null, observedDifficulty: 0.5, evidenceCount: 5 },
    ];
    for (const c of cases) {
      const { itemFactor } = computeItemFactor(c);
      expect(itemFactor).toBeGreaterThanOrEqual(ITEM_FACTOR_MIN);
      expect(itemFactor).toBeLessThanOrEqual(ITEM_FACTOR_MAX);
    }
  });
});
