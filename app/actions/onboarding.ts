"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerContext } from "@/lib/supabase/server";
import {
  BEGINNER_DEFAULT_FRONTIER,
  cefrOption,
  isCefrLevel,
  type CefrLevel,
} from "@/lib/onboarding/cefr";

export type MarkIntroSeenResult = { ok: true } | { ok: false; error: string };

/**
 * Marks the first-run introduction as seen for the current user.
 * Safe to call multiple times — upserts on user_id.
 */
export async function markIntroSeen(): Promise<MarkIntroSeenResult> {
  const { supabase, user } = await getSupabaseServerContext();
  if (!supabase) return { ok: false, error: "no_supabase" };
  if (!user) return { ok: false, error: "not_signed_in" };

  const { error } = await supabase
    .from("user_settings")
    .upsert(
      {
        user_id: user.id,
        has_seen_intro: true,
      },
      { onConflict: "user_id" },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Marks first-run onboarding as fully completed. Called once the baseline
 * placement test finishes so that even if the user later clears their
 * placement_status we do not re-show the intro flow.
 */
export async function markOnboardingCompleted(): Promise<MarkIntroSeenResult> {
  const { supabase, user } = await getSupabaseServerContext();
  if (!supabase) return { ok: false, error: "no_supabase" };
  if (!user) return { ok: false, error: "not_signed_in" };

  const { error } = await supabase
    .from("user_settings")
    .upsert(
      {
        user_id: user.id,
        has_seen_intro: true,
        onboarding_completed_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * User said they are new to Spanish. Skip baseline placement entirely and
 * seed the adaptive system at the very start of the frequency list.
 * Idempotent.
 */
export async function completeOnboardingAsBeginner(): Promise<MarkIntroSeenResult> {
  const { supabase, user } = await getSupabaseServerContext();
  if (!supabase) return { ok: false, error: "no_supabase" };
  if (!user) return { ok: false, error: "not_signed_in" };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("user_settings")
    .upsert(
      {
        user_id: user.id,
        has_seen_intro: true,
        onboarding_completed_at: now,
        onboarding_entry_mode: "beginner_default",
        self_certified_cefr_level: null,
        current_frontier_rank: BEGINNER_DEFAULT_FRONTIER.frontierRank,
        current_frontier_rank_low: BEGINNER_DEFAULT_FRONTIER.frontierRankLow,
        current_frontier_rank_high: BEGINNER_DEFAULT_FRONTIER.frontierRankHigh,
        placement_status: "estimated",
        placement_source: "usage_only",
        placement_last_recalibrated_at: now,
      },
      { onConflict: "user_id" },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * User chose to self-certify a CEFR level instead of taking the baseline.
 * Maps the CEFR level to an initial frontier rank and marks onboarding
 * complete. The recalibration layer remains free to adjust this as the user
 * practises — self-certification is explicitly a starting point, not a lock.
 */
export async function completeOnboardingAsSelfCertified(
  level: CefrLevel,
): Promise<MarkIntroSeenResult> {
  if (!isCefrLevel(level)) return { ok: false, error: "invalid_level" };

  const { supabase, user } = await getSupabaseServerContext();
  if (!supabase) return { ok: false, error: "no_supabase" };
  if (!user) return { ok: false, error: "not_signed_in" };

  const option = cefrOption(level);
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("user_settings")
    .upsert(
      {
        user_id: user.id,
        has_seen_intro: true,
        onboarding_completed_at: now,
        onboarding_entry_mode: "self_certified",
        self_certified_cefr_level: level,
        current_frontier_rank: option.frontierRank,
        current_frontier_rank_low: option.frontierRankLow,
        current_frontier_rank_high: option.frontierRankHigh,
        placement_status: "estimated",
        placement_source: "usage_only",
        placement_last_recalibrated_at: now,
      },
      { onConflict: "user_id" },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * User chose to take the baseline placement test. Marks intro seen (so if
 * they abandon mid-flow we don't re-show the intro) and records the chosen
 * entry mode. Actual placement completion continues to run through the
 * existing placement action.
 */
export async function startOnboardingAsBaseline(): Promise<MarkIntroSeenResult> {
  const { supabase, user } = await getSupabaseServerContext();
  if (!supabase) return { ok: false, error: "no_supabase" };
  if (!user) return { ok: false, error: "not_signed_in" };

  const { error } = await supabase
    .from("user_settings")
    .upsert(
      {
        user_id: user.id,
        has_seen_intro: true,
        onboarding_entry_mode: "baseline",
      },
      { onConflict: "user_id" },
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}
