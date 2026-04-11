import type { SupabaseClient } from "@supabase/supabase-js";

export type PlacementFrontier = {
  rank: number;
  low: number;
  high: number;
};

/**
 * Given a user frontier estimate, pick new-word candidates near the frontier.
 * We bias "start slightly below the frontier" to stay conservative.
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
  const { data: seen } = await supabase
    .from("user_words")
    .select("word_id")
    .eq("user_id", params.userId)
    .in("word_id", ids);
  const seenSet = new Set(
    ((seen ?? []) as Array<{ word_id: string }>).map((r) => r.word_id),
  );
  const excludedSet = new Set(params.excludeWordIds);

  const filtered = (candidates as Array<{ id: string; rank: number }>).filter(
    (c) => !seenSet.has(c.id) && !excludedSet.has(c.id),
  );

  // Sort by absolute distance to a slightly-below-frontier target.
  const target = Math.round(params.frontier.rank * 0.9);
  filtered.sort((a, b) => Math.abs(a.rank - target) - Math.abs(b.rank - target));
  return filtered.slice(0, params.limit);
}
