import { describe, it, expect } from "vitest";
import {
  computeLearnerState,
  LEARNER_FACTOR_MIN,
  LEARNER_FACTOR_MAX,
  LEARNER_FACTOR_NEUTRAL,
  type SessionSignal,
} from "./learnerState";

function mk(overrides: Partial<SessionSignal> = {}): SessionSignal {
  return {
    firstPassAccuracy: null,
    retryBurden: null,
    readingQuestionAccuracy: null,
    completionRate: null,
    medianResponseMs: null,
    ...overrides,
  };
}

describe("computeLearnerState", () => {
  it("returns neutral factor with empty input", () => {
    const r = computeLearnerState({
      recentSessions: [],
      overdueCount: 0,
      expectedDailyLoad: 10,
    });
    expect(r.learnerFactor).toBe(LEARNER_FACTOR_NEUTRAL);
    expect(r.sampleSize).toBe(0);
  });

  it("rewards strong learners with factor > 1.0", () => {
    const strong = [
      mk({
        firstPassAccuracy: 0.95,
        retryBurden: 0.05,
        readingQuestionAccuracy: 0.9,
        completionRate: 1.0,
        medianResponseMs: 10_000,
      }),
      mk({
        firstPassAccuracy: 0.92,
        retryBurden: 0.08,
        readingQuestionAccuracy: 0.85,
        completionRate: 1.0,
        medianResponseMs: 12_000,
      }),
    ];
    const r = computeLearnerState({
      recentSessions: strong,
      overdueCount: 0,
      expectedDailyLoad: 15,
    });
    expect(r.learnerStateScore).toBeGreaterThan(0);
    expect(r.learnerFactor).toBeGreaterThan(1.0);
  });

  it("penalises struggling learners with factor < 1.0", () => {
    const weak = [
      mk({
        firstPassAccuracy: 0.3,
        retryBurden: 0.8,
        readingQuestionAccuracy: 0.35,
        completionRate: 0.5,
        medianResponseMs: 40_000,
      }),
      mk({
        firstPassAccuracy: 0.35,
        retryBurden: 0.75,
        readingQuestionAccuracy: 0.4,
        completionRate: 0.6,
        medianResponseMs: 38_000,
      }),
    ];
    const r = computeLearnerState({
      recentSessions: weak,
      overdueCount: 50,
      expectedDailyLoad: 10,
    });
    expect(r.learnerStateScore).toBeLessThan(0);
    expect(r.learnerFactor).toBeLessThan(1.0);
  });

  it("clamps factor within [MIN, MAX]", () => {
    const cases = [
      [
        mk({
          firstPassAccuracy: 1.0,
          retryBurden: 0,
          readingQuestionAccuracy: 1.0,
          completionRate: 1.0,
          medianResponseMs: 1_000,
        }),
      ],
      [
        mk({
          firstPassAccuracy: 0,
          retryBurden: 1.0,
          readingQuestionAccuracy: 0,
          completionRate: 0,
          medianResponseMs: 60_000,
        }),
      ],
    ];
    for (const c of cases) {
      const r = computeLearnerState({
        recentSessions: c,
        overdueCount: 200,
        expectedDailyLoad: 10,
      });
      expect(r.learnerFactor).toBeGreaterThanOrEqual(LEARNER_FACTOR_MIN);
      expect(r.learnerFactor).toBeLessThanOrEqual(LEARNER_FACTOR_MAX);
    }
  });

  it("large backlog penalises score even with good accuracy", () => {
    const good = mk({ firstPassAccuracy: 0.85, completionRate: 1.0 });
    const noBacklog = computeLearnerState({
      recentSessions: [good],
      overdueCount: 0,
      expectedDailyLoad: 10,
    });
    const bigBacklog = computeLearnerState({
      recentSessions: [good],
      overdueCount: 100,
      expectedDailyLoad: 10,
    });
    expect(bigBacklog.learnerStateScore).toBeLessThan(noBacklog.learnerStateScore);
  });
});
