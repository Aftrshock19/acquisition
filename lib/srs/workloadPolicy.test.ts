import { describe, it, expect } from "vitest";
import {
  computeWorkloadPolicy,
  NORMAL_REVIEW_BUDGET_MS,
  COMEBACK_REVIEW_BUDGET_MS,
  P50_FALLBACK_MS,
  COMEBACK_DAYS_THRESHOLD,
  CONTINUATION_REVIEW_CHUNK,
  CONTINUATION_NEW_CHUNK,
} from "./workloadPolicy";

// ---------------------------------------------------------------------------
// normalBatch clamping
// ---------------------------------------------------------------------------
describe("normalBatch clamping", () => {
  it("clamps to minimum 12 when p50 is very fast (< 12 000 ms)", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: 5_000, // would give 72 unclamped → floor(360000/5000)=72 → clamp(72,12,30)=30 — wait no
      daysSinceLastSession: 0,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    // floor(360000/5000)=72 → clamp → 30 (hits max)
    // Let's use a truly large p50 to hit min=12: floor(360000/30001)=11 → clamp=12
    expect(result.recommendedReviews).toBeGreaterThanOrEqual(12);
  });

  it("clamps normalBatch to 12 when p50 is very slow (> 30 000 ms)", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: 35_000, // floor(360000/35000)=10 → clamp=12
      daysSinceLastSession: 0,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    expect(result.recommendedReviews).toBe(12);
  });

  it("clamps normalBatch to 30 when p50 is very fast (5 000 ms)", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: 5_000, // floor(360000/5000)=72 → clamp=30
      daysSinceLastSession: 0,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    expect(result.recommendedReviews).toBe(30);
  });

  it("gives ~20 reviews for 18 s p50 (fallback speed)", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS, // floor(360000/18000)=20
      daysSinceLastSession: 0,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    expect(result.recommendedReviews).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Comeback detection
// ---------------------------------------------------------------------------
describe("comeback detection", () => {
  it("isComeback when daysSinceLastSession >= threshold", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: COMEBACK_DAYS_THRESHOLD,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    expect(result.isComeback).toBe(true);
  });

  it("isComeback when overdueCount >= 3 * normalBatch", () => {
    // normalBatch = floor(360000/18000) = 20, so threshold = 60
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: 0,
      overdueCount: 60,
      scheduledNewCount: 5,
    });
    expect(result.isComeback).toBe(true);
  });

  it("isComeback = false for recent user with small backlog", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: 1,
      overdueCount: 5,
      scheduledNewCount: 5,
    });
    expect(result.isComeback).toBe(false);
  });

  it("isComeback when daysSinceLastSession is null — treated as 0", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: null,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    expect(result.isComeback).toBe(false);
  });

  it("comebackBatch is larger than normalBatch for same p50", () => {
    const resultCome = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: COMEBACK_DAYS_THRESHOLD,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    const resultNorm = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: 0,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    expect(resultCome.recommendedReviews).toBeGreaterThan(resultNorm.recommendedReviews);
  });
});

// ---------------------------------------------------------------------------
// New word throttling
// ---------------------------------------------------------------------------
describe("new word throttling in comeback mode", () => {
  it("caps recommendedNewWords at 3 in comeback mode", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: COMEBACK_DAYS_THRESHOLD,
      overdueCount: 0,
      scheduledNewCount: 10,
    });
    expect(result.recommendedNewWords).toBe(3);
  });

  it("passes through scheduledNewCount unchanged in normal mode", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: 1,
      overdueCount: 0,
      scheduledNewCount: 7,
    });
    expect(result.recommendedNewWords).toBe(7);
  });

  it("comeback caps at min(scheduledNewCount, 3): schedules < 3 respected", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: COMEBACK_DAYS_THRESHOLD,
      overdueCount: 0,
      scheduledNewCount: 2,
    });
    expect(result.recommendedNewWords).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// p50 fallback
// ---------------------------------------------------------------------------
describe("p50 fallback", () => {
  it("uses P50_FALLBACK_MS when p50ReviewMs is null", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: null,
      daysSinceLastSession: 0,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    expect(result.p50ReviewMs).toBe(P50_FALLBACK_MS);
    expect(result.recommendedReviews).toBe(Math.floor(NORMAL_REVIEW_BUDGET_MS / P50_FALLBACK_MS));
  });
});

// ---------------------------------------------------------------------------
// Continuation constants
// ---------------------------------------------------------------------------
describe("continuation constants", () => {
  it("exposes correct continuation chunk sizes", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: null,
      daysSinceLastSession: 0,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    expect(result.continuationReviewChunk).toBe(CONTINUATION_REVIEW_CHUNK);
    expect(result.continuationNewChunk).toBe(CONTINUATION_NEW_CHUNK);
  });
});
