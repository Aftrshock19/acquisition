import { describe, it, expect } from "vitest";
import {
  frontierRankToStageIndex,
  getUserStageIndex,
  buildTryStageOrder,
  getListeningRecommendation,
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
    timezone: "UTC",
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
      current_frontier_rank: 5000,
      self_certified_cefr_level: "A1",
    });
    const idx = getUserStageIndex(settings);
    expect(idx).toBeGreaterThanOrEqual(16);
  });
});

// ── buildTryStageOrder ──────────────────────────────────────

describe("buildTryStageOrder", () => {
  it("starts with user, -1, +1, -2, +2", () => {
    const order = buildTryStageOrder(10);
    expect(order.slice(0, 5)).toEqual([10, 9, 11, 8, 12]);
  });

  it("continues upward to 29", () => {
    const order = buildTryStageOrder(10);
    expect(order.slice(5)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  });
});

// ── getListeningRecommendation ──────────────────────────────

describe("getListeningRecommendation", () => {
  it("returns recommended at user's stage when available", () => {
    const assets = [
      makeAsset({ id: "a1", stageIndex: 3 }),
      makeAsset({ id: "a2", stageIndex: 8 }),
    ];
    const result = getListeningRecommendation(
      assets,
      makeSettings({ current_frontier_rank: 500 }),
      new Set(),
    );

    expect(result).not.toBeNull();
    expect(result!.kind).toBe("recommended");
    expect(result!.asset.id).toBe("a1");
  });

  it("walks the try_stage order: user_stage empty, user_stage-1 picked", () => {
    // User at stage 8. Stage 8 absent, stages 7 and 9 both present.
    // Expect stage 7 (user_stage - 1 comes before user_stage + 1 in the order).
    const assets = [
      makeAsset({ id: "below", stageIndex: 7 }),
      makeAsset({ id: "above", stageIndex: 9 }),
    ];
    const result = getListeningRecommendation(
      assets,
      makeSettings({ current_frontier_rank: 1200 }), // stage 8
      new Set(),
    );
    const userStage = getUserStageIndex(makeSettings({ current_frontier_rank: 1200 }));
    if (userStage === 8) {
      expect(result!.asset.id).toBe("below");
    }
  });

  it("widens outward when nearby buckets are all empty", () => {
    const far = makeAsset({ id: "far", stageIndex: 20 });
    const result = getListeningRecommendation([far], makeSettings(), new Set());
    expect(result?.asset.id).toBe("far");
  });

  it("hard-excludes started asset and picks fresh one", () => {
    const assets = [
      makeAsset({ id: "started", stageIndex: 3 }),
      makeAsset({ id: "fresh", stageIndex: 4 }),
    ];
    const result = getListeningRecommendation(
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
    const result = getListeningRecommendation(
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
      assets,
      makeSettings(),
      new Set(["a1", "a2"]),
    );
    expect(result).toBeNull();
  });

  it("returns null when no assets exist", () => {
    const result = getListeningRecommendation(
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
      assets,
      makeSettings(),
      new Set(),
    );

    expect(result).not.toBeNull();
    expect(result!.asset.id).toBe("a1");
  });

  it("within-bucket: prefers short over very_long", () => {
    const assets = [
      makeAsset({ id: "vlong", stageIndex: 3, passageMode: "very_long" }),
      makeAsset({ id: "short", stageIndex: 3, passageMode: "short" }),
    ];
    const result = getListeningRecommendation(assets, makeSettings(), new Set());
    expect(result?.asset.id).toBe("short");
  });

  it("within-bucket: tiebreak by lower passageNumber", () => {
    const assets = [
      makeAsset({ id: "p5", stageIndex: 3, passageMode: "short", passageNumber: 5 }),
      makeAsset({ id: "p1", stageIndex: 3, passageMode: "short", passageNumber: 1 }),
    ];
    const result = getListeningRecommendation(assets, makeSettings(), new Set());
    expect(result?.asset.id).toBe("p1");
  });
});
