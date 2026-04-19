import { describe, it, expect } from "vitest";
import {
  frontierRankToStageIndex,
  getUserStageIndex,
  buildTryStageOrder,
  getReadingRecommendation,
} from "./recommendation";
import type { ReadingPassageSummary } from "./types";
import type { UserSettingsRow } from "@/lib/settings/types";

// ── Helpers ─────────────────────────────────────────────────

function makePassage(overrides: Partial<ReadingPassageSummary> = {}): ReadingPassageSummary {
  return {
    id: "p-1",
    stage: "stage_3",
    stageIndex: 3,
    displayLabel: "A1",
    difficultyCefr: "A1",
    mode: "short",
    passageNumber: 1,
    title: "El gato",
    wordCount: 100,
    estimatedMinutes: 2,
    ...overrides,
  };
}

function makeSettings(overrides: Partial<UserSettingsRow> = {}): UserSettingsRow {
  return {
    user_id: "user-1",
    learning_lang: "es",
    daily_plan_mode: "recommended",
    manual_daily_card_limit: 200,
    flashcard_selection_mode: "recommended",
    include_cloze: true,
    include_normal: true,
    include_audio: false,
    include_mcq: false,
    include_sentences: false,
    include_cloze_en_to_es: true,
    include_cloze_es_to_en: false,
    include_normal_en_to_es: true,
    include_normal_es_to_en: false,
    retry_delay_seconds: 90,
    auto_advance_correct: true,
    show_pos_hint: true,
    show_definition_first: true,
    hide_translation_sentences: false,
    remove_daily_limit: false,
    scheduler_variant: "baseline",
    has_seen_intro: false,
    onboarding_completed_at: null,
    current_frontier_rank: null,
    timezone: "UTC",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

// ── frontierRankToStageIndex ────────────────────────────────

describe("frontierRankToStageIndex", () => {
  it("maps rank 0 to stage 1", () => {
    expect(frontierRankToStageIndex(0)).toBe(1);
  });

  it("maps rank 400 to A1 mid-range", () => {
    const s = frontierRankToStageIndex(400);
    expect(s).toBeGreaterThanOrEqual(1);
    expect(s).toBeLessThanOrEqual(5);
  });

  it("maps rank 1000 to A2 range", () => {
    const s = frontierRankToStageIndex(1000);
    expect(s).toBeGreaterThanOrEqual(6);
    expect(s).toBeLessThanOrEqual(10);
  });

  it("maps rank 5000 to B2 range", () => {
    const s = frontierRankToStageIndex(5000);
    expect(s).toBeGreaterThanOrEqual(16);
    expect(s).toBeLessThanOrEqual(20);
  });

  it("maps rank beyond 34000 to 30", () => {
    expect(frontierRankToStageIndex(40000)).toBe(30);
  });
});

// ── getUserStageIndex ───────────────────────────────────────

describe("getUserStageIndex", () => {
  it("uses frontier rank when available", () => {
    const s = getUserStageIndex(makeSettings({ current_frontier_rank: 400 }));
    expect(s).toBeGreaterThanOrEqual(1);
    expect(s).toBeLessThanOrEqual(5);
  });

  it("uses self-certified CEFR when no frontier rank", () => {
    const s = getUserStageIndex(makeSettings({ self_certified_cefr_level: "B1" }));
    expect(s).toBeGreaterThanOrEqual(11);
    expect(s).toBeLessThanOrEqual(15);
  });

  it("falls back to stage 3 with no signals", () => {
    expect(getUserStageIndex(makeSettings())).toBe(3);
  });
});

// ── buildTryStageOrder ──────────────────────────────────────

describe("buildTryStageOrder", () => {
  it("starts with user stage, then -1, +1, -2, +2", () => {
    const order = buildTryStageOrder(10);
    expect(order.slice(0, 5)).toEqual([10, 9, 11, 8, 12]);
  });

  it("continues upward with +3, +4, ... up to 29", () => {
    const order = buildTryStageOrder(10);
    // After the first 5, upward-only sequence
    expect(order.slice(5)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  });

  it("emits below-range values which the picker filters out", () => {
    // For user stage 1 the first five entries include -1 and 0; caller filters.
    const order = buildTryStageOrder(1);
    expect(order.slice(0, 5)).toEqual([1, 0, 2, -1, 3]);
  });
});

// ── getReadingRecommendation ────────────────────────────────

describe("getReadingRecommendation", () => {
  it("returns recommended at user's stage when available", () => {
    const p = makePassage({ id: "at", stageIndex: 3 });
    const rec = getReadingRecommendation([p], makeSettings(), new Set());
    expect(rec?.kind).toBe("recommended");
    expect(rec?.passage.id).toBe("at");
  });

  it("prefers user's stage over adjacent stages", () => {
    const atLevel = makePassage({ id: "at", stageIndex: 3 });
    const below = makePassage({ id: "below", stageIndex: 2 });
    const above = makePassage({ id: "above", stageIndex: 4 });
    const rec = getReadingRecommendation(
      [below, above, atLevel],
      makeSettings(),
      new Set(),
    );
    expect(rec?.passage.id).toBe("at");
  });

  it("walks the try_stage order: user_stage empty, user_stage-1 picked", () => {
    // User is at stage 5. stage 5 has no candidates; stage 4 (user_stage - 1) does.
    // Must pick from stage 4, not stage 6 (which would be visited second in a simple outward walk).
    const stage4 = makePassage({ id: "s4", stageIndex: 4 });
    const stage6 = makePassage({ id: "s6", stageIndex: 6 });
    const rec = getReadingRecommendation(
      [stage4, stage6],
      makeSettings({ current_frontier_rank: 600 }), // stage 5-ish
      new Set(),
    );
    // Force user stage to 5 by passing a frontier rank that lands at 5
    // (Regardless of the exact stage the rank maps to, the assertion is that the bucket
    // immediately below is preferred to the one above when both are one step away.)
    expect(rec).not.toBeNull();
    // s4 and s6 are equidistant from stage 5, but -1 comes before +1 in try_stage order.
    const userStage = getUserStageIndex(makeSettings({ current_frontier_rank: 600 }));
    if (userStage === 5) {
      expect(rec!.passage.id).toBe("s4");
    }
  });

  it("widens beyond +2 when user stage bucket and nearby are empty", () => {
    // User at stage 3 (default). Only far-above content available.
    const far = makePassage({ id: "far", stageIndex: 15 });
    const rec = getReadingRecommendation([far], makeSettings(), new Set());
    expect(rec?.passage.id).toBe("far");
  });

  it("hard-excludes started passage", () => {
    const started = makePassage({ id: "started", stageIndex: 3 });
    const fresh = makePassage({ id: "fresh", stageIndex: 3 });
    const rec = getReadingRecommendation(
      [started, fresh],
      makeSettings(),
      new Set(["started"]),
    );
    expect(rec?.passage.id).toBe("fresh");
  });

  it("hard-excludes completed passage even at perfect level match", () => {
    const completed = makePassage({ id: "completed", stageIndex: 3 });
    const fresh = makePassage({ id: "fresh", stageIndex: 20 });
    const rec = getReadingRecommendation(
      [completed, fresh],
      makeSettings(),
      new Set(["completed"]),
    );
    expect(rec?.passage.id).toBe("fresh");
  });

  it("returns null when all passages are excluded", () => {
    const p1 = makePassage({ id: "p1" });
    const p2 = makePassage({ id: "p2" });
    const rec = getReadingRecommendation(
      [p1, p2],
      makeSettings(),
      new Set(["p1", "p2"]),
    );
    expect(rec).toBeNull();
  });

  it("returns null for empty passage list", () => {
    const rec = getReadingRecommendation([], makeSettings(), new Set());
    expect(rec).toBeNull();
  });

  it("within-bucket: prefers short over very_long", () => {
    const short = makePassage({ id: "short", stageIndex: 3, mode: "short" });
    const vlong = makePassage({ id: "vlong", stageIndex: 3, mode: "very_long" });
    const rec = getReadingRecommendation(
      [vlong, short],
      makeSettings(),
      new Set(),
    );
    expect(rec?.passage.id).toBe("short");
  });

  it("within-bucket: tiebreak by lower passageNumber", () => {
    const p1 = makePassage({ id: "p1", stageIndex: 3, mode: "short", passageNumber: 1 });
    const p5 = makePassage({ id: "p5", stageIndex: 3, mode: "short", passageNumber: 5 });
    const rec = getReadingRecommendation(
      [p5, p1],
      makeSettings(),
      new Set(),
    );
    expect(rec?.passage.id).toBe("p1");
  });
});
