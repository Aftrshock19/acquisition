import type { SupabaseClient } from "@supabase/supabase-js";

export type PlacementFrontier = {
  rank: number;
  low: number;
  high: number;
};

export type Candidate = { id: string; rank: number };

/**
 * Pure reference implementation of the near-frontier policy. The authoritative
 * version is the SQL function `pick_new_words_near_frontier` (see migration
 * 20260426130000_add_pick_near_frontier_rpc.sql); this mirror exists so the
 * policy can be unit-tested without a Supabase round-trip and so future
 * changes to the SQL have a JS reference to keep in step.
 *
 *   * `primary`  drops seen + excluded + baseline-tested candidates.
 *   * `relaxed`  keeps baseline-tested rows in (used as a starvation
 *                backstop when primary would not fill `limit`).
 *   * Result is `primary` first, then `relaxed \ primary` topped up,
 *     each ordered by absolute distance to `target` with `rank` ASC as
 *     the tie-break (matches the SQL `ORDER BY pref, abs(rank-target), rank`).
 */
export function selectFromCandidates(
  candidates: readonly Candidate[],
  seenIds: ReadonlySet<string>,
  baselineIds: ReadonlySet<string>,
  excludedIds: ReadonlySet<string>,
  target: number,
  limit: number,
): Candidate[] {
  if (limit <= 0) return [];

  const primary = candidates.filter(
    (c) => !seenIds.has(c.id) && !excludedIds.has(c.id) && !baselineIds.has(c.id),
  );
  const relaxed = candidates.filter(
    (c) => !seenIds.has(c.id) && !excludedIds.has(c.id),
  );

  const byDistanceThenRank = (a: Candidate, b: Candidate) => {
    const dDiff = Math.abs(a.rank - target) - Math.abs(b.rank - target);
    if (dDiff !== 0) return dDiff;
    return a.rank - b.rank;
  };

  if (primary.length >= limit) {
    return [...primary].sort(byDistanceThenRank).slice(0, limit);
  }

  if (primary.length === 0) {
    return [...relaxed].sort(byDistanceThenRank).slice(0, limit);
  }

  // Primary non-empty but short: top up from relaxed (excluding dupes).
  // Primary entries are placed before top-up entries so that at equal
  // distance the non-baseline (primary) row wins.
  const have = new Set(primary.map((p) => p.id));
  const sortedPrimary = [...primary].sort(byDistanceThenRank);
  const sortedTopUp = relaxed
    .filter((c) => !have.has(c.id))
    .sort(byDistanceThenRank);
  return [...sortedPrimary, ...sortedTopUp].slice(0, limit);
}

/**
 * Given a user frontier estimate, pick new-word candidates near the frontier.
 *
 * Calls `pick_new_words_near_frontier` server-side so the candidate pool, the
 * seen / baseline / excluded exclusions, and the distance ordering all run
 * in Postgres. Two reasons:
 *
 *   1. PostgREST caps every row response at db.max_rows (1000). Doing the
 *      filter in JS would require either pagination of the rank window or
 *      `.in("word_id", [thousands of UUIDs])` calls — both brittle.
 *   2. The exclusion is a NOT EXISTS subquery; expressing it as separate
 *      JS-side fetches and a Set intersection is strictly slower and harder
 *      to keep in step with the SQL.
 *
 * Errors are logged and surface as an empty pick. The caller (`getDailyQueue`)
 * then decides what to do based on whether the user is on autopilot or has
 * explicitly extended; an empty pick must NOT silently fall through to
 * rank-1 beginner words in user-driven mode.
 */
export async function pickNewWordsNearFrontier(
  supabase: SupabaseClient,
  params: {
    userId: string;
    language: string;
    frontier: PlacementFrontier;
    limit: number;
    excludeWordIds: readonly string[];
  },
): Promise<Candidate[]> {
  const low = Math.max(1, Math.round(params.frontier.low * 0.85));
  const high = Math.round(params.frontier.rank + 300);
  const target = Math.round(params.frontier.rank * 0.9);

  const { data, error } = await supabase.rpc("pick_new_words_near_frontier", {
    p_low: low,
    p_high: high,
    p_target_rank: target,
    p_exclude_word_ids: [...params.excludeWordIds],
    p_limit: params.limit,
  } as never);

  if (error) {
    console.warn(
      "[pickNewWordsNearFrontier] RPC error; returning empty picks",
      error,
    );
    return [];
  }

  return (data ?? []) as Candidate[];
}
