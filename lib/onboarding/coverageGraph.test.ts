import { describe, expect, it } from "vitest";
import {
  COVERAGE_CORPUS_STATS,
  TOP_N_BUCKETS,
  bucketXPosition,
  coverageCurveSamples,
  coverageFractionForBucket,
  coverageGraphState,
} from "./coverageGraph";

describe("coverage graph helper", () => {
  it("exposes the expected bucket presets", () => {
    expect(TOP_N_BUCKETS).toEqual([100, 500, 1000, 2000, 5000]);
  });

  it("corpus stats look sane (non-empty real content)", () => {
    expect(COVERAGE_CORPUS_STATS.passages).toBeGreaterThan(50);
    expect(COVERAGE_CORPUS_STATS.totalTokens).toBeGreaterThan(1000);
    expect(COVERAGE_CORPUS_STATS.uniqueTypes).toBeGreaterThan(500);
  });

  it("coverage fraction is in [0,1] for every bucket", () => {
    for (const b of TOP_N_BUCKETS) {
      const f = coverageFractionForBucket(b);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it("coverage fraction is strictly increasing across buckets", () => {
    const fractions = TOP_N_BUCKETS.map(coverageFractionForBucket);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1]);
    }
  });

  it("smallest bucket shows strong early payoff (>25%)", () => {
    // Honesty: we don't assert a specific number, only that the real
    // corpus-derived value is visibly non-trivial.
    expect(coverageFractionForBucket(100)).toBeGreaterThan(0.25);
  });

  it("top bucket reaches high but plausible coverage (<1, >0.8)", () => {
    const top = coverageFractionForBucket(5000);
    expect(top).toBeGreaterThan(0.8);
    expect(top).toBeLessThanOrEqual(1);
  });

  it("coverageGraphState returns caption + percent for every bucket", () => {
    for (const b of TOP_N_BUCKETS) {
      const s = coverageGraphState(b);
      expect(s.bucket).toBe(b);
      expect(s.caption.length).toBeGreaterThan(10);
      expect(s.coverageFraction).toBeGreaterThan(0);
      expect(s.coverageFraction).toBeLessThanOrEqual(1);
      expect(s.coveragePercent).toBe(Math.round(s.coverageFraction * 100));
    }
  });

  it("captions are honest — no overclaiming language", () => {
    const forbidden = [
      /guaranteed/i,
      /every text/i,
      /full\s+comprehension/i,
      /understand everything/i,
    ];
    for (const b of TOP_N_BUCKETS) {
      const c = coverageGraphState(b).caption;
      for (const re of forbidden) {
        expect(c).not.toMatch(re);
      }
    }
  });

  it("captions differ across buckets", () => {
    const captions = new Set(
      TOP_N_BUCKETS.map((b) => coverageGraphState(b).caption),
    );
    expect(captions.size).toBe(TOP_N_BUCKETS.length);
  });

  it("curve samples are normalised to [0,1] on both axes", () => {
    const samples = coverageCurveSamples(40);
    expect(samples.length).toBe(40);
    expect(samples[0].x).toBeCloseTo(0);
    expect(samples[samples.length - 1].x).toBeCloseTo(1);
    for (const s of samples) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(1);
    }
  });

  it("curve is monotone non-decreasing in both x and y", () => {
    const samples = coverageCurveSamples(30);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].x).toBeGreaterThanOrEqual(samples[i - 1].x);
      expect(samples[i].y).toBeGreaterThanOrEqual(samples[i - 1].y);
    }
  });

  it("coverageCurveSamples clamps to >=2 samples", () => {
    expect(coverageCurveSamples(1).length).toBe(2);
    expect(coverageCurveSamples(0).length).toBe(2);
  });

  it("bucketXPosition grows with bucket, uses log scale, stays in (0,1]", () => {
    const positions = TOP_N_BUCKETS.map(bucketXPosition);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
    for (const p of positions) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    // Log scale keeps the first bucket well away from 0 (linear would give 0.02).
    expect(bucketXPosition(100)).toBeGreaterThan(0.4);
    expect(bucketXPosition(5000)).toBeCloseTo(1);
  });

  it("interpolating the curve at a bucket's x is close to its coverage fraction", () => {
    // The curve is sampled on log-rank; nearest precomputed sample may not
    // fall exactly on a bucket's log-rank position, so allow a small delta.
    for (const b of TOP_N_BUCKETS) {
      const targetX = bucketXPosition(b);
      const samples = coverageCurveSamples(200);
      const nearest = samples.reduce((best, s) =>
        Math.abs(s.x - targetX) < Math.abs(best.x - targetX) ? s : best,
      );
      expect(Math.abs(nearest.y - coverageFractionForBucket(b))).toBeLessThan(
        0.05,
      );
    }
  });
});
