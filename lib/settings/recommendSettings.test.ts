import { describe, expect, it } from "vitest";
import {
  ACCURACY_REFERENCE,
  ANCHOR,
  CARD_TYPE_WEIGHTS,
  CEILING,
  FLOOR,
  computeRecommendedTarget,
  computeSmoothedAccuracy,
  computeWeightedAccuracy,
  type ReviewEventForAccuracy,
} from "./recommendSettings";

describe("computeWeightedAccuracy", () => {
  it("returns null for empty events", () => {
    expect(computeWeightedAccuracy([])).toBeNull();
  });

  it("weights cloze (1.7) and normal (1.1) so raw 50% becomes a lower weighted value", () => {
    // Two cloze all wrong; two normal all right. Raw accuracy = 2/4 = 0.50.
    const events: ReviewEventForAccuracy[] = [
      { card_type: "cloze", correct: false },
      { card_type: "cloze", correct: false },
      { card_type: "normal", correct: true },
      { card_type: "normal", correct: true },
    ];
    const weighted = computeWeightedAccuracy(events)!;
    // Expected: (1.1 + 1.1) / (1.7 + 1.7 + 1.1 + 1.1) = 2.2 / 5.6 ≈ 0.3929
    expect(weighted).toBeCloseTo(2.2 / (2 * CARD_TYPE_WEIGHTS.cloze + 2 * CARD_TYPE_WEIGHTS.normal), 6);
    expect(weighted).toBeLessThan(0.5);
  });

  it("applies weights symmetrically (swap which side is correct)", () => {
    const events: ReviewEventForAccuracy[] = [
      { card_type: "cloze", correct: true },
      { card_type: "cloze", correct: true },
      { card_type: "normal", correct: false },
      { card_type: "normal", correct: false },
    ];
    const weighted = computeWeightedAccuracy(events)!;
    expect(weighted).toBeGreaterThan(0.5);
  });

  it("falls back to weight 1.0 for unknown card_type (defensive)", () => {
    const events: ReviewEventForAccuracy[] = [
      { card_type: "nonsense", correct: true },
      { card_type: "nonsense", correct: false },
    ];
    expect(computeWeightedAccuracy(events)).toBeCloseTo(0.5, 6);
  });
});

describe("computeRecommendedTarget", () => {
  it("fresh user (no weighted accuracy, no inactivity) returns ANCHOR", () => {
    expect(
      computeRecommendedTarget({ weightedAccuracy: null, daysSinceLast: 0 }),
    ).toBe(ANCHOR);
  });

  it("neutral accuracy (matches ACCURACY_REFERENCE) and no inactivity returns ANCHOR", () => {
    expect(
      computeRecommendedTarget({
        weightedAccuracy: ACCURACY_REFERENCE,
        daysSinceLast: 0,
      }),
    ).toBe(ANCHOR);
  });

  it("perfect accuracy (1.0) and no inactivity returns a value in [72, 76]", () => {
    const target = computeRecommendedTarget({
      weightedAccuracy: 1.0,
      daysSinceLast: 0,
    });
    expect(target).toBeGreaterThanOrEqual(72);
    expect(target).toBeLessThanOrEqual(76);
  });

  it("zero accuracy (0.0) and no inactivity returns FLOOR exactly", () => {
    expect(
      computeRecommendedTarget({ weightedAccuracy: 0.0, daysSinceLast: 0 }),
    ).toBe(FLOOR);
  });

  it("neutral accuracy and 7 days inactive returns a value strictly between FLOOR and ANCHOR", () => {
    const target = computeRecommendedTarget({
      weightedAccuracy: ACCURACY_REFERENCE,
      daysSinceLast: 7,
    });
    expect(target).toBeGreaterThan(FLOOR);
    expect(target).toBeLessThan(ANCHOR);
  });

  it("neutral accuracy and 21+ days inactive returns a value close to FLOOR", () => {
    const at21 = computeRecommendedTarget({
      weightedAccuracy: ACCURACY_REFERENCE,
      daysSinceLast: 21,
    });
    const at60 = computeRecommendedTarget({
      weightedAccuracy: ACCURACY_REFERENCE,
      daysSinceLast: 60,
    });
    // With 67% max penalty, neutral anchor collapses to ~10 after 21 days.
    expect(at21).toBeLessThanOrEqual(FLOOR + 2);
    expect(at60).toBeLessThanOrEqual(FLOOR + 2);
  });

  it("perfect accuracy and 21+ days inactive stays well below the no-inactivity peak", () => {
    const peak = computeRecommendedTarget({
      weightedAccuracy: 1.0,
      daysSinceLast: 0,
    });
    const decayed = computeRecommendedTarget({
      weightedAccuracy: 1.0,
      daysSinceLast: 21,
    });
    // peak is ~149; decayed should be well below it (inactivity multiplier ~0.33)
    expect(decayed).toBeLessThan(peak);
    expect(decayed).toBeLessThan(peak * 0.5);
  });

  it("clamps to CEILING for extreme upward moves (guardrail)", () => {
    const target = computeRecommendedTarget({
      weightedAccuracy: 1.0,
      daysSinceLast: 0,
    });
    expect(target).toBeLessThanOrEqual(CEILING);
  });

  it("treats negative daysSinceLast as zero (defensive)", () => {
    expect(
      computeRecommendedTarget({
        weightedAccuracy: ACCURACY_REFERENCE,
        daysSinceLast: -5,
      }),
    ).toBe(ANCHOR);
  });
});

describe("computeSmoothedAccuracy", () => {
  it("returns null for empty events", () => {
    expect(computeSmoothedAccuracy([])).toBeNull();
  });

  it("pulls a low-evidence 100%-correct user strongly toward ACCURACY_REFERENCE", () => {
    // 5 cloze events (weight 1.7 each → total weight 8.5) all correct.
    // smoothed = (8.5*1 + 20*0.85)/(8.5+20) = 25.5/28.5 ≈ 0.8947
    const events: ReviewEventForAccuracy[] = Array.from({ length: 5 }, () => ({
      card_type: "cloze",
      correct: true,
    }));
    const smoothed = computeSmoothedAccuracy(events)!;
    expect(smoothed).toBeCloseTo(0.8947, 3);
    expect(smoothed).toBeGreaterThan(ACCURACY_REFERENCE);
    expect(smoothed).toBeLessThan(1.0);
    // Distance to prior is much smaller than distance to raw.
    expect(Math.abs(smoothed - ACCURACY_REFERENCE)).toBeLessThan(
      Math.abs(smoothed - 1.0),
    );
  });

  it("barely shifts a high-evidence 100%-correct user from the raw value", () => {
    // 100 normal events (weight 1.1 each → total weight 110) all correct.
    // smoothed = (110*1 + 20*0.85)/(110+20) = 127/130 ≈ 0.9769
    const events: ReviewEventForAccuracy[] = Array.from({ length: 100 }, () => ({
      card_type: "normal",
      correct: true,
    }));
    const smoothed = computeSmoothedAccuracy(events)!;
    expect(smoothed).toBeCloseTo(0.9769, 3);
    expect(smoothed).toBeGreaterThan(0.95);
    expect(1.0 - smoothed).toBeLessThan(0.05);
  });
});

describe("weighted-accuracy end-to-end: formula uses the weighted value, not raw", () => {
  it("target driven by weighted accuracy differs from target driven by raw accuracy", () => {
    // Same fixture as the weighting test above.
    const events: ReviewEventForAccuracy[] = [
      { card_type: "cloze", correct: false },
      { card_type: "cloze", correct: false },
      { card_type: "normal", correct: true },
      { card_type: "normal", correct: true },
    ];
    const weighted = computeWeightedAccuracy(events)!;
    const rawAccuracy = 0.5; // 2 correct / 4 total

    const targetFromWeighted = computeRecommendedTarget({
      weightedAccuracy: weighted,
      daysSinceLast: 0,
    });
    const targetFromRaw = computeRecommendedTarget({
      weightedAccuracy: rawAccuracy,
      daysSinceLast: 0,
    });

    // Weighted is below raw because the heavier card type (cloze) got wrong.
    // The target from weighted should therefore be lower than the target from raw.
    expect(weighted).toBeLessThan(rawAccuracy);
    expect(targetFromWeighted).toBeLessThan(targetFromRaw);
  });
});
