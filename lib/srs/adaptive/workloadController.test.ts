import { describe, it, expect } from "vitest";
import {
  computeWorkloadFactor,
  WORKLOAD_FACTOR_MIN,
  WORKLOAD_FACTOR_MAX,
  WORKLOAD_FACTOR_NEUTRAL,
} from "./workloadController";

describe("computeWorkloadFactor", () => {
  it("returns neutral when sample size is 0", () => {
    const r = computeWorkloadFactor({
      learnerStateScore: 0,
      sampleSize: 0,
      completionRate: null,
      retryBurden: null,
      overdueCount: 0,
      expectedDailyLoad: 10,
    });
    expect(r.workloadFactor).toBe(WORKLOAD_FACTOR_NEUTRAL);
    expect(r.adaptiveNewWordCap(10)).toBe(10);
  });

  it("increases factor for strong learner, limited by max clamp", () => {
    const r = computeWorkloadFactor({
      learnerStateScore: 1.0,
      sampleSize: 3,
      completionRate: 1.0,
      retryBurden: 0.05,
      overdueCount: 0,
      expectedDailyLoad: 10,
    });
    expect(r.workloadFactor).toBeGreaterThan(WORKLOAD_FACTOR_NEUTRAL);
    expect(r.workloadFactor).toBeLessThanOrEqual(WORKLOAD_FACTOR_MAX);
  });

  it("decreases factor for weak learner", () => {
    const r = computeWorkloadFactor({
      learnerStateScore: -1.0,
      sampleSize: 3,
      completionRate: 0.5,
      retryBurden: 0.6,
      overdueCount: 100,
      expectedDailyLoad: 10,
    });
    expect(r.workloadFactor).toBeLessThan(WORKLOAD_FACTOR_NEUTRAL);
    expect(r.workloadFactor).toBeGreaterThanOrEqual(WORKLOAD_FACTOR_MIN);
  });

  it("poor completion rate blocks any increase above 1.0", () => {
    const r = computeWorkloadFactor({
      learnerStateScore: 1.0,
      sampleSize: 3,
      completionRate: 0.5,
      retryBurden: 0.05,
      overdueCount: 0,
      expectedDailyLoad: 10,
    });
    expect(r.workloadFactor).toBeLessThanOrEqual(WORKLOAD_FACTOR_NEUTRAL);
  });

  it("high retry burden blocks increases", () => {
    const r = computeWorkloadFactor({
      learnerStateScore: 1.0,
      sampleSize: 3,
      completionRate: 1.0,
      retryBurden: 0.7,
      overdueCount: 0,
      expectedDailyLoad: 10,
    });
    expect(r.workloadFactor).toBeLessThanOrEqual(WORKLOAD_FACTOR_NEUTRAL);
  });

  it("≥3 days of backlog reduces factor below neutral", () => {
    const r = computeWorkloadFactor({
      learnerStateScore: 0.5,
      sampleSize: 3,
      completionRate: 1.0,
      retryBurden: 0.1,
      overdueCount: 50, // 50/10 = 5 days of backlog
      expectedDailyLoad: 10,
    });
    expect(r.workloadFactor).toBeLessThan(WORKLOAD_FACTOR_NEUTRAL);
  });

  it("adaptiveNewWordCap scales baseline and rounds to integer", () => {
    const r = computeWorkloadFactor({
      learnerStateScore: -0.5,
      sampleSize: 3,
      completionRate: 0.6,
      retryBurden: 0.3,
      overdueCount: 0,
      expectedDailyLoad: 10,
    });
    const capped = r.adaptiveNewWordCap(10);
    expect(Number.isInteger(capped)).toBe(true);
    expect(capped).toBeLessThanOrEqual(10);
    expect(capped).toBeGreaterThanOrEqual(0);
  });
});
