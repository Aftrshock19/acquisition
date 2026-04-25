import { describe, it, expect } from "vitest";
import {
  frontierRankToStageIndex,
  getUserStageIndex,
  getListeningRecommendation,
} from "./recommendation";
import type { ListeningAsset } from "@/lib/loop/listening";
import type { UserSettingsRow } from "@/lib/settings/types";

// ── Helpers ─────────────────────────────────────────────────

function makeAsset(
  overrides: Partial<ListeningAsset> & {
    stageIndex?: number;
    passageMode?: string;
    passageNumber?: number;
    displayLabel?: string;
  },
): ListeningAsset {
  const {
    stageIndex = 3,
    passageMode = "short",
    passageNumber = 1,
    displayLabel = "A1",
    ...rest
  } = overrides;
  return {
    id: "asset-1",
    textId: "text-1",
    title: "Test Passage",
    audioUrl: "https://example.com/audio.mp3",
    transcript: "Hola mundo.",
    durationSeconds: 45,
    variantType: "support",
    storagePath: "audio/es-ES/text-1/support.mp3",
    createdAt: "2026-01-01T00:00:00Z",
    text: {
      id: "text-1",
      title: "Test Passage",
      content: "",
      lang: "es",
      stage: `listening_stage_${stageIndex}`,
      stageIndex,
      displayLabel,
      passageMode,
      passageNumber,
      difficultyCefr: "A1",
      wordCount: 50,
      estimatedMinutes: 1,
    },
    ...rest,
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
    placement_status: "unknown",
    current_frontier_rank: null,
    timezone: "UTC",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

// ── frontierRankToStageIndex (legacy; retained for accordion UI) ─────

describe("frontierRankToStageIndex", () => {
  it("maps low A1 rank to early stages", () => {
    expect(frontierRankToStageIndex(100)).toBeLessThanOrEqual(2);
  });

  it("maps mid A1 rank to stage ~3", () => {
    const idx = frontierRankToStageIndex(500);
    expect(idx).toBeGreaterThanOrEqual(2);
    expect(idx).toBeLessThanOrEqual(5);
  });

  it("maps A2 rank to stages 6-10", () => {
    const idx = frontierRankToStageIndex(1200);
    expect(idx).toBeGreaterThanOrEqual(6);
    expect(idx).toBeLessThanOrEqual(10);
  });

  it("maps B1 rank to stages 11-15", () => {
    const idx = frontierRankToStageIndex(2500);
    expect(idx).toBeGreaterThanOrEqual(11);
    expect(idx).toBeLessThanOrEqual(15);
  });

  it("maps B2 rank to stages 16-20", () => {
    const idx = frontierRankToStageIndex(5000);
    expect(idx).toBeGreaterThanOrEqual(16);
    expect(idx).toBeLessThanOrEqual(20);
  });

  it("maps very high rank to 30", () => {
    expect(frontierRankToStageIndex(50000)).toBe(30);
  });
});

// ── getUserStageIndex ───────────────────────────────────────

describe("getUserStageIndex", () => {
  it("uses frontier rank when available", () => {
    const settings = makeSettings({ current_frontier_rank: 1200 });
    const idx = getUserStageIndex(settings);
    expect(idx).toBeGreaterThanOrEqual(6);
    expect(idx).toBeLessThanOrEqual(10);
  });

  it("falls back to self-certified CEFR", () => {
    const settings = makeSettings({ self_certified_cefr_level: "B1" });
    const idx = getUserStageIndex(settings);
    // CEFR_OPTIONS B1 = 4301 (floor of B1--). Legacy frontierRankToStageIndex
    // (6-band linear) maps 4301 into the B2 band (3500-7000), yielding stage 17.
    expect(idx).toBe(17);
  });

  it("falls back to A1 midpoint when no level data", () => {
    const settings = makeSettings();
    expect(getUserStageIndex(settings)).toBe(3);
  });

  it("prioritises frontier rank over self-certified CEFR", () => {
    const settings = makeSettings({
      current_frontier_rank: 5000,
      self_certified_cefr_level: "A1",
    });
    const idx = getUserStageIndex(settings);
    expect(idx).toBeGreaterThanOrEqual(16);
  });
});

// ── getListeningRecommendation (rank + target driven) ────────
//
// Reference: rank 500 → substage 3 (table row 351..650).
// Target 20 → "short" mode.

describe("getListeningRecommendation", () => {
  it("returns null for empty asset list", () => {
    const rec = getListeningRecommendation([], 500, 20, new Set());
    expect(rec).toBeNull();
  });

  it("Phase 1: exact (substage, mode) match wins", () => {
    const at = makeAsset({ id: "at", stageIndex: 3, passageMode: "short" });
    const off = makeAsset({ id: "off", stageIndex: 5, passageMode: "long" });
    const rec = getListeningRecommendation([off, at], 500, 20, new Set());
    expect(rec?.asset.id).toBe("at");
  });

  it("Phase 1 tiebreak: lowest passageNumber wins within bucket", () => {
    const p1 = makeAsset({ id: "p1", stageIndex: 3, passageMode: "short", passageNumber: 1 });
    const p5 = makeAsset({ id: "p5", stageIndex: 3, passageMode: "short", passageNumber: 5 });
    const rec = getListeningRecommendation([p5, p1], 500, 20, new Set());
    expect(rec?.asset.id).toBe("p1");
  });

  it("Phase 2: same substage, alternative mode when desired missing", () => {
    const med = makeAsset({ id: "med", stageIndex: 3, passageMode: "medium" });
    const rec = getListeningRecommendation([med], 500, 20, new Set());
    expect(rec?.asset.id).toBe("med");
  });

  it("Phase 2 priority: same substage adjacent mode beats nearby substage desired mode", () => {
    const stage3med = makeAsset({ id: "s3med", stageIndex: 3, passageMode: "medium" });
    const stage4short = makeAsset({ id: "s4short", stageIndex: 4, passageMode: "short" });
    const rec = getListeningRecommendation([stage4short, stage3med], 500, 20, new Set());
    expect(rec?.asset.id).toBe("s3med");
  });

  it("Phase 3: symmetric substage walk (-1 before +1)", () => {
    const stage2 = makeAsset({ id: "s2", stageIndex: 2, passageMode: "short" });
    const stage4 = makeAsset({ id: "s4", stageIndex: 4, passageMode: "short" });
    const rec = getListeningRecommendation([stage4, stage2], 500, 20, new Set());
    expect(rec?.asset.id).toBe("s2");
  });

  it("Phase 4: cross product reaches distant (substage, mode)", () => {
    const far = makeAsset({ id: "far", stageIndex: 15, passageMode: "very_long" });
    const rec = getListeningRecommendation([far], 500, 20, new Set());
    expect(rec?.asset.id).toBe("far");
  });

  it("excludes completed assets", () => {
    const completed = makeAsset({ id: "completed", stageIndex: 3, passageMode: "short" });
    const fresh = makeAsset({ id: "fresh", stageIndex: 4, passageMode: "short" });
    const rec = getListeningRecommendation(
      [completed, fresh],
      500,
      20,
      new Set(["completed"]),
    );
    expect(rec?.asset.id).toBe("fresh");
  });

  it("returns null when every asset is excluded", () => {
    const a1 = makeAsset({ id: "a1", stageIndex: 3 });
    const a2 = makeAsset({ id: "a2", stageIndex: 4 });
    const rec = getListeningRecommendation([a1, a2], 500, 20, new Set(["a1", "a2"]));
    expect(rec).toBeNull();
  });

  it("rank null defaults to substage 1", () => {
    const stage1 = makeAsset({ id: "s1", stageIndex: 1, passageMode: "short" });
    const stage5 = makeAsset({ id: "s5", stageIndex: 5, passageMode: "short" });
    const rec = getListeningRecommendation([stage5, stage1], null, 20, new Set());
    expect(rec?.asset.id).toBe("s1");
  });

  it("target=100 picks long when available", () => {
    const short = makeAsset({ id: "short", stageIndex: 3, passageMode: "short" });
    const long = makeAsset({ id: "long", stageIndex: 3, passageMode: "long" });
    const rec = getListeningRecommendation([short, long], 500, 100, new Set());
    expect(rec?.asset.id).toBe("long");
  });
});

// ── makeSettings is retained for the legacy frontierRankToStageIndex /
// getUserStageIndex tests above; the picker no longer takes settings.
void makeSettings;
