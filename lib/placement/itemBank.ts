import type { SupabaseClient } from "@supabase/supabase-js";
import { CHECKPOINTS, checkpointByIndex } from "./checkpoints";
import {
  selectFromPool,
  type ExposureMap,
  type PoolCandidate,
  type SelectionResult,
} from "./exposure";
import type { PlacementItem, PlacementItemType } from "./types";

type Row = {
  id: string;
  language: string;
  word_id: string | null;
  lemma: string;
  frequency_rank: number;
  pos: string | null;
  item_type: PlacementItemType;
  prompt_sentence: string | null;
  prompt_stem: string;
  correct_answer: string;
  accepted_answers: string[] | null;
  options: string[] | null;
  band_start: number;
  band_end: number;
};

const SELECT_COLUMNS =
  "id, language, word_id, lemma, frequency_rank, pos, item_type, prompt_sentence, prompt_stem, correct_answer, accepted_answers, options, band_start, band_end";

function rowToItem(row: Row): PlacementItem {
  return {
    id: row.id,
    language: row.language,
    wordId: row.word_id,
    lemma: row.lemma,
    frequencyRank: row.frequency_rank,
    pos: row.pos,
    itemType: row.item_type,
    promptSentence: row.prompt_sentence,
    promptStem: row.prompt_stem,
    correctAnswer: row.correct_answer,
    acceptedAnswers: row.accepted_answers,
    options: row.options,
    bandStart: row.band_start,
    bandEnd: row.band_end,
  };
}

export type PickResult = {
  item: PlacementItem;
  selection: SelectionResult;
  /** Number of widening passes the picker took to find this item. 0 = tight. */
  widenSteps: number;
};

export type PickInput = {
  language: string;
  checkpointIndex: number;
  itemType: PlacementItemType;
  excludeItemBankIds: readonly string[];
  /** Word ids to exclude — prevents the same lemma from appearing as both a
   *  recognition and a recall item within one attempt. */
  excludeWordIds?: readonly string[];
  exposure: ExposureMap;
  seed: string;
};

/**
 * Pick an item for a given checkpoint with retake-aware exposure control.
 *
 * Pool building strategy:
 *   - tight checkpoint window first
 *   - widen ±50%, then ±100% if not enough fresh items
 *   - finally drop the window entirely (full bank) before allowing reuse
 *
 * The actual choice within each pool is delegated to `selectFromPool`, which
 * applies exclusion → freshness tiering → seeded randomness among the top K
 * candidates. Reuse_due_to_pool_exhaustion is surfaced on the result so the
 * caller can persist it to the response row.
 */
export async function pickItemForCheckpoint(
  supabase: SupabaseClient,
  params: PickInput,
): Promise<PickResult | null> {
  const cp = checkpointByIndex(params.checkpointIndex);
  if (!cp) return null;

  const targetRank = cp.center;
  const excludeIds = new Set(params.excludeItemBankIds);

  // Concentric widenings: tight, ±50%, ±100%, then full bank.
  const widenings: Array<{ low: number; high: number }> = [
    { low: cp.windowLow, high: cp.windowHigh },
    {
      low: Math.max(1, Math.round(cp.center * 0.5)),
      high: Math.round(cp.center * 1.5),
    },
    {
      low: Math.max(1, Math.round(cp.center * 0.25)),
      high: Math.round(cp.center * 2),
    },
    { low: 1, high: CHECKPOINTS[CHECKPOINTS.length - 1].windowHigh },
  ];

  for (let step = 0; step < widenings.length; step += 1) {
    const win = widenings[step];
    const pool = await fetchPool({
      supabase,
      language: params.language,
      itemType: params.itemType,
      lowRank: win.low,
      highRank: win.high,
      targetRank,
      excludeWordIds: params.excludeWordIds ?? [],
    });
    if (pool.length === 0) continue;

    const candidates: PoolCandidate[] = pool.map((r) => ({
      itemBankId: r.id,
      frequencyRank: r.frequency_rank,
    }));

    const selection = selectFromPool(candidates, {
      targetRank,
      excludeIds,
      exposure: params.exposure,
      seed: `${params.seed}:${params.checkpointIndex}:${params.itemType}:w${step}`,
    });
    if (!selection) continue;

    // For tight + ±50% windows, prefer to retry-with-widening when the only
    // option is a previous-attempt reuse. We accept reuse only at the widest
    // step, so we exhaust *all* fresh widenings before falling back to a
    // hard repeat.
    if (selection.reuseDueToPoolExhaustion && step < widenings.length - 1) {
      continue;
    }

    const row = pool.find((r) => r.id === selection.pickedId);
    if (!row) continue;
    return { item: rowToItem(row), selection, widenSteps: step };
  }

  return null;
}

type FetchPoolArgs = {
  supabase: SupabaseClient;
  language: string;
  itemType: PlacementItemType;
  lowRank: number;
  highRank: number;
  targetRank: number;
  excludeWordIds: readonly string[];
};

async function fetchPool(args: FetchPoolArgs): Promise<Row[]> {
  // Symmetric fetch around the target: up to 100 items with rank ≤ target
  // ordered descending, and up to 100 with rank > target ordered ascending.
  // Without the ordering, an unordered .limit() returns an arbitrary slice
  // of the window (often all clustered at one end).
  const build = () =>
    args.supabase
      .from("baseline_item_bank")
      .select(SELECT_COLUMNS)
      .eq("language", args.language)
      .eq("item_type", args.itemType)
      .eq("quality_status", "approved")
      .gte("frequency_rank", args.lowRank)
      .lte("frequency_rank", args.highRank);

  let belowQ = build()
    .lte("frequency_rank", args.targetRank)
    .order("frequency_rank", { ascending: false })
    .limit(100);
  let aboveQ = build()
    .gt("frequency_rank", args.targetRank)
    .order("frequency_rank", { ascending: true })
    .limit(100);

  if (args.excludeWordIds.length > 0) {
    // PostgREST `in` list — quote each id. Supabase JS accepts a stringified
    // parenthesised list for `.not("word_id", "in", ...)`.
    const list = `(${args.excludeWordIds.map((id) => `"${id}"`).join(",")})`;
    belowQ = belowQ.not("word_id", "in", list);
    aboveQ = aboveQ.not("word_id", "in", list);
  }

  const [below, above] = await Promise.all([belowQ, aboveQ]);

  const rows: Row[] = [];
  if (!below.error && below.data) rows.push(...(below.data as Row[]));
  if (!above.error && above.data) rows.push(...(above.data as Row[]));
  return rows;
}

// Back-compat: legacy callers that still expect band-based picking continue
// to work by mapping the band index onto the nearest checkpoint. The same
// exposure-aware logic applies; callers that haven't been updated yet pass
// an empty exposure map and a fixed seed (no retake differentiation).
export async function pickItemForBand(
  supabase: SupabaseClient,
  params: {
    language: string;
    bandIndex: number;
    itemType: PlacementItemType;
    excludeItemBankIds: readonly string[];
  },
): Promise<PlacementItem | null> {
  const result = await pickItemForCheckpoint(supabase, {
    language: params.language,
    checkpointIndex: params.bandIndex,
    itemType: params.itemType,
    excludeItemBankIds: params.excludeItemBankIds,
    exposure: new Map(),
    seed: "legacy",
  });
  return result?.item ?? null;
}
