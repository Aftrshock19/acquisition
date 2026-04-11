/**
 * Total number of screens in the first-run onboarding. Screens 1..7 are the
 * linear explanatory carousel; screen 8 (index 7) is the branching start
 * chooser that exits into beginner_default, baseline, or self_certified.
 */
export const INTRO_PAGE_COUNT = 8;

export type IntroNavAction = "next" | "back";

export type IntroNavState = {
  page: number;
  isLast: boolean;
  canGoBack: boolean;
  ctaLabel: "Next" | "Choose how to start";
};

export function introNavState(page: number): IntroNavState {
  const clamped = Math.max(0, Math.min(INTRO_PAGE_COUNT - 1, page));
  const isLast = clamped === INTRO_PAGE_COUNT - 1;
  return {
    page: clamped,
    isLast,
    canGoBack: clamped > 0,
    ctaLabel: isLast ? "Choose how to start" : "Next",
  };
}

export function introNavReduce(page: number, action: IntroNavAction): number {
  if (action === "next") {
    return Math.min(INTRO_PAGE_COUNT - 1, page + 1);
  }
  return Math.max(0, page - 1);
}

/**
 * Branching state for the final onboarding screen. Separate from the linear
 * 4-page carousel because we need to ask a top-level question first, then
 * optionally present two sub-choices without losing Back navigation.
 */
export type StartBranchStep =
  | { kind: "ask_experience" }
  | { kind: "pick_path" } // user said yes → show baseline vs self-cert
  | { kind: "pick_cefr" }; // user chose self-certify → show CEFR picker

export type StartBranchAction =
  | { kind: "answer_experience"; hasExperience: boolean }
  | { kind: "choose_self_certify" }
  | { kind: "back" };

export function startBranchReduce(
  step: StartBranchStep,
  action: StartBranchAction,
): StartBranchStep {
  if (action.kind === "answer_experience") {
    // "No" exits the branch entirely (handled by the caller, which triggers
    // the beginner-default commit). "Yes" advances to the path picker.
    return action.hasExperience ? { kind: "pick_path" } : step;
  }
  if (action.kind === "choose_self_certify") {
    return { kind: "pick_cefr" };
  }
  if (action.kind === "back") {
    if (step.kind === "pick_cefr") return { kind: "pick_path" };
    if (step.kind === "pick_path") return { kind: "ask_experience" };
    return step;
  }
  return step;
}

export function startBranchCanGoBack(step: StartBranchStep): boolean {
  return step.kind !== "ask_experience";
}
