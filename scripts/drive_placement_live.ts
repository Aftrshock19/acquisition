/**
 * Live placement runtime driver.
 *
 * Replicates the exact flow of the `submitPlacementAnswer` server action
 * against the real Supabase DB, using the service role key to bypass auth.
 * Runs an initial diagnostic + a retake for a throwaway test user and dumps
 * the floor-level trace + final run row so we can confirm:
 *   - pickItemForCheckpoint is honouring the fairness tiering,
 *   - planNextItem is using floor outcomes,
 *   - effective_diagnostic_rank flows end-to-end,
 *   - retake exposure differentiation still works.
 *
 * Usage: npx tsx scripts/drive_placement_live.ts
 */

import { config } from "dotenv";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

import { CHECKPOINTS, checkpointByIndex } from "../lib/placement/checkpoints";
import { pickItemForCheckpoint } from "../lib/placement/itemBank";
import { buildExposureMap } from "../lib/placement/exposure";
import { planNextItem, estimatePlacement } from "../lib/placement/adaptive";
import {
  fetchRunResponses,
  fetchUserExposure,
} from "../lib/placement/persistence";
import {
  classifyCognate,
  lexicalWeightForCognate,
  type CognateClass,
} from "../lib/placement/cognate";
import {
  classifyMorphology,
  effectiveDiagnosticRank,
  type MorphologyClass,
} from "../lib/placement/morphology";
import {
  DEFAULT_PLACEMENT_CONFIG,
  PLACEMENT_ALGORITHM_VERSION,
} from "../lib/placement/types";

config({ path: path.resolve(__dirname, "..", ".env.local") });
config({ path: path.resolve(__dirname, "..", ".env") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) throw new Error("missing supabase env");

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const LANG = "es";
const TRUE_RANK = 4500; // mid-bank learner: "clears ~cp5, fails ~cp6"

// Deterministic synthetic user id scoped to this driver.
const USER_ID = "00000000-0000-0000-0000-00000fa11fa1";

async function ensureUser() {
  const { error } = await supabase.auth.admin.getUserById(USER_ID);
  if (error) {
    await supabase.auth.admin.createUser({
      id: USER_ID,
      email: "placement-driver@example.com",
      email_confirm: true,
      password: "driver-only-not-used",
    });
  }
}

async function cleanupRuns() {
  await supabase.from("baseline_test_runs").delete().eq("user_id", USER_ID);
}

async function startRun() {
  const { data, error } = await supabase
    .from("baseline_test_runs")
    .insert({
      user_id: USER_ID,
      language: LANG,
      status: "in_progress",
      started_at: new Date().toISOString(),
      algorithm_version: PLACEMENT_ALGORITHM_VERSION,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`run start failed: ${error?.message}`);
  return data.id as string;
}

type RowItem = {
  id: string;
  word_id: string;
  item_type: "recognition" | "recall";
  lemma: string;
  pos: string | null;
  correct_answer: string;
  frequency_rank: number;
  band_start: number;
  band_end: number;
  cognate_class: CognateClass | null;
  morphology_class: MorphologyClass | null;
  lemma_rank: number | null;
  effective_diagnostic_rank: number | null;
  is_inflected_form: boolean | null;
  options: string[] | null;
  prompt_stem: string;
  prompt_sentence: string | null;
  accepted_answers: string[] | null;
};

async function driveRun(label: string, trueRank: number) {
  console.log(`\n── ${label} ─────────────────────────────────`);
  const runId = await startRun();

  for (let step = 0; step < DEFAULT_PLACEMENT_CONFIG.maxItems + 4; step += 1) {
    const priorResponses = await fetchRunResponses(supabase, runId);
    const plan = planNextItem(priorResponses);
    if (plan.shouldStop || plan.nextCheckpointIndex === null) {
      console.log(
        `  [stop] itemsAnswered=${plan.itemsAnswered} reason=${plan.stopReason} bracket=[${plan.bracketLowIndex},${plan.bracketHighIndex}]`,
      );
      break;
    }

    // Exposure map so retake prefers fresh items.
    const { exposure } = await fetchUserExposure(supabase, USER_ID, LANG, runId);

    const answered = new Set(priorResponses.map((r) => r.itemBankId));
    const answeredWordIds = new Set(priorResponses.map((r) => r.wordId));
    const pick = await pickItemForCheckpoint(supabase, {
      language: LANG,
      checkpointIndex: plan.nextCheckpointIndex,
      itemType: plan.nextItemType ?? "recognition",
      excludeItemBankIds: Array.from(answered),
      excludeWordIds: Array.from(answeredWordIds),
      exposure: exposure ?? buildExposureMap([]),
      seed: `${runId}:${priorResponses.length}`,
    });
    if (!pick) {
      console.log(`  [skip] no item available at cp ${plan.nextCheckpointIndex}`);
      break;
    }

    const { data: itemRow, error: itemErr } = await supabase
      .from("baseline_item_bank")
      .select(
        "id,word_id,item_type,lemma,pos,correct_answer,frequency_rank,band_start,band_end,cognate_class,morphology_class,lemma_rank,effective_diagnostic_rank,is_inflected_form,options,prompt_stem,prompt_sentence,accepted_answers",
      )
      .eq("id", pick.item.id)
      .single<RowItem>();
    if (itemErr || !itemRow) break;

    const intendedCp = checkpointByIndex(plan.nextCheckpointIndex);
    const floorIndex = plan.nextCheckpointIndex;
    const floorSequence = plan.currentFloorSequence;

    const rowCognate = itemRow.cognate_class;
    const morphology = classifyMorphology(itemRow.lemma, itemRow.pos);
    const cognateClass =
      rowCognate ?? classifyCognate(itemRow.lemma, itemRow.correct_answer).cognateClass;
    const morphologyClass = itemRow.morphology_class ?? morphology.morphologyClass;
    const lemmaRank = itemRow.lemma_rank ?? itemRow.frequency_rank;
    const effRank =
      itemRow.effective_diagnostic_rank ?? effectiveDiagnosticRank(lemmaRank, morphology);
    const isInflectedForm = itemRow.is_inflected_form ?? morphology.isInflectedForm;
    const lexicalWeight = lexicalWeightForCognate(cognateClass);
    const morphologyWeight = morphology.morphologyWeight;

    // Simulated respondent:
    //   - correct with high prob if effRank <= trueRank,
    //   - wrong with high prob otherwise,
    //   - strong cognates get a +15% fluke boost (to exercise the non-cognate
    //     support rule), marked forms get a -15% penalty.
    let p = effRank <= trueRank ? 0.92 : 0.15;
    if (cognateClass === "strong_cognate") p = Math.min(0.98, p + 0.15);
    if (morphologyClass === "irregular_or_marked_inflection")
      p = Math.max(0.05, p - 0.15);
    const isCorrect = Math.random() < p;

    const { error: insertErr } = await supabase.from("baseline_test_responses").insert({
      run_id: runId,
      user_id: USER_ID,
      word_id: itemRow.word_id,
      item_bank_id: itemRow.id,
      sequence_index: priorResponses.length,
      item_type: itemRow.item_type,
      band_start: intendedCp?.center ?? itemRow.frequency_rank,
      band_end: intendedCp?.center ?? itemRow.frequency_rank,
      prompt_stem: itemRow.prompt_stem,
      prompt_sentence: itemRow.prompt_sentence,
      options: itemRow.options,
      chosen_option_index: null,
      chosen_text: isCorrect ? itemRow.correct_answer : "__wrong__",
      normalized_response: isCorrect ? itemRow.correct_answer : "__wrong__",
      is_correct: isCorrect,
      used_idk: false,
      latency_ms: 1000,
      score_weight: 1,
      metadata: {},
      selection_seed: `${runId}:${priorResponses.length}`,
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
    if (insertErr) {
      console.log(`  [insert-error] ${insertErr.message}`);
      break;
    }

    const tag = `${isCorrect ? "✓" : "✗"} cp${floorIndex} ${itemRow.lemma}(r${lemmaRank}/e${effRank}) ${cognateClass[0]}${cognateClass === "non_cognate" ? "N" : cognateClass === "strong_cognate" ? "S" : "W"}/${morphologyClass === "base" ? "B" : morphologyClass === "irregular_or_marked_inflection" ? "M" : "I"}`;
    console.log(`  step${String(step).padStart(2)}: ${tag}`);
  }

  const finalResponses = await fetchRunResponses(supabase, runId);
  const est = estimatePlacement(finalResponses);
  const finalPlan = planNextItem(finalResponses);

  await supabase
    .from("baseline_test_runs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      total_items_administered: est.itemsAnswered,
      confirmed_floor_rank: est.confirmedFloorRank,
      estimated_frontier_rank: est.estimatedFrontierRank,
      estimated_frontier_rank_low: est.frontierRankLow,
      estimated_frontier_rank_high: est.frontierRankHigh,
      estimated_receptive_vocab: est.estimatedReceptiveVocab,
      top_of_bank_reached: est.topOfBankReached,
      stop_reason: finalPlan.stopReason,
      estimate_status: est.estimateStatus,
      bracket_low_index: est.bracketLowIndex,
      bracket_high_index: est.bracketHighIndex,
      raw_recognition_accuracy: est.rawAccuracy,
      raw_recall_accuracy: est.rawAccuracy,
      highest_cleared_floor_index: est.highestClearedFloorIndex,
      highest_tentative_floor_index: est.highestTentativeFloorIndex,
      total_floors_visited: est.totalFloorsVisited,
      floor_outcomes: est.floorOutcomes,
      frontier_evidence_quality: est.frontierEvidenceQuality,
      non_cognate_support_present: est.nonCognateSupportPresent,
      cognate_heavy_estimate: est.cognateHeavyEstimate,
      morphology_heavy_estimate: est.morphologyHeavyEstimate,
    })
    .eq("id", runId);

  console.log(`\n  summary:`);
  console.log(`    floors visited: ${est.totalFloorsVisited}`);
  console.log(
    `    floor outcomes: ${est.floorOutcomes
      .map(
        (f) =>
          `cp${f.checkpointIndex}[${f.correct}/${f.itemsServed}:${f.outcome.slice(
            0,
            4,
          )}]`,
      )
      .join(" → ")}`,
  );
  console.log(
    `    highest cleared: ${est.highestClearedFloorIndex}  tentative: ${est.highestTentativeFloorIndex}`,
  );
  console.log(
    `    confirmed floor rank: ${est.confirmedFloorRank}  frontier: ~${est.estimatedFrontierRank} in [${est.frontierRankLow},${est.frontierRankHigh}]`,
  );
  console.log(
    `    bracket idx: [${est.bracketLowIndex},${est.bracketHighIndex}]  evidence: ${est.frontierEvidenceQuality}  nonCognateSupport=${est.nonCognateSupportPresent}  cogHeavy=${est.cognateHeavyEstimate}  morphHeavy=${est.morphologyHeavyEstimate}`,
  );
  console.log(
    `    stop reason: ${finalPlan.stopReason}  items=${est.itemsAnswered}  top_reached=${est.topOfBankReached}`,
  );

  // Sanity: count non-cognate exposure vs strong-cognate exposure served.
  const nonCog = finalResponses.filter((r) => r.cognateClass === "non_cognate").length;
  const weak = finalResponses.filter((r) => r.cognateClass === "weak_cognate").length;
  const strong = finalResponses.filter((r) => r.cognateClass === "strong_cognate").length;
  const marked = finalResponses.filter(
    (r) => r.morphologyClass === "irregular_or_marked_inflection",
  ).length;
  console.log(
    `    pool composition served: non=${nonCog} weak=${weak} strong=${strong}  marked_forms=${marked}`,
  );

  return runId;
}

async function main() {
  await ensureUser();
  await cleanupRuns();
  console.log(`[driver] lang=${LANG} trueRank=${TRUE_RANK}`);
  console.log(
    `[driver] checkpoints: ${CHECKPOINTS.map((c, i) => `${i}:${c.center}`).join(", ")}`,
  );

  const run1 = await driveRun("INITIAL DIAGNOSTIC", TRUE_RANK);
  const run2 = await driveRun("RETAKE", TRUE_RANK);

  // Dump retake item overlap against initial to verify exposure differentiation.
  const r1 = await fetchRunResponses(supabase, run1);
  const r2 = await fetchRunResponses(supabase, run2);
  const set1 = new Set(r1.map((r) => r.itemBankId));
  const overlap = r2.filter((r) => set1.has(r.itemBankId)).length;
  console.log(
    `\n[overlap] retake reused ${overlap}/${r2.length} items from the first run (lower is healthier)`,
  );

  await cleanupRuns();
  console.log(`\n[driver] cleaned up test runs`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
