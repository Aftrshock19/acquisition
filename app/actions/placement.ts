"use server";

import { revalidatePath } from "next/cache";

import { getSupabaseServerContext } from "@/lib/supabase/server";
import { getUserSettings } from "@/lib/settings/getUserSettings";
import { pickItemForCheckpoint } from "@/lib/placement/itemBank";
import { checkpointByIndex } from "@/lib/placement/checkpoints";
import { planNextItem, totalPlanned } from "@/lib/placement/selection";
import { estimatePlacement } from "@/lib/placement/scoring";
import { classifyCognate, lexicalWeightForCognate, type CognateClass } from "@/lib/placement/cognate";
import {
  classifyMorphology,
  effectiveDiagnosticRank,
  type MorphologyClass,
} from "@/lib/placement/morphology";
import { isRecallCorrect, normalizeAnswer } from "@/lib/placement/normalize";
import {
  fetchActiveRun,
  fetchLatestCompletedRun,
  fetchRunResponses,
  fetchUserExposure,
  type PlacementRunRow,
} from "@/lib/placement/persistence";
import {
  PLACEMENT_ALGORITHM_VERSION,
  type AdaptivePlacementEstimate,
  type PlacementEstimateStatus,
  type PlacementItem,
  type PlacementPlan,
} from "@/lib/placement/types";
import type { PlacementState, SubmitPlacementAnswerInput } from "@/lib/placement/state";

type AuthCtx = {
  supabase: NonNullable<Awaited<ReturnType<typeof getSupabaseServerContext>>["supabase"]>;
  userId: string;
  language: string;
};

async function requireAuth(): Promise<AuthCtx | { error: string }> {
  const { supabase, user, error } = await getSupabaseServerContext();
  if (!supabase) return { error: "config_missing" };
  if (error) return { error };
  if (!user) return { error: "not_signed_in" };
  const { settings } = await getUserSettings();
  return { supabase, userId: user.id, language: settings.learning_lang ?? "es" };
}

// Status → numeric back-compat for the legacy `confidence_score` column and
// downstream readers that still expect a 0–1 number.
function statusToConfidence(status: PlacementEstimateStatus): number {
  switch (status) {
    case "early":
      return 0.3;
    case "provisional":
      return 0.5;
    case "medium":
      return 0.7;
    case "high":
      return 0.9;
  }
}

// ── Read state ─────────────────────────────────────────────

export async function getPlacementState(): Promise<
  { ok: true; state: PlacementState } | { ok: false; error: string }
> {
  const ctx = await requireAuth();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { supabase, userId, language } = ctx;

  const active = await fetchActiveRun(supabase, userId);
  const latestCompleted = active ? null : await fetchLatestCompletedRun(supabase, userId);

  const { count: bankCount } = await supabase
    .from("baseline_item_bank")
    .select("id", { count: "exact", head: true })
    .eq("language", language)
    .eq("quality_status", "approved");
  const bankEmpty = (bankCount ?? 0) === 0;

  const base: PlacementState = {
    runId: active?.id ?? null,
    status: active?.status ?? "none",
    language,
    sequenceIndex: 0,
    totalPlanned: totalPlanned(),
    currentItem: null,
    currentPlan: null,
    estimate: null,
    hasCompletedRun: Boolean(latestCompleted),
    completedEstimate: latestCompleted
      ? buildCompletedEstimate(latestCompleted)
      : null,
    bankEmpty,
  };

  if (!active) return { ok: true, state: base };

  const responses = await fetchRunResponses(supabase, active.id);
  const plan = planNextItem(responses);
  let currentItem: PlacementItem | null = null;
  if (plan.stage !== "done" && plan.nextCheckpointIndex !== null && plan.nextItemType) {
    const { exposure } = await fetchUserExposure(supabase, userId, language, active.id);
    const seed = `${active.id}:${responses.length}`;
    const pick = await pickItemForCheckpoint(supabase, {
      language,
      checkpointIndex: plan.nextCheckpointIndex,
      itemType: plan.nextItemType,
      excludeItemBankIds: responses
        .map((r) => r.itemBankId)
        .filter((id): id is string => Boolean(id)),
      excludeWordIds: responses
        .map((r) => r.wordId)
        .filter((id): id is string => Boolean(id)),
      exposure,
      seed,
    });
    currentItem = pick?.item ?? null;
  }

  return {
    ok: true,
    state: {
      ...base,
      sequenceIndex: responses.length,
      currentItem,
      currentPlan: plan,
      estimate: responses.length > 0 ? estimatePlacement(responses) : null,
    },
  };
}

function buildCompletedEstimate(row: PlacementRunRow): AdaptivePlacementEstimate | null {
  if (row.estimated_frontier_rank == null) return null;
  const estimatedFrontierRank = row.estimated_frontier_rank;
  const frontierLow = row.estimated_frontier_rank_low ?? estimatedFrontierRank;
  const frontierHigh = row.estimated_frontier_rank_high ?? estimatedFrontierRank;
  const status =
    (row.estimate_status as PlacementEstimateStatus | null) ?? "provisional";
  return {
    confirmedFloorRank: row.confirmed_floor_rank ?? frontierLow,
    estimatedFrontierRank,
    frontierRankLow: frontierLow,
    frontierRankHigh: frontierHigh,
    estimateStatus: status,
    topOfBankReached: Boolean(row.top_of_bank_reached),
    bracketLowIndex: row.bracket_low_index,
    bracketHighIndex: row.bracket_high_index,
    consecutiveWrong: 0,
    maxConsecutiveWrong: row.max_consecutive_wrong ?? 0,
    itemsAnswered:
      row.total_items_administered ??
      (row.recognition_items_answered + row.recall_items_answered),
    rawAccuracy: 0,
    estimatedReceptiveVocab: row.estimated_receptive_vocab ?? 0,
    highestClearedFloorIndex: row.highest_cleared_floor_index,
    highestTentativeFloorIndex: row.highest_tentative_floor_index,
    totalFloorsVisited: row.total_floors_visited ?? 0,
    floorOutcomes: Array.isArray(row.floor_outcomes)
      ? (row.floor_outcomes as AdaptivePlacementEstimate["floorOutcomes"])
      : [],
    frontierEvidenceQuality:
      (row.frontier_evidence_quality as AdaptivePlacementEstimate["frontierEvidenceQuality"] | null) ??
      "low",
    nonCognateSupportPresent: Boolean(row.non_cognate_support_present),
    cognateHeavyEstimate: Boolean(row.cognate_heavy_estimate),
    morphologyHeavyEstimate: Boolean(row.morphology_heavy_estimate),
  };
}

// ── Mutations ──────────────────────────────────────────────

export async function startPlacementRun(): Promise<
  { ok: true; state: PlacementState } | { ok: false; error: string }
> {
  const ctx = await requireAuth();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { supabase, userId, language } = ctx;

  const existing = await fetchActiveRun(supabase, userId);
  if (existing) return getPlacementState();

  const { error } = await supabase
    .from("baseline_test_runs")
    .insert({
      user_id: userId,
      language,
      status: "in_progress",
      started_at: new Date().toISOString(),
      algorithm_version: PLACEMENT_ALGORITHM_VERSION,
    });
  if (error) return { ok: false, error: error.message };

  await supabase
    .from("user_settings")
    .upsert(
      { user_id: userId, placement_status: "calibrating" },
      { onConflict: "user_id" },
    );

  revalidatePath("/placement");
  revalidatePath("/today");
  return getPlacementState();
}

export async function skipPlacementRun(): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireAuth();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { supabase, userId, language } = ctx;

  await supabase
    .from("baseline_test_runs")
    .insert({
      user_id: userId,
      language,
      status: "skipped",
      skipped_at: new Date().toISOString(),
      algorithm_version: PLACEMENT_ALGORITHM_VERSION,
    });

  await supabase
    .from("user_settings")
    .upsert(
      { user_id: userId, placement_status: "unknown", placement_source: "usage_only" },
      { onConflict: "user_id" },
    );

  revalidatePath("/placement");
  revalidatePath("/today");
  return { ok: true };
}

export async function submitPlacementAnswer(
  input: SubmitPlacementAnswerInput,
): Promise<
  | { ok: true; state: PlacementState; isCorrect: boolean }
  | { ok: false; error: string }
> {
  const ctx = await requireAuth();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { supabase, userId, language } = ctx;

  const { data: runRow } = await supabase
    .from("baseline_test_runs")
    .select("*")
    .eq("id", input.runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!runRow) return { ok: false, error: "run_not_found" };
  if (runRow.status !== "in_progress") return { ok: false, error: "run_not_active" };

  const { data: itemRow, error: itemErr } = await supabase
    .from("baseline_item_bank")
    .select("*")
    .eq("id", input.itemBankId)
    .maybeSingle();
  if (itemErr || !itemRow) return { ok: false, error: "item_not_found" };

  const existing = await fetchRunResponses(supabase, input.runId);
  const sequenceIndex = existing.length;

  // The checkpoint the picker was told to serve for this item. Re-planning
  // against the pre-answer history reproduces the picker's choice exactly, so
  // we can record the *intended* checkpoint on the response row instead of
  // the item's raw frequency rank. This matters because the picker widens
  // its window when the tight pool is thin: a cp-9 request may legitimately
  // serve an item at rank ~21k, but that item still logically probes cp 9.
  // Storing its raw rank would cause checkpointStats → nearestCheckpointIndex
  // to misattribute it to cp 8, preventing the engine from ever advancing.
  const intendedPlan = planNextItem(existing);
  const intendedCp =
    intendedPlan.nextCheckpointIndex != null
      ? checkpointByIndex(intendedPlan.nextCheckpointIndex)
      : null;
  const floorIndex = intendedPlan.nextCheckpointIndex ?? null;
  const floorSequence = intendedPlan.currentFloorSequence;

  // Derive fairness metadata. We prefer the row's stored values (from seed)
  // but recompute on the fly if the column is missing, so the engine works
  // against older banks too.
  const rowCognateClass = ((itemRow as Record<string, unknown>).cognate_class as CognateClass | null) ?? null;
  const rowMorphClass = ((itemRow as Record<string, unknown>).morphology_class as MorphologyClass | null) ?? null;
  const rowLemmaRank = ((itemRow as Record<string, unknown>).lemma_rank as number | null) ?? null;
  const rowEffectiveRank = ((itemRow as Record<string, unknown>).effective_diagnostic_rank as number | null) ?? null;

  const cognate =
    rowCognateClass !== null
      ? { cognateClass: rowCognateClass, similarity: 0, rule: "row" as const }
      : classifyCognate(itemRow.lemma, itemRow.correct_answer);
  const morphology =
    rowMorphClass !== null
      ? classifyMorphology(itemRow.lemma, itemRow.pos)
      : classifyMorphology(itemRow.lemma, itemRow.pos);
  const cognateClass = rowCognateClass ?? cognate.cognateClass;
  const morphologyClass = rowMorphClass ?? morphology.morphologyClass;
  const isInflectedForm =
    ((itemRow as Record<string, unknown>).is_inflected_form as boolean | null) ?? morphology.isInflectedForm;
  const lemmaRank = rowLemmaRank ?? itemRow.frequency_rank;
  const effRank =
    rowEffectiveRank ?? effectiveDiagnosticRank(lemmaRank, morphology);
  const lexicalWeight = lexicalWeightForCognate(cognateClass);
  const morphologyWeight = morphology.morphologyWeight;

  // Look up this user's prior-attempt exposure so we can record whether the
  // item we're about to log was a previous-attempt reuse. This is the same
  // exposure map the picker consults; reading it here closes the loop on the
  // round-trip from picker → client → submit.
  const { exposure } = await fetchUserExposure(supabase, userId, language, input.runId);
  const itemExposure = exposure.get(itemRow.id);
  const previousAttemptSeen = Boolean(itemExposure?.inImmediatePrevious);
  const reuseDueToPoolExhaustion = previousAttemptSeen;
  const selectionSeed = `${input.runId}:${sequenceIndex}`;

  let isCorrect = false;
  let normalizedResponse: string | null = null;
  const usedIdk = Boolean(input.usedIdk);

  if (usedIdk) {
    isCorrect = false;
  } else if (itemRow.item_type === "recognition") {
    const options = (itemRow.options as string[] | null) ?? [];
    const picked =
      typeof input.chosenOptionIndex === "number" ? options[input.chosenOptionIndex] : null;
    if (picked) {
      normalizedResponse = normalizeAnswer(picked);
      isCorrect = normalizeAnswer(picked) === normalizeAnswer(itemRow.correct_answer);
    }
  } else {
    const text = input.chosenText ?? "";
    normalizedResponse = normalizeAnswer(text);
    isCorrect = isRecallCorrect(
      text,
      itemRow.correct_answer,
      (itemRow.accepted_answers as string[] | null) ?? null,
    );
  }

  const { error: insertErr } = await supabase.from("baseline_test_responses").insert({
    run_id: input.runId,
    user_id: userId,
    word_id: itemRow.word_id,
    item_bank_id: itemRow.id,
    sequence_index: sequenceIndex,
    item_type: itemRow.item_type,
    // Record the *intended* checkpoint's center (duplicated into both band
    // columns) so checkpointStats maps this response to the checkpoint the
    // picker was asked to probe. Using the item's raw rank instead would let
    // a widened pick drift into a neighbouring checkpoint's bucket and stall
    // the engine. If we somehow don't have a plan (shouldn't happen mid-run)
    // fall back to the item's rank.
    band_start: intendedCp?.center ?? itemRow.frequency_rank ?? itemRow.band_start,
    band_end: intendedCp?.center ?? itemRow.frequency_rank ?? itemRow.band_end,
    prompt_stem: itemRow.prompt_stem,
    prompt_sentence: itemRow.prompt_sentence,
    options: itemRow.options,
    chosen_option_index: input.chosenOptionIndex ?? null,
    chosen_text: input.chosenText ?? null,
    normalized_response: normalizedResponse,
    is_correct: isCorrect,
    used_idk: usedIdk,
    latency_ms: input.latencyMs ?? null,
    score_weight: 1,
    metadata: {},
    previous_attempt_seen: previousAttemptSeen,
    reuse_due_to_pool_exhaustion: reuseDueToPoolExhaustion,
    selection_seed: selectionSeed,
    floor_index: floorIndex,
    floor_sequence: floorSequence,
    cognate_class: cognateClass,
    morphology_class: morphologyClass,
    is_inflected_form: isInflectedForm,
    lemma_rank: lemmaRank,
    effective_diagnostic_rank: effRank,
    lexical_weight: lexicalWeight,
    morphology_weight: morphologyWeight,
  });
  if (insertErr) return { ok: false, error: insertErr.message };

  const responses = await fetchRunResponses(supabase, input.runId);
  const estimate = estimatePlacement(responses);
  const recognitionCount = responses.filter((r) => r.itemType === "recognition").length;
  const recallCount = responses.filter((r) => r.itemType === "recall").length;

  const plan = planNextItem(responses);
  const isDone = plan.stage === "done";
  const confidence = statusToConfidence(estimate.estimateStatus);

  await supabase
    .from("baseline_test_runs")
    .update({
      recognition_items_answered: recognitionCount,
      recall_items_answered: recallCount,
      estimated_frontier_rank: estimate.estimatedFrontierRank,
      estimated_frontier_rank_low: estimate.frontierRankLow,
      estimated_frontier_rank_high: estimate.frontierRankHigh,
      estimated_receptive_vocab: estimate.estimatedReceptiveVocab,
      confidence_score: confidence,
      raw_recognition_accuracy: estimate.rawAccuracy,
      raw_recall_accuracy: estimate.rawAccuracy,
      // Adaptive v2 fields.
      confirmed_floor_rank: estimate.confirmedFloorRank,
      top_of_bank_reached: estimate.topOfBankReached,
      stop_reason: isDone ? plan.stopReason : "in_progress",
      estimate_status: estimate.estimateStatus,
      bracket_low_index: estimate.bracketLowIndex,
      bracket_high_index: estimate.bracketHighIndex,
      max_consecutive_wrong: estimate.maxConsecutiveWrong,
      total_items_administered: estimate.itemsAnswered,
      highest_cleared_floor_index: estimate.highestClearedFloorIndex,
      highest_tentative_floor_index: estimate.highestTentativeFloorIndex,
      total_floors_visited: estimate.totalFloorsVisited,
      floor_outcomes: estimate.floorOutcomes,
      frontier_evidence_quality: estimate.frontierEvidenceQuality,
      non_cognate_support_present: estimate.nonCognateSupportPresent,
      cognate_heavy_estimate: estimate.cognateHeavyEstimate,
      morphology_heavy_estimate: estimate.morphologyHeavyEstimate,
      placement_summary: {
        stage: plan.stage,
        confirmedFloorRank: estimate.confirmedFloorRank,
        estimatedFrontierRank: estimate.estimatedFrontierRank,
        topOfBankReached: estimate.topOfBankReached,
        estimateStatus: estimate.estimateStatus,
        stopReason: plan.stopReason,
        bracketLowIndex: estimate.bracketLowIndex,
        bracketHighIndex: estimate.bracketHighIndex,
      },
      item_selection_trace: serializeTrace(runRow.item_selection_trace, plan, itemRow.id, {
        previousAttemptSeen,
        reuseDueToPoolExhaustion,
        selectionSeed,
      }),
      status: isDone ? "completed" : "in_progress",
      completed_at: isDone ? new Date().toISOString() : null,
    })
    .eq("id", input.runId);

  if (isDone) {
    await supabase
      .from("user_settings")
      .upsert(
        {
          user_id: userId,
          baseline_test_run_id: input.runId,
          current_frontier_rank: estimate.estimatedFrontierRank,
          current_frontier_rank_low: estimate.frontierRankLow,
          current_frontier_rank_high: estimate.frontierRankHigh,
          placement_confidence: confidence,
          placement_status: "estimated",
          placement_source: "baseline_only",
          placement_last_recalibrated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
  }

  revalidatePath("/placement");
  revalidatePath("/today");
  const next = await getPlacementState();
  if (!next.ok) return next;
  return { ok: true, state: next.state, isCorrect };
}

function serializeTrace(
  previous: unknown,
  plan: PlacementPlan,
  pickedId: string,
  exposure: {
    previousAttemptSeen: boolean;
    reuseDueToPoolExhaustion: boolean;
    selectionSeed: string;
  },
): unknown[] {
  const base = Array.isArray(previous) ? (previous as unknown[]) : [];
  return [
    ...base,
    {
      stage: plan.stage,
      nextCheckpointIndex: plan.nextCheckpointIndex,
      nextItemType: plan.nextItemType,
      bracketLowIndex: plan.bracketLowIndex,
      bracketHighIndex: plan.bracketHighIndex,
      stopReason: plan.stopReason,
      reason: plan.reason,
      pickedItemBankId: pickedId,
      previousAttemptSeen: exposure.previousAttemptSeen,
      reuseDueToPoolExhaustion: exposure.reuseDueToPoolExhaustion,
      selectionSeed: exposure.selectionSeed,
      at: new Date().toISOString(),
    },
  ];
}

export async function retakePlacementTest(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const ctx = await requireAuth();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { supabase, userId, language } = ctx;

  await supabase
    .from("baseline_test_runs")
    .update({ status: "abandoned" })
    .eq("user_id", userId)
    .in("status", ["not_started", "in_progress"]);

  const { error } = await supabase.from("baseline_test_runs").insert({
    user_id: userId,
    language,
    status: "in_progress",
    started_at: new Date().toISOString(),
    algorithm_version: PLACEMENT_ALGORITHM_VERSION,
  });
  if (error) return { ok: false, error: error.message };

  await supabase
    .from("user_settings")
    .upsert(
      { user_id: userId, placement_status: "calibrating" },
      { onConflict: "user_id" },
    );

  revalidatePath("/placement");
  revalidatePath("/today");
  return { ok: true };
}
