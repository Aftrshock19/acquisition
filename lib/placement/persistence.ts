import type { SupabaseClient } from "@supabase/supabase-js";
import type { CognateClass } from "./cognate";
import type { MorphologyClass } from "./morphology";
import { buildExposureMap, type ExposureMap, type PriorResponseRow } from "./exposure";
import type { PlacementResponseRecord, PlacementRunStatus } from "./types";

export type PlacementRunRow = {
  id: string;
  user_id: string;
  language: string;
  status: PlacementRunStatus;
  started_at: string | null;
  completed_at: string | null;
  skipped_at: string | null;
  algorithm_version: string;
  recognition_items_answered: number;
  recall_items_answered: number;
  estimated_frontier_rank: number | null;
  estimated_frontier_rank_low: number | null;
  estimated_frontier_rank_high: number | null;
  estimated_receptive_vocab: number | null;
  confidence_score: number | null;
  raw_recognition_accuracy: number | null;
  raw_recall_accuracy: number | null;
  placement_summary: Record<string, unknown>;
  item_selection_trace: unknown[];
  created_at: string;
  updated_at: string;
  // Adaptive v2 columns.
  confirmed_floor_rank: number | null;
  top_of_bank_reached: boolean | null;
  stop_reason: string | null;
  estimate_status: string | null;
  bracket_low_index: number | null;
  bracket_high_index: number | null;
  max_consecutive_wrong: number | null;
  total_items_administered: number | null;
  // Adaptive v3 fairness columns.
  highest_cleared_floor_index: number | null;
  highest_tentative_floor_index: number | null;
  total_floors_visited: number | null;
  floor_outcomes: unknown;
  frontier_evidence_quality: string | null;
  non_cognate_support_present: boolean | null;
  cognate_heavy_estimate: boolean | null;
  morphology_heavy_estimate: boolean | null;
};

type ResponseRow = {
  id: string;
  run_id: string;
  user_id: string;
  word_id: string | null;
  item_bank_id: string | null;
  sequence_index: number;
  item_type: "recognition" | "recall";
  band_start: number;
  band_end: number;
  prompt_stem: string;
  prompt_sentence: string | null;
  options: string[] | null;
  chosen_option_index: number | null;
  chosen_text: string | null;
  normalized_response: string | null;
  is_correct: boolean;
  used_idk: boolean;
  latency_ms: number | null;
  score_weight: number;
  metadata: Record<string, unknown>;
  answered_at: string;
  floor_index: number | null;
  floor_sequence: number | null;
  cognate_class: CognateClass | null;
  morphology_class: MorphologyClass | null;
  is_inflected_form: boolean | null;
  lemma_rank: number | null;
  effective_diagnostic_rank: number | null;
  lexical_weight: number | null;
  morphology_weight: number | null;
};

export function responseRowToRecord(row: ResponseRow): PlacementResponseRecord {
  return {
    itemBankId: row.item_bank_id,
    wordId: row.word_id,
    sequenceIndex: row.sequence_index,
    itemType: row.item_type,
    bandStart: row.band_start,
    bandEnd: row.band_end,
    promptStem: row.prompt_stem,
    promptSentence: row.prompt_sentence,
    options: row.options,
    chosenOptionIndex: row.chosen_option_index,
    chosenText: row.chosen_text,
    normalizedResponse: row.normalized_response,
    isCorrect: row.is_correct,
    usedIdk: row.used_idk,
    latencyMs: row.latency_ms,
    scoreWeight: row.score_weight,
    metadata: row.metadata ?? {},
    floorIndex: row.floor_index,
    floorSequence: row.floor_sequence,
    cognateClass: row.cognate_class ?? "non_cognate",
    morphologyClass: row.morphology_class ?? "base",
    isInflectedForm: row.is_inflected_form ?? false,
    lemmaRank: row.lemma_rank,
    effectiveDiagnosticRank: row.effective_diagnostic_rank,
    lexicalWeight: row.lexical_weight ?? 1.0,
    morphologyWeight: row.morphology_weight ?? 1.0,
  };
}

export async function fetchActiveRun(
  supabase: SupabaseClient,
  userId: string,
): Promise<PlacementRunRow | null> {
  const { data } = await supabase
    .from("baseline_test_runs")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["not_started", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PlacementRunRow | null) ?? null;
}

export async function fetchLatestCompletedRun(
  supabase: SupabaseClient,
  userId: string,
): Promise<PlacementRunRow | null> {
  const { data } = await supabase
    .from("baseline_test_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PlacementRunRow | null) ?? null;
}

/**
 * Build a per-user exposure map from prior diagnostic attempts. Excludes
 * the current run so the picker doesn't double-count items being served by
 * the in-flight attempt.
 *
 * Returns the exposure map plus the ordered list of prior run ids
 * (most-recent-first), which the caller may surface in traces.
 */
export async function fetchUserExposure(
  supabase: SupabaseClient,
  userId: string,
  language: string,
  currentRunId: string | null,
): Promise<{ exposure: ExposureMap; priorRuns: string[] }> {
  // Pull the user's most recent diagnostic runs (excluding the active one).
  const runQ = supabase
    .from("baseline_test_runs")
    .select("id, completed_at, created_at")
    .eq("user_id", userId)
    .eq("language", language)
    .in("status", ["completed", "abandoned"])
    .order("created_at", { ascending: false })
    .limit(10);
  const { data: runRows } = await runQ;
  const runs = (runRows as { id: string; completed_at: string | null; created_at: string }[] | null) ?? [];
  const priorRuns = runs.map((r) => r.id).filter((id) => id !== currentRunId);

  if (priorRuns.length === 0) {
    return { exposure: new Map(), priorRuns: [] };
  }

  const { data: respRows } = await supabase
    .from("baseline_test_responses")
    .select("run_id, item_bank_id, answered_at")
    .eq("user_id", userId)
    .in("run_id", priorRuns)
    .limit(2000);
  const rows = (respRows as PriorResponseRow[] | null) ?? [];
  return { exposure: buildExposureMap(rows, priorRuns), priorRuns };
}

export async function fetchRunResponses(
  supabase: SupabaseClient,
  runId: string,
): Promise<PlacementResponseRecord[]> {
  const { data } = await supabase
    .from("baseline_test_responses")
    .select("*")
    .eq("run_id", runId)
    .order("sequence_index", { ascending: true });
  return ((data as ResponseRow[] | null) ?? []).map(responseRowToRecord);
}
