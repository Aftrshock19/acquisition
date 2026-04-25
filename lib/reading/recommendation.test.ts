import { describe, it, expect } from "vitest";
import {
  frontierRankToStageIndex,
  getUserStageIndex,
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

// ── frontierRankToStageIndex (legacy 6-band linear; retained for accordion UI) ─

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
    // CEFR_OPTIONS B1 = 4301 (floor of B1--). Legacy frontierRankToStageIndex
    // (6-band linear) maps 4301 into the B2 band (3500-7000), yielding stage 17.
    expect(s).toBe(17);
  });

  it("falls back to stage 3 with no signals", () => {
    expect(getUserStageIndex(makeSettings())).toBe(3);
  });
});

// ── getReadingRecommendation (rank + target driven) ─────────
//
// Reference: rank 500 → substage 3 (table row 351..650).
// Target 20 → "short" mode.

describe("getReadingRecommendation", () => {
  it("returns null for empty passage list", () => {
    const rec = getReadingRecommendation([], 500, 20, new Set());
    expect(rec).toBeNull();
  });

  it("Phase 1: exact (substage, mode) match wins", () => {
    const at = makePassage({ id: "at", stageIndex: 3, mode: "short" });
    const off = makePassage({ id: "off", stageIndex: 5, mode: "long" });
    const rec = getReadingRecommendation([off, at], 500, 20, new Set());
    expect(rec?.passage.id).toBe("at");
  });

  it("Phase 1 tiebreak: lowest passageNumber wins within bucket", () => {
    const p1 = makePassage({ id: "p1", stageIndex: 3, mode: "short", passageNumber: 1 });
    const p5 = makePassage({ id: "p5", stageIndex: 3, mode: "short", passageNumber: 5 });
    const rec = getReadingRecommendation([p5, p1], 500, 20, new Set());
    expect(rec?.passage.id).toBe("p1");
  });

  it("Phase 2: same substage, alternative mode when desired mode missing", () => {
    // No (3, short); a (3, medium) exists.
    const med = makePassage({ id: "med", stageIndex: 3, mode: "medium" });
    const rec = getReadingRecommendation([med], 500, 20, new Set());
    expect(rec?.passage.id).toBe("med");
  });

  it("Phase 2 priority: same substage adjacent mode beats nearby substage desired mode", () => {
    // Phase 2 (stage 3, medium) wins over Phase 3 (stage 4, short).
    const stage3med = makePassage({ id: "s3med", stageIndex: 3, mode: "medium" });
    const stage4short = makePassage({ id: "s4short", stageIndex: 4, mode: "short" });
    const rec = getReadingRecommendation([stage4short, stage3med], 500, 20, new Set());
    expect(rec?.passage.id).toBe("s3med");
  });

  it("Phase 3: nearby substage with desired mode (symmetric: -1 before +1)", () => {
    // No candidates at stage 3 in any mode. Stage 2 short and stage 4 short both available.
    // Symmetric walk: 3, 2, 4 → stage 2 wins.
    const stage2 = makePassage({ id: "s2", stageIndex: 2, mode: "short" });
    const stage4 = makePassage({ id: "s4", stageIndex: 4, mode: "short" });
    const rec = getReadingRecommendation([stage4, stage2], 500, 20, new Set());
    expect(rec?.passage.id).toBe("s2");
  });

  it("Phase 4: cross product reaches distant (substage, mode)", () => {
    const far = makePassage({ id: "far", stageIndex: 15, mode: "very_long" });
    const rec = getReadingRecommendation([far], 500, 20, new Set());
    expect(rec?.passage.id).toBe("far");
  });

  it("excludes completed passages (caller-supplied excluded set)", () => {
    const completed = makePassage({ id: "completed", stageIndex: 3, mode: "short" });
    const fresh = makePassage({ id: "fresh", stageIndex: 4, mode: "short" });
    const rec = getReadingRecommendation([completed, fresh], 500, 20, new Set(["completed"]));
    expect(rec?.passage.id).toBe("fresh");
  });

  it("returns null when every candidate is excluded", () => {
    const p1 = makePassage({ id: "p1" });
    const p2 = makePassage({ id: "p2" });
    const rec = getReadingRecommendation(
      [p1, p2],
      500,
      20,
      new Set(["p1", "p2"]),
    );
    expect(rec).toBeNull();
  });

  it("target=100 picks 'long' mode when available", () => {
    const short = makePassage({ id: "short", stageIndex: 3, mode: "short" });
    const long = makePassage({ id: "long", stageIndex: 3, mode: "long" });
    const rec = getReadingRecommendation([short, long], 500, 100, new Set());
    expect(rec?.passage.id).toBe("long");
  });

  it("target=150 picks 'very_long' when available, falls back to long when missing", () => {
    // Phase 1 (3, very_long) miss; Phase 2 walks: long is nearest mode for very_long.
    const long = makePassage({ id: "long", stageIndex: 3, mode: "long" });
    const rec = getReadingRecommendation([long], 500, 150, new Set());
    expect(rec?.passage.id).toBe("long");
  });

  it("rank null falls back to substage 1", () => {
    const stage1 = makePassage({ id: "s1", stageIndex: 1, mode: "short" });
    const stage5 = makePassage({ id: "s5", stageIndex: 5, mode: "short" });
    const rec = getReadingRecommendation([stage5, stage1], null, 20, new Set());
    expect(rec?.passage.id).toBe("s1");
  });
});
