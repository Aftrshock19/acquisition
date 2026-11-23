import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { computeRecalibration, recalibratePlacementForUser } from "./recalibrate";

// ── Fake Supabase ──────────────────────────────────────────
//
// Just enough of the query builder for recalibratePlacementForUser: one
// mutable user_settings row, fixed evidence rows for the other tables, and a
// log of every user_settings update payload.

const DAY_MS = 86_400_000;
const T0 = Date.parse("2026-04-10T09:00:00.000Z");

type Row = Record<string, unknown>;

function strongEvidence() {
  return {
    review_events: Array.from({ length: 30 }, (_, i) => ({
      correct: i < 27,
      ms_spent: 2000,
      happened_at: new Date(T0).toISOString(),
    })),
    reading_question_attempts: Array.from({ length: 10 }, (_, i) => ({ correct: i < 9 })),
    daily_sessions: [{ completed: true, stage: "completed", session_date: "2026-04-10" }],
  } as Record<string, Row[]>;
}

function makeFakeSupabase(settings: Row, evidence = strongEvidence()) {
  const updates: Row[] = [];
  const client = {
    from(table: string) {
      let pendingUpdate: Row | null = null;
      const q = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        limit: () => q,
        update: (payload: Row) => {
          pendingUpdate = payload;
          return q;
        },
        maybeSingle: async () => ({
          data: table === "user_settings" ? { ...settings } : null,
          error: null,
        }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          if (pendingUpdate) {
            updates.push(pendingUpdate);
            Object.assign(settings, pendingUpdate);
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: evidence[table] ?? [], error: null }).then(
            resolve,
            reject,
          );
        },
      };
      return q;
    },
  };
  return { supabase: client as unknown as SupabaseClient, settings, updates };
}

function placedSettings(overrides: Row = {}): Row {
  const t0 = new Date(T0).toISOString();
  return {
    current_frontier_rank: 3000,
    placement_confidence: 0.5,
    placement_baseline_at: t0,
    onboarding_completed_at: t0,
    placement_last_recalibrated_at: t0,
    baseline_test_run_id: "run-1",
    placement_recalibration_trace: [],
    ...overrides,
  };
}

/** Run one recalibration per day for `days` days after T0. */
async function runDaily(settings: Row, days: number) {
  const fake = makeFakeSupabase(settings);
  const perDay: Array<{ daysSinceBaseline: number; gain: number; status: string }> = [];
  for (let d = 1; d <= days; d += 1) {
    vi.setSystemTime(T0 + d * DAY_MS);
    const r = await recalibratePlacementForUser(fake.supabase, "user-1");
    expect(r).not.toBeNull();
    perDay.push({
      daysSinceBaseline: r!.traceEntry.daysSinceBaseline as number,
      gain: r!.traceEntry.gain as number,
      status: r!.status,
    });
  }
  return { ...fake, perDay };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ──────────────────────────────────────────────────

describe("recalibratePlacementForUser baseline", () => {
  it("measures daysSinceBaseline from the fixed baseline over 30 daily runs", async () => {
    const { perDay } = await runDaily(placedSettings(), 30);

    perDay.forEach((p, i) => expect(p.daysSinceBaseline).toBeCloseTo(i + 1, 6));

    // dayFactor = gain / 0.18 decays, then sits at its 0.3 floor.
    const dayFactors = perDay.map((p) => p.gain / 0.18);
    for (let i = 1; i < dayFactors.length; i += 1) {
      expect(dayFactors[i]).toBeLessThanOrEqual(dayFactors[i - 1]);
    }
    expect(dayFactors[0]).toBeCloseTo(Math.exp(-1 / 4), 6);
    expect(dayFactors[29]).toBeCloseTo(0.3, 6);
    expect(dayFactors[29]).toBeLessThan(dayFactors[0]);
  });

  it("reaches 'stable' once a week has passed since the baseline", async () => {
    const { perDay, settings } = await runDaily(placedSettings(), 30);

    expect(perDay.slice(0, 6).every((p) => p.status === "calibrating")).toBe(true);
    expect(perDay[6].status).toBe("stable");
    expect(perDay[29].status).toBe("stable");
    expect(settings.placement_status).toBe("stable");
  });

  it("reaches 'stable' within 30 days from a self-certified start (no confidence)", async () => {
    const { perDay } = await runDaily(
      placedSettings({ placement_confidence: null, baseline_test_run_id: null }),
      30,
    );
    expect(perDay[29].status).toBe("stable");
  });

  it("never moves the baseline, only the last-ran marker", async () => {
    const { settings, updates } = await runDaily(placedSettings(), 30);

    expect(updates).toHaveLength(30);
    for (const u of updates) expect(u).not.toHaveProperty("placement_baseline_at");
    expect(settings.placement_baseline_at).toBe(new Date(T0).toISOString());
    expect(settings.placement_last_recalibrated_at).toBe(
      new Date(T0 + 30 * DAY_MS).toISOString(),
    );
  });

  it("ignores a recent placement_last_recalibrated_at when a baseline exists", async () => {
    const fake = makeFakeSupabase(
      placedSettings({
        placement_last_recalibrated_at: new Date(T0 + 19 * DAY_MS).toISOString(),
      }),
    );
    vi.setSystemTime(T0 + 20 * DAY_MS);
    const r = await recalibratePlacementForUser(fake.supabase, "user-1");
    expect(r!.traceEntry.daysSinceBaseline).toBeCloseTo(20, 6);
  });

  it("falls back to onboarding_completed_at for rows without placement_baseline_at", async () => {
    const fake = makeFakeSupabase(
      placedSettings({
        placement_baseline_at: null,
        placement_last_recalibrated_at: new Date(T0 + 19 * DAY_MS).toISOString(),
      }),
    );
    vi.setSystemTime(T0 + 20 * DAY_MS);
    const r = await recalibratePlacementForUser(fake.supabase, "user-1");
    expect(r!.traceEntry.daysSinceBaseline).toBeCloseTo(20, 6);
  });

  it("drifts far less than when measured from the last recalibration", async () => {
    const fixed = await runDaily(placedSettings(), 30);
    // Legacy shape: nothing but the last-ran marker, which recalibration
    // overwrites each day, so daysSinceBaseline stays at ~1.
    const pinned = await runDaily(
      placedSettings({ placement_baseline_at: null, onboarding_completed_at: null }),
      30,
    );

    expect(pinned.perDay.every((p) => Math.abs(p.daysSinceBaseline - 1) < 1e-6)).toBe(true);
    expect(pinned.perDay.some((p) => p.status === "stable")).toBe(false);

    const fixedRank = fixed.settings.current_frontier_rank as number;
    const pinnedRank = pinned.settings.current_frontier_rank as number;
    expect(fixedRank).toBeGreaterThan(3000);
    expect(fixedRank).toBeLessThan(pinnedRank);
  });
});

describe("computeRecalibration day factor", () => {
  const base = {
    currentFrontierRank: 3000,
    placementConfidence: 0.9,
    baselineAt: null,
    reviewAccuracy: 0.9,
    reviewCount: 30,
    avgLatencyMs: 2000,
    readingQuestionAccuracy: 0.9,
    readingQuestionCount: 10,
    sessionCompletionRate: 1,
  };

  it("requires daysSinceBaseline >= 7 for 'stable'", () => {
    expect(computeRecalibration({ ...base, daysSinceBaseline: 6.9 })!.status).toBe("calibrating");
    expect(computeRecalibration({ ...base, daysSinceBaseline: 7 })!.status).toBe("stable");
  });
});
