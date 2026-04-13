import { describe, it, expect } from "vitest";
import {
  frontierRankToStageIndex,
  getUserStageIndex,
  scorePassage,
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
    scheduler_variant: "baseline",
    has_seen_intro: false,
    onboarding_completed_at: null,
    current_frontier_rank: null,
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

// ── scorePassage (pure scoring — no exclusion) ──────────────

describe("scorePassage", () => {
  it("gives highest score to at-level short passage", () => {
    const p = makePassage({ stageIndex: 3, mode: "short" });
    const s = scorePassage(p, 3);
    expect(s.score).toBeGreaterThan(20);
  });

  it("penalizes passages far above user level", () => {
    const hard = makePassage({ stageIndex: 20 });
    const easy = makePassage({ stageIndex: 3 });
    expect(scorePassage(hard, 3).score).toBeLessThan(
      scorePassage(easy, 3).score,
    );
  });

  it("prefers short over very_long", () => {
    const short = makePassage({ mode: "short", stageIndex: 3 });
    const vlong = makePassage({ mode: "very_long", stageIndex: 3 });
    expect(scorePassage(short, 3).score).toBeGreaterThan(
      scorePassage(vlong, 3).score,
    );
  });

  it("uses passage_number as tiebreaker", () => {
    const p1 = makePassage({ passageNumber: 1, stageIndex: 3 });
    const p5 = makePassage({ passageNumber: 5, stageIndex: 3 });
    expect(scorePassage(p1, 3).score).toBeGreaterThan(
      scorePassage(p5, 3).score,
    );
  });
});

// ── getReadingRecommendation (hard exclusion) ───────────────

describe("getReadingRecommendation", () => {
  it("returns continue when in-progress passage exists", () => {
    const p = makePassage({ id: "in-prog" });
    const rec = getReadingRecommendation(p, [p], makeSettings(), new Set());
    expect(rec?.kind).toBe("continue");
    expect(rec?.passage.id).toBe("in-prog");
  });

  it("returns recommended when no in-progress", () => {
    const p = makePassage({ stageIndex: 3 });
    const rec = getReadingRecommendation(null, [p], makeSettings(), new Set());
    expect(rec?.kind).toBe("recommended");
  });

  it("untouched passage appears in recommended", () => {
    const fresh = makePassage({ id: "untouched", stageIndex: 3 });
    const rec = getReadingRecommendation(null, [fresh], makeSettings(), new Set());
    expect(rec).not.toBeNull();
    expect(rec!.kind).toBe("recommended");
    expect(rec!.passage.id).toBe("untouched");
  });

  it("started passage does not appear in recommended", () => {
    const started = makePassage({ id: "started-1", stageIndex: 3 });
    const fresh = makePassage({ id: "fresh-1", stageIndex: 3 });
    const rec = getReadingRecommendation(
      null,
      [started, fresh],
      makeSettings(),
      new Set(["started-1"]),
    );
    expect(rec?.passage.id).toBe("fresh-1");
  });

  it("completed passage does not appear in recommended", () => {
    const completed = makePassage({ id: "completed-1", stageIndex: 3 });
    const fresh = makePassage({ id: "fresh-1", stageIndex: 20 });
    // completed is a perfect level match but must be excluded
    const rec = getReadingRecommendation(
      null,
      [completed, fresh],
      makeSettings(),
      new Set(["completed-1"]),
    );
    expect(rec).not.toBeNull();
    expect(rec!.passage.id).toBe("fresh-1");
  });

  it("returns null when all passages are excluded", () => {
    const p1 = makePassage({ id: "p1" });
    const p2 = makePassage({ id: "p2" });
    const rec = getReadingRecommendation(
      null,
      [p1, p2],
      makeSettings(),
      new Set(["p1", "p2"]),
    );
    expect(rec).toBeNull();
  });

  it("returns null for empty passage list", () => {
    const rec = getReadingRecommendation(null, [], makeSettings(), new Set());
    expect(rec).toBeNull();
  });

  it("prefers at-level passage over far-away one", () => {
    const atLevel = makePassage({ id: "at", stageIndex: 3 });
    const far = makePassage({ id: "far", stageIndex: 25 });
    const rec = getReadingRecommendation(null, [far, atLevel], makeSettings(), new Set());
    expect(rec?.passage.id).toBe("at");
  });

  it("most recently updated in-progress passage is chosen for continue", () => {
    // This tests the contract: caller passes the most recently updated in-progress passage
    const older = makePassage({ id: "older" });
    const newer = makePassage({ id: "newer" });
    // The module takes a single inProgressPassage — caller is responsible for picking the most recent
    const rec = getReadingRecommendation(newer, [older, newer], makeSettings(), new Set(["older", "newer"]));
    expect(rec?.kind).toBe("continue");
    expect(rec?.passage.id).toBe("newer");
  });
});
