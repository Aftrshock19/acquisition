import { describe, it, expect } from "vitest";
import {
  recallProbability,
  nextIntervalHours,
  updateEwma,
  updateHalfLife,
  exposureUpdateHalfLife,
} from "./math";
import { MIN_HALF_LIFE_HOURS, MAX_HALF_LIFE_HOURS } from "./constants";

describe("recallProbability", () => {
  it("returns 1 when delta is 0", () => {
    expect(recallProbability(0, 24)).toBe(1);
  });

  it("returns 0.5 when delta equals half_life", () => {
    const halfLife = 12;
    expect(recallProbability(halfLife, halfLife)).toBe(0.5);
  });

  it("returns lower probability for longer delta", () => {
    expect(recallProbability(1, 1)).toBe(0.5);
    expect(recallProbability(2, 1)).toBeLessThan(0.5);
    expect(recallProbability(0.5, 1)).toBeGreaterThan(0.5);
  });
});

describe("nextIntervalHours", () => {
  it("returns positive interval for target_p in (0,1)", () => {
    const hl = 24;
    const interval = nextIntervalHours(hl, 0.85);
    expect(interval).toBeGreaterThan(0);
    expect(interval).toBeCloseTo(24 * Math.log2(1 / 0.85), 10);
  });

  it("clamps target_p to allowed range", () => {
    const hl = 12;
    const low = nextIntervalHours(hl, 0.5);
    const high = nextIntervalHours(hl, 0.99);
    expect(low).toBe(nextIntervalHours(hl, 0.75));
    expect(high).toBe(nextIntervalHours(hl, 0.95));
  });
});

describe("updateEwma", () => {
  it("with alpha 0.5, prev 0, value 1 => 0.5", () => {
    expect(updateEwma(0, 1, 0.5)).toBe(0.5);
  });

  it("with alpha 1, returns value", () => {
    expect(updateEwma(100, 3, 1)).toBe(3);
  });

  it("with alpha 0, returns prev", () => {
    expect(updateEwma(5, 10, 0)).toBe(5);
  });
});

describe("updateHalfLife", () => {
  const baseParams = {
    halfLifeHours: 24,
    deltaHours: 24, // so pPred = 0.5
    ewmaSurprise: 0,
    ewmaAbsSurprise: 0,
    ewmaAccuracy: 1,
  };

  it("correct review increases half-life", () => {
    const result = updateHalfLife({
      ...baseParams,
      correct: true,
      grade: "good",
    });
    expect(result.halfLifeAfter).toBeGreaterThan(24);
    expect(result.pPred).toBeCloseTo(0.5, 5);
    expect(result.surprise).toBe(0.5);
  });

  it("incorrect review decreases half-life", () => {
    const result = updateHalfLife({
      ...baseParams,
      correct: false,
      grade: "again",
    });
    expect(result.halfLifeAfter).toBeLessThan(24);
    expect(result.surprise).toBeCloseTo(-0.5, 5);
  });

  it("halfLifeAfter is clamped to [min_hl, max_hl]", () => {
    const veryShort = updateHalfLife({
      halfLifeHours: 0.5,
      deltaHours: 100,
      correct: false,
      grade: "again",
      ewmaSurprise: 0,
      ewmaAbsSurprise: 1,
      ewmaAccuracy: 0.5,
    });
    expect(veryShort.halfLifeAfter).toBeGreaterThanOrEqual(MIN_HALF_LIFE_HOURS);
    const veryLong = updateHalfLife({
      halfLifeHours: 10000,
      deltaHours: 0.1,
      correct: true,
      grade: "easy",
      ewmaSurprise: 0,
      ewmaAbsSurprise: 0,
      ewmaAccuracy: 1,
    });
    expect(veryLong.halfLifeAfter).toBeLessThanOrEqual(MAX_HALF_LIFE_HOURS);
  });
});

describe("exposureUpdateHalfLife", () => {
  it("applies positive nudge (r=1) with weight", () => {
    const before = 12;
    const after = exposureUpdateHalfLife(before, 6, 0.85, 0.1, 0);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("returns value within [min_hl, max_hl]", () => {
    const result = exposureUpdateHalfLife(0.1, 100, 0.85, 0.25, 0);
    expect(result).toBeGreaterThanOrEqual(MIN_HALF_LIFE_HOURS);
    expect(result).toBeLessThanOrEqual(MAX_HALF_LIFE_HOURS);
  });
});
