export type OnboardingEntryMode =
  | "beginner_default"
  | "baseline"
  | "self_certified";

export type OnboardingGateInput = {
  signedIn: boolean;
  hasSeenIntro: boolean;
  placementStatus: string | null;
  hasFrontierRank: boolean;
  onboardingCompletedAt: string | null;
  onboardingEntryMode: OnboardingEntryMode | null;
};

export type OnboardingGateDecision =
  | { action: "allow" }
  | { action: "redirect_intro" };

/**
 * Pure decision function for whether a signed-in user should be routed
 * through the first-run introduction flow. Kept side-effect free so it can
 * be unit tested without a database.
 */
export function decideOnboardingGate(
  input: OnboardingGateInput,
): OnboardingGateDecision {
  if (!input.signedIn) return { action: "allow" };

  if (input.onboardingCompletedAt) return { action: "allow" };

  // A terminal entry mode (beginner_default, baseline, or self_certified)
  // means onboarding finished — even if onboarding_completed_at failed to
  // persist for some reason, this alone is enough to bypass the intro.
  if (input.onboardingEntryMode) return { action: "allow" };

  if (input.hasSeenIntro) return { action: "allow" };

  const placementDone =
    input.hasFrontierRank ||
    (input.placementStatus !== null &&
      input.placementStatus !== "unknown" &&
      input.placementStatus !== "");

  if (placementDone) return { action: "allow" };

  return { action: "redirect_intro" };
}
