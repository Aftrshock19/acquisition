import { describe, it, expect } from "vitest";
import {
  frontierRankToStageIndex,
  getUserStageIndex,
  scoreAsset,
  getListeningRecommendation,
  type ScoredAsset,
} from "./recommendation";
import type { ListeningAsset } from "@/lib/loop/listening";
import type { UserSettingsRow } from "@/lib/settings/types";

// ── Helpers ─────────────────────────────────────────────────

function makeAsset(overrides: Partial<ListeningAsset> & { stageIndex?: number; passageMode?: string; passageNumber?: number; displayLabel?: string }): ListeningAsset {
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
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

// ── frontierRankToStageIndex ────────────────────────────────

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
    expect(idx).toBeGreaterThanOrEqual(11);
    expect(idx).toBeLessThanOrEqual(15);
  });

  it("falls back to A1 midpoint when no level data", () => {
    const settings = makeSettings();
    expect(getUserStageIndex(settings)).toBe(3);
  });

  it("prioritises frontier rank over self-certified CEFR", () => {
    const settings = makeSettings({
      current_frontier_rank: 5000, // B2
      self_certified_cefr_level: "A1",
    });
    const idx = getUserStageIndex(settings);
    expect(idx).toBeGreaterThanOrEqual(16); // B2 range, not A1
  });
});

// ── scoreAsset (pure scoring — no exclusion) ────────────────

describe("scoreAsset", () => {
  it("scores at-level assets highest", () => {
    const atLevel = scoreAsset(makeAsset({ stageIndex: 8 }), 8);
    const belowLevel = scoreAsset(makeAsset({ stageIndex: 3 }), 8);
    const aboveLevel = scoreAsset(makeAsset({ stageIndex: 15 }), 8);

    expect(atLevel.score).toBeGreaterThan(belowLevel.score);
    expect(atLevel.score).toBeGreaterThan(aboveLevel.score);
  });

  it("scores slightly-below higher than slightly-above", () => {
    const slightlyBelow = scoreAsset(makeAsset({ stageIndex: 7 }), 8);
    const slightlyAbove = scoreAsset(makeAsset({ stageIndex: 10 }), 8);

    expect(slightlyBelow.score).toBeGreaterThan(slightlyAbove.score);
  });

  it("prefers short passages", () => {
    const short = scoreAsset(makeAsset({ passageMode: "short", stageIndex: 8 }), 8);
    const veryLong = scoreAsset(makeAsset({ passageMode: "very_long", stageIndex: 8 }), 8);

    expect(short.score).toBeGreaterThan(veryLong.score);
  });

  it("heavily penalises content far above level", () => {
    const farAbove = scoreAsset(makeAsset({ stageIndex: 20 }), 5);
    expect(farAbove.score).toBeLessThan(0);
  });

  it("generates a reason string", () => {
    const scored = scoreAsset(makeAsset({ stageIndex: 8, passageMode: "short" }), 8);
    expect(scored.reason).toContain("A2");
    expect(scored.reason).toContain("short");
  });
});

// ── getListeningRecommendation (hard exclusion) ─────────────

describe("getListeningRecommendation", () => {
  it("returns continue when in-progress asset exists", () => {
    const inProgress = makeAsset({ id: "in-progress" });
    const result = getListeningRecommendation(
      inProgress,
      [makeAsset({ id: "other" })],
      makeSettings(),
      new Set(),
    );

    expect(result).not.toBeNull();
    expect(result!.kind).toBe("continue");
    expect(result!.asset.id).toBe("in-progress");
  });

  it("returns recommended when no in-progress asset", () => {
    const assets = [
      makeAsset({ id: "a1", stageIndex: 3 }),
      makeAsset({ id: "a2", stageIndex: 8 }),
    ];
    const result = getListeningRecommendation(
      null,
      assets,
      makeSettings({ current_frontier_rank: 500 }), // A1
      new Set(),
    );

    expect(result).not.toBeNull();
    expect(result!.kind).toBe("recommended");
    expect(result!.asset.id).toBe("a1"); // A1 asset matches A1 user
  });

  it("hard-excludes started asset and picks fresh one", () => {
    const assets = [
      makeAsset({ id: "started", stageIndex: 3 }),
      makeAsset({ id: "fresh", stageIndex: 4 }),
    ];
    const result = getListeningRecommendation(
      null,
      assets,
      makeSettings({ current_frontier_rank: 500 }),
      new Set(["started"]),
    );

    expect(result).not.toBeNull();
    expect(result!.asset.id).toBe("fresh");
  });

  it("hard-excludes completed asset — never recommends it", () => {
    const assets = [
      makeAsset({ id: "completed", stageIndex: 3 }),
      makeAsset({ id: "fresh", stageIndex: 4 }),
    ];
    // The completed asset is a perfect level match, but it must be excluded
    const result = getListeningRecommendation(
      null,
      assets,
      makeSettings({ current_frontier_rank: 500 }),
      new Set(["completed"]),
    );

    expect(result).not.toBeNull();
    expect(result!.asset.id).toBe("fresh");
  });

  it("returns null when all assets are excluded", () => {
    const assets = [
      makeAsset({ id: "a1", stageIndex: 3 }),
      makeAsset({ id: "a2", stageIndex: 4 }),
    ];
    const result = getListeningRecommendation(
      null,
      assets,
      makeSettings(),
      new Set(["a1", "a2"]),
    );
    expect(result).toBeNull();
  });

  it("returns null when no assets exist", () => {
    const result = getListeningRecommendation(
      null,
      [],
      makeSettings(),
      new Set(),
    );
    expect(result).toBeNull();
  });

  it("works with default settings (no level data)", () => {
    const assets = [
      makeAsset({ id: "a1", stageIndex: 3 }),
      makeAsset({ id: "b2", stageIndex: 18 }),
    ];
    const result = getListeningRecommendation(
      null,
      assets,
      makeSettings(), // no frontier rank, no CEFR → defaults to stage 3
      new Set(),
    );

    expect(result).not.toBeNull();
    expect(result!.asset.id).toBe("a1"); // matches the default A1 level
  });

  it("in-progress always overrides fresh recommendation", () => {
    const inProgress = makeAsset({ id: "in-progress", stageIndex: 20 }); // B2 — far from user level
    const perfectMatch = makeAsset({ id: "perfect", stageIndex: 3 });
    const result = getListeningRecommendation(
      inProgress,
      [perfectMatch],
      makeSettings({ current_frontier_rank: 500 }), // A1 user
      new Set(),
    );

    expect(result!.kind).toBe("continue");
    expect(result!.asset.id).toBe("in-progress");
  });

  it("untouched passage appears in recommended", () => {
    const fresh = makeAsset({ id: "untouched", stageIndex: 3 });
    const result = getListeningRecommendation(
      null,
      [fresh],
      makeSettings(),
      new Set(),
    );
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("recommended");
    expect(result!.asset.id).toBe("untouched");
  });
});
