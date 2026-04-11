import { getSupabaseServerContext } from "@/lib/supabase/server";
import {
  decideOnboardingGate,
  type OnboardingEntryMode,
  type OnboardingGateInput,
} from "./gate";

export type OnboardingState = OnboardingGateInput;

const VALID_ENTRY_MODES: readonly OnboardingEntryMode[] = [
  "beginner_default",
  "baseline",
  "self_certified",
];

function parseEntryMode(value: unknown): OnboardingEntryMode | null {
  if (typeof value !== "string") return null;
  return (VALID_ENTRY_MODES as readonly string[]).includes(value)
    ? (value as OnboardingEntryMode)
    : null;
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const { supabase, user } = await getSupabaseServerContext();
  if (!supabase || !user) {
    return {
      signedIn: false,
      hasSeenIntro: false,
      placementStatus: null,
      hasFrontierRank: false,
      onboardingCompletedAt: null,
      onboardingEntryMode: null,
    };
  }

  const { data } = await supabase
    .from("user_settings")
    .select(
      "has_seen_intro, onboarding_completed_at, onboarding_entry_mode, placement_status, current_frontier_rank",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    signedIn: true,
    hasSeenIntro: Boolean(data?.has_seen_intro),
    placementStatus: (data?.placement_status as string | null) ?? null,
    hasFrontierRank: data?.current_frontier_rank != null,
    onboardingCompletedAt:
      (data?.onboarding_completed_at as string | null) ?? null,
    onboardingEntryMode: parseEntryMode(data?.onboarding_entry_mode),
  };
}

export async function shouldRedirectToIntro(): Promise<boolean> {
  const state = await getOnboardingState();
  return decideOnboardingGate(state).action === "redirect_intro";
}
