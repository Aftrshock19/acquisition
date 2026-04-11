import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_TRACKED_RANK } from "./bands";

/**
 * First-week recalibration service.
 *
 * Reads real usage evidence (flashcard accuracy, reading-question accuracy,
 * session completion) and conservatively nudges the user's frontier rank.
 *
 * Philosophy:
 *   - Early days adapt faster (high gain), later days stabilize.
 *   - Only move in a direction if the evidence is consistent.
 *   - Keep a traceable explanation per move.
 */

export type RecalibrationInput = {
  currentFrontierRank: number | null;
  placementConfidence: number | null;
  baselineAt: string | null;
  reviewAccuracy: number | null;
  reviewCount: number;
  avgLatencyMs: number | null;
  readingQuestionAccuracy: number | null;
  readingQuestionCount: number;
  sessionCompletionRate: number | null;
  daysSinceBaseline: number;
};

export type RecalibrationResult = {
  nextFrontierRank: number;
  nextFrontierRankLow: number;
  nextFrontierRankHigh: number;
  nextConfidence: number;
  source: "baseline_plus_usage" | "usage_only" | "baseline_only";
  status: "calibrating" | "stable" | "estimated";
  traceEntry: Record<string, unknown>;
};

const MIN_FRONTIER = 100;

export function computeRecalibration(input: RecalibrationInput): RecalibrationResult | null {
  const base = input.currentFrontierRank ?? 500;
  const confidence = input.placementConfidence ?? 0;

  // Require at least some evidence to act.
  const hasReviewEvidence = input.reviewCount >= 8 && input.reviewAccuracy != null;
  const hasReadingEvidence =
    input.readingQuestionCount >= 3 && input.readingQuestionAccuracy != null;
  if (!hasReviewEvidence && !hasReadingEvidence) return null;

  // Gain decays from 0.18 on day 0 to ~0.05 by day 7.
  const dayFactor = Math.max(0.3, Math.exp(-input.daysSinceBaseline / 4));
  const gain = 0.18 * dayFactor;

  // Signal scores: 0 = very weak, 1 = very strong, 0.5 = neutral.
  const signals: Array<{ name: string; value: number; weight: number }> = [];
  if (hasReviewEvidence) {
    signals.push({
      name: "review_accuracy",
      value: clamp01(input.reviewAccuracy!),
      weight: Math.min(1, input.reviewCount / 25),
    });
  }
  if (hasReadingEvidence) {
    signals.push({
      name: "reading_question_accuracy",
      value: clamp01(input.readingQuestionAccuracy!),
      weight: Math.min(1, input.readingQuestionCount / 10),
    });
  }
  if (input.sessionCompletionRate != null) {
    signals.push({
      name: "session_completion_rate",
      value: clamp01(input.sessionCompletionRate),
      weight: 0.4,
    });
  }

  const weightTotal = signals.reduce((s, v) => s + v.weight, 0);
  if (weightTotal === 0) return null;
  const avgSignal = signals.reduce((s, v) => s + v.value * v.weight, 0) / weightTotal;

  // Map signal to a multiplicative frontier nudge around 1.0.
  // avgSignal 0.5 → 1.0, 0.9 → 1.15, 0.2 → 0.85.
  const rawMultiplier = 1 + (avgSignal - 0.5) * 0.6;
  const dampened = 1 + (rawMultiplier - 1) * gain;

  // Require signals to agree in direction; otherwise stay put.
  const agree = signals.every((s) =>
    avgSignal >= 0.5 ? s.value >= 0.45 : s.value <= 0.55,
  );
  const multiplier = agree ? dampened : 1;

  const nextFrontier = Math.round(
    clamp(base * multiplier, MIN_FRONTIER, MAX_TRACKED_RANK),
  );

  const width = Math.max(
    200,
    Math.round((1 - Math.min(0.9, confidence + 0.1 * signals.length)) * 800),
  );
  const low = Math.max(1, nextFrontier - width);
  const high = Math.min(MAX_TRACKED_RANK, nextFrontier + width);

  const nextConfidence = clamp01(confidence + 0.05 * signals.length * dayFactor);
  const status: RecalibrationResult["status"] =
    input.daysSinceBaseline >= 7 && nextConfidence >= 0.75 ? "stable" : "calibrating";

  return {
    nextFrontierRank: nextFrontier,
    nextFrontierRankLow: low,
    nextFrontierRankHigh: high,
    nextConfidence,
    source: input.currentFrontierRank == null ? "usage_only" : "baseline_plus_usage",
    status,
    traceEntry: {
      at: new Date().toISOString(),
      basis: "end_of_session",
      daysSinceBaseline: input.daysSinceBaseline,
      gain,
      signals,
      previousFrontier: base,
      nextFrontier,
      multiplier,
      agree,
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

// ── DB adapter ─────────────────────────────────────────────

export async function recalibratePlacementForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<RecalibrationResult | null> {
  const { data: settings } = await supabase
    .from("user_settings")
    .select(
      "current_frontier_rank, placement_confidence, placement_last_recalibrated_at, baseline_test_run_id, placement_recalibration_trace",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (!settings) return null;

  const since = new Date();
  since.setDate(since.getDate() - 10);
  const sinceIso = since.toISOString();

  const [{ data: reviews }, { data: readingQs }, { data: sessions }] = await Promise.all([
    supabase
      .from("review_events")
      .select("correct, ms_spent, happened_at")
      .eq("user_id", userId)
      .gte("happened_at", sinceIso)
      .limit(500),
    supabase
      .from("reading_question_attempts")
      .select("correct")
      .eq("user_id", userId)
      .gte("created_at", sinceIso)
      .limit(200),
    supabase
      .from("daily_sessions")
      .select("completed, stage, session_date")
      .eq("user_id", userId)
      .gte("session_date", sinceIso.slice(0, 10))
      .limit(30),
  ]);

  const reviewRows = (reviews ?? []) as { correct: boolean | null; ms_spent: number | null }[];
  const reviewCount = reviewRows.length;
  const reviewAccuracy =
    reviewCount > 0
      ? reviewRows.filter((r) => r.correct === true).length / reviewCount
      : null;
  const latencies = reviewRows
    .map((r) => r.ms_spent)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const avgLatencyMs =
    latencies.length > 0 ? latencies.reduce((s, v) => s + v, 0) / latencies.length : null;

  const readingRows = (readingQs ?? []) as { correct: boolean | null }[];
  const readingCount = readingRows.length;
  const readingAccuracy =
    readingCount > 0
      ? readingRows.filter((r) => r.correct === true).length / readingCount
      : null;

  const sessionRows = (sessions ?? []) as { completed: boolean | null }[];
  const completionRate =
    sessionRows.length > 0
      ? sessionRows.filter((r) => r.completed).length / sessionRows.length
      : null;

  const baselineAt = settings.placement_last_recalibrated_at as string | null;
  const daysSinceBaseline = baselineAt
    ? Math.max(0, (Date.now() - new Date(baselineAt).getTime()) / 86_400_000)
    : 0;

  const result = computeRecalibration({
    currentFrontierRank: settings.current_frontier_rank as number | null,
    placementConfidence: settings.placement_confidence as number | null,
    baselineAt,
    reviewAccuracy,
    reviewCount,
    avgLatencyMs,
    readingQuestionAccuracy: readingAccuracy,
    readingQuestionCount: readingCount,
    sessionCompletionRate: completionRate,
    daysSinceBaseline,
  });

  if (!result) return null;

  const trace = Array.isArray(settings.placement_recalibration_trace)
    ? (settings.placement_recalibration_trace as unknown[])
    : [];
  const nextTrace = [...trace.slice(-19), result.traceEntry];

  await supabase
    .from("user_settings")
    .update({
      current_frontier_rank: result.nextFrontierRank,
      current_frontier_rank_low: result.nextFrontierRankLow,
      current_frontier_rank_high: result.nextFrontierRankHigh,
      placement_confidence: result.nextConfidence,
      placement_status: result.status,
      placement_source: result.source,
      placement_last_recalibrated_at: new Date().toISOString(),
      placement_recalibration_trace: nextTrace,
    })
    .eq("user_id", userId);

  return result;
}
