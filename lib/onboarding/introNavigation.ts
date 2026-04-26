/**
 * Total number of screens in the first-run onboarding. Screens 1..3 are the
 * linear explanatory carousel; screen 4 (index 3) is the single placement
 * start screen which sends the user into /placement (or, via a secondary
 * link, to /choose-level for self-certification).
 */
export const INTRO_PAGE_COUNT = 4;

export type IntroNavAction = "next" | "back";

export type IntroNavState = {
  page: number;
  isLast: boolean;
  canGoBack: boolean;
};

export function introNavState(page: number): IntroNavState {
  const clamped = Math.max(0, Math.min(INTRO_PAGE_COUNT - 1, page));
  return {
    page: clamped,
    isLast: clamped === INTRO_PAGE_COUNT - 1,
    canGoBack: clamped > 0,
  };
}

export function introNavReduce(page: number, action: IntroNavAction): number {
  if (action === "next") {
    return Math.min(INTRO_PAGE_COUNT - 1, page + 1);
  }
  return Math.max(0, page - 1);
}
