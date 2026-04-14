import type { SupabaseClient } from "@supabase/supabase-js";

export type PlacementFrontier = {
  rank: number;
  low: number;
  high: number;
};

/**
 * Given a user frontier estimate, pick new-word candidates near the frontier.
 * We bias "start slightly below the frontier" to stay conservative.
 *
 * Also excludes words the user already answered in any baseline test run, so
 * a diagnostic item is not immediately re-served as a cold-start "new" card
 * in the first post-baseline session. If the baseline-exclusion would starve
 * the queue, we fall back to the pre-exclusion pool to keep the queue full.
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
): Promise<Array<{ id: string; rank: number }>> {
  const low = Math.max(1, Math.round(params.frontier.low * 0.85));
  const high = Math.round(params.frontier.rank + 300);

  // Fetch candidate ranks near the frontier. The current `words` schema is
  // single-language; the `language` param is reserved for a future split.
  const { data: candidates } = await supabase
    .from("words")
    .select("id, rank")
    .gte("rank", low)
    .lte("rank", high)
    .order("rank", { ascending: true })
    .limit(params.limit * 6);
  if (!candidates || candidates.length === 0) return [];

  // Exclude words the user has already seen (in user_words).
  const ids = candidates.map((c) => (c as { id: string }).id);
  const [{ data: seen }, { data: baselineSeen }] = await Promise.all([
    supabase
      .from("user_words")
      .select("word_id")
      .eq("user_id", params.userId)
      .in("word_id", ids),
    // Baseline-tested word_ids overlapping the candidate set. Scoped by
    // candidate ids so this stays cheap even for users with many runs.
    supabase
      .from("baseline_test_responses")
      .select("word_id")
      .eq("user_id", params.userId)
      .in("word_id", ids),
  ]);
  const seenSet = new Set(
    ((seen ?? []) as Array<{ word_id: string | null }>)
      .map((r) => r.word_id)
      .filter((id): id is string => Boolean(id)),
  );
  const baselineSet = new Set(
    ((baselineSeen ?? []) as Array<{ word_id: string | null }>)
      .map((r) => r.word_id)
      .filter((id): id is string => Boolean(id)),
  );
  const excludedSet = new Set(params.excludeWordIds);

  const allCandidates = candidates as Array<{ id: string; rank: number }>;

  // Primary filter: drop seen + explicitly excluded + baseline-tested.
  const primary = allCandidates.filter(
    (c) => !seenSet.has(c.id) && !excludedSet.has(c.id) && !baselineSet.has(c.id),
  );

  // Fallback: if the baseline exclusion starves the primary pool, relax it
  // but still drop user_words/explicit exclusions. This preserves queue size
  // for users whose frontier band is saturated with baseline items.
  const relaxed = allCandidates.filter(
    (c) => !seenSet.has(c.id) && !excludedSet.has(c.id),
  );

  const pool = primary.length >= params.limit ? primary : (primary.length > 0 ? primary : relaxed);

  // Sort by absolute distance to a slightly-below-frontier target.
  const target = Math.round(params.frontier.rank * 0.9);
  pool.sort((a, b) => Math.abs(a.rank - target) - Math.abs(b.rank - target));

  // If primary was non-empty but short, top up from relaxed (without dupes).
  if (pool === primary && primary.length < params.limit) {
    const have = new Set(primary.map((p) => p.id));
    const topUp = relaxed
      .filter((c) => !have.has(c.id))
      .sort((a, b) => Math.abs(a.rank - target) - Math.abs(b.rank - target));
    return [...primary, ...topUp].slice(0, params.limit);
  }

  return pool.slice(0, params.limit);
}
