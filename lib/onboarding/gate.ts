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
  | { action: "redirect_intro" }
  | { action: "redirect_placement" };

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

  // Baseline mode is set the moment the user clicks "Start" in the intro,
  // *before* the placement check actually runs, and stays "calibrating"
  // for the duration of an in-progress test. Treat it as done only once
  // placement_status reflects a finished result — otherwise the user
  // would silently bypass placement by closing the app mid-flow.
  if (input.onboardingEntryMode === "baseline") {
    const placementDone =
      input.placementStatus !== null &&
      input.placementStatus !== "unknown" &&
      input.placementStatus !== "calibrating";
    return placementDone
      ? { action: "allow" }
      : { action: "redirect_placement" };
  }

  // beginner_default and self_certified both commit a frontier and complete
  // onboarding atomically, so reaching this branch means they're done.
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
