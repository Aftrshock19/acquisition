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

  it("extremely slow reviewer (60 s) still gets minimum 12", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: 60_000, // floor(360000/60000)=6 → clamp=12
      daysSinceLastSession: 0,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    expect(result.recommendedReviews).toBe(12);
  });

  it("exactly at boundary: p50 = budget/30 gives 30", () => {
    const p50 = Math.floor(NORMAL_REVIEW_BUDGET_MS / 30); // =12000
    const result = computeWorkloadPolicy({
      p50ReviewMs: p50,
      daysSinceLastSession: 0,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    expect(result.recommendedReviews).toBe(30);
  });

  it("exactly at boundary: p50 = budget/12 gives 12", () => {
    const p50 = Math.floor(NORMAL_REVIEW_BUDGET_MS / 12); // =30000
    const result = computeWorkloadPolicy({
      p50ReviewMs: p50,
      daysSinceLastSession: 0,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    expect(result.recommendedReviews).toBe(12);
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

  it("comeback triggers with zero overdue if absent >= threshold", () => {
    // Pure absence trigger: no backlog at all, just 7 days away
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: 14,
      overdueCount: 0,
      scheduledNewCount: 10,
    });
    expect(result.isComeback).toBe(true);
    // New words should still be throttled
    expect(result.recommendedNewWords).toBe(3);
  });

  it("overdueCount threshold scales with p50 — fast reviewer needs more overdue", () => {
    // Fast reviewer: normalBatch = 30, threshold = 90
    const fast = computeWorkloadPolicy({
      p50ReviewMs: 5_000,
      daysSinceLastSession: 0,
      overdueCount: 89,
      scheduledNewCount: 5,
    });
    expect(fast.isComeback).toBe(false); // 89 < 90

    // Slow reviewer: normalBatch = 12, threshold = 36
    const slow = computeWorkloadPolicy({
      p50ReviewMs: 35_000,
      daysSinceLastSession: 0,
      overdueCount: 36,
      scheduledNewCount: 5,
    });
    expect(slow.isComeback).toBe(true); // 36 >= 36
  });

  it("overdueCount exactly at 3*normalBatch triggers comeback", () => {
    // normalBatch = floor(360000/18000) = 20, threshold = 60
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: 0,
      overdueCount: 60,
      scheduledNewCount: 5,
    });
    expect(result.isComeback).toBe(true);
  });

  it("overdueCount one below 3*normalBatch does NOT trigger comeback", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: 0,
      overdueCount: 59,
      scheduledNewCount: 5,
    });
    expect(result.isComeback).toBe(false);
  });

  it("daysSinceLastSession exactly 6 does NOT trigger comeback", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: 6,
      overdueCount: 0,
      scheduledNewCount: 5,
    });
    expect(result.isComeback).toBe(false);
  });

  it("absent 30 days with huge overdue: both triggers fire, caps respected", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: 30,
      overdueCount: 200,
      scheduledNewCount: 10,
    });
    expect(result.isComeback).toBe(true);
    expect(result.recommendedReviews).toBeLessThanOrEqual(40); // comebackBatch max
    expect(result.recommendedNewWords).toBeLessThanOrEqual(3); // throttled
  });

  it("brand new user (null everything) gets normal mode", () => {
    const result = computeWorkloadPolicy({
      p50ReviewMs: null,
      daysSinceLastSession: null,
      overdueCount: 0,
      scheduledNewCount: 10,
    });
    expect(result.isComeback).toBe(false);
    expect(result.recommendedNewWords).toBe(10);
    expect(result.p50ReviewMs).toBe(P50_FALLBACK_MS);
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
// Continuation
// ---------------------------------------------------------------------------
describe("continuation", () => {
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

  it("continuation chunk sizes are fixed regardless of comeback mode", () => {
    // Continuation chunks are NOT gated by comeback — they are always the
    // same size. This is intentional: the initial batch is the recommendation,
    // continuation is unlimited bonus work.
    const comeback = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: 14,
      overdueCount: 200,
      scheduledNewCount: 10,
    });
    const normal = computeWorkloadPolicy({
      p50ReviewMs: P50_FALLBACK_MS,
      daysSinceLastSession: 0,
      overdueCount: 0,
      scheduledNewCount: 10,
    });
    expect(comeback.continuationReviewChunk).toBe(normal.continuationReviewChunk);
    expect(comeback.continuationNewChunk).toBe(normal.continuationNewChunk);
  });
});
