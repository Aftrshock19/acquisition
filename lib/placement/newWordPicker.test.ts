/**
 * Tests for the near-frontier picker policy and the user-driven fallback.
 *
 * The picker itself now lives server-side as the SQL RPC
 * `pick_new_words_near_frontier` (see supabase/migrations/
 * 20260426130000_add_pick_near_frontier_rpc.sql). It handles its own
 * pagination — no JS fetch loop is involved — so there is nothing to test
 * here about candidate-window pagination. What remains JS-side is
 * `selectFromCandidates`, the pure reference implementation of the same
 * primary/relaxed/distance policy. These tests pin its behaviour so future
 * changes to the SQL have a JS yardstick.
 *
 * The user-driven fallback (RPC `pick_user_driven_fallback`) walks the
 * entire bank rather than a rank window, but its primary tier and tie-break
 * policy are the same shape as `selectFromCandidates`; the cases below
 * therefore double as fallback-policy fixtures.
 */

import { describe, it, expect } from "vitest";
import { selectFromCandidates, type Candidate } from "./newWordPicker";

function makeCandidates(ranks: number[]): Candidate[] {
  return ranks.map((rank) => ({ id: `id-${rank}`, rank }));
}

const empty = new Set<string>();

describe("selectFromCandidates", () => {
  it("returns the closest-to-target candidates regardless of input order", () => {
    const candidates = makeCandidates([13000, 14500, 14700, 14900, 16000]);
    const out = selectFromCandidates(candidates, empty, empty, empty, 14697 * 0.9, 3);
    // target = 13227.3; closest are 13000, 14500, 14700.
    expect(out.map((c) => c.rank)).toEqual([13000, 14500, 14700]);
  });

  it("considers candidates beyond the bottom-of-window — picker policy is not anchored to lowest ranks", () => {
    // Simulate a window of 5000 ranks spanning 10200..15199. Mark the bottom
    // 60 ranks as seen — the prior implementation only fetched the bottom
    // limit*6 candidates, so it would have returned [] here. The current
    // policy considers the whole pool.
    const ranks: number[] = [];
    for (let r = 10200; r < 15200; r++) ranks.push(r);
    const candidates = makeCandidates(ranks);
    const seen = new Set<string>();
    for (let r = 10200; r < 10260; r++) seen.add(`id-${r}`);

    const out = selectFromCandidates(candidates, seen, empty, empty, 14697 * 0.9, 10);
    expect(out).toHaveLength(10);
    for (const c of out) expect(seen.has(c.id)).toBe(false);
    // Picked ranks should cluster around the target (~13227), not the
    // bottom of the window.
    const meanRank = out.reduce((s, c) => s + c.rank, 0) / out.length;
    expect(meanRank).toBeGreaterThan(13000);
    expect(meanRank).toBeLessThan(13500);
  });

  it("user-driven fallback policy: does not return rank-1 words when closer unseen ones exist", () => {
    // Mimics the bank shape that pick_user_driven_fallback walks. With
    // unseen candidates at 14000/15500/18000 and frontier 14697, those must
    // win — never rank 1, 2, 3.
    const ranks = [1, 2, 3, 100, 9000, 14000, 15500, 18000, 25000];
    const candidates = makeCandidates(ranks);
    const out = selectFromCandidates(candidates, empty, empty, empty, 14697, 3);
    expect(out.map((c) => c.rank)).toEqual([14000, 15500, 18000]);
    expect(out.every((c) => c.rank > 200)).toBe(true);
  });

  it("user-driven fallback returns [] only when no unseen candidates exist", () => {
    const candidates = makeCandidates([100, 200, 300]);
    const seen = new Set(candidates.map((c) => c.id));
    const out = selectFromCandidates(candidates, seen, empty, empty, 14697, 5);
    expect(out).toEqual([]);
  });

  it("empty candidate pool yields []", () => {
    expect(selectFromCandidates([], empty, empty, empty, 14697, 10)).toEqual([]);
  });

  it("limit <= 0 yields []", () => {
    const candidates = makeCandidates([14000, 14500]);
    expect(selectFromCandidates(candidates, empty, empty, empty, 14697, 0)).toEqual([]);
    expect(selectFromCandidates(candidates, empty, empty, empty, 14697, -3)).toEqual([]);
  });

  it("primary pool of zero falls through to relaxed (drops baseline filter)", () => {
    const candidates = makeCandidates([14000, 14500, 14700, 15000]);
    const baseline = new Set(candidates.map((c) => c.id));
    const out = selectFromCandidates(candidates, empty, baseline, empty, 14697, 2);
    expect(out).toHaveLength(2);
  });

  it("excluded ids are dropped even from the relaxed fallback", () => {
    const candidates = makeCandidates([14000, 14500, 14700]);
    const excluded = new Set(["id-14500"]);
    const out = selectFromCandidates(candidates, empty, empty, excluded, 14697, 5);
    expect(out.map((c) => c.id)).toEqual(["id-14700", "id-14000"]);
  });

  it("ties on absolute distance break by rank ASC", () => {
    // 14600 and 14800 are both 100 away from 14700; rank ASC tie-break
    // means 14600 comes first. Mirrors the SQL `ORDER BY ..., rank ASC`.
    const candidates = makeCandidates([14800, 14600, 14400, 15000]);
    const out = selectFromCandidates(candidates, empty, empty, empty, 14700, 4);
    expect(out.map((c) => c.rank)).toEqual([14600, 14800, 14400, 15000]);
  });

  it("primary preferred over baseline at equal distance (top-up path)", () => {
    // Two candidates at distance 100 from target 14700 (one primary, one
    // baseline). Primary should appear first in the result.
    const candidates = makeCandidates([14600, 14800]);
    const baseline = new Set(["id-14600"]); // only the closer one is baseline
    const out = selectFromCandidates(candidates, empty, baseline, empty, 14700, 2);
    // primary (14800, distance 100) comes before baseline (14600, distance 100)
    // because the SQL/JS policy puts pref=0 ahead of pref=1 at equal distance.
    expect(out.map((c) => c.rank)).toEqual([14800, 14600]);
  });
});
