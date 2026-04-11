import { describe, expect, it } from "vitest";
import {
  BEGINNER_DEFAULT_FRONTIER,
  CEFR_OPTIONS,
  cefrOption,
  isCefrLevel,
} from "./cefr";
import { decideOnboardingGate, type OnboardingGateInput } from "./gate";
import {
  INTRO_PAGE_COUNT,
  introNavReduce,
  introNavState,
  startBranchCanGoBack,
  startBranchReduce,
  type StartBranchStep,
} from "./introNavigation";

/**
 * Full first-run onboarding integration test.
 *
 * Simulates the real runtime chain against an in-memory user_settings record.
 * The branching final page covers three exit paths: beginner_default,
 * baseline, and self_certified.
 */

type FakeSettings = {
  has_seen_intro: boolean;
  onboarding_completed_at: string | null;
  onboarding_entry_mode:
    | "beginner_default"
    | "baseline"
    | "self_certified"
    | null;
  self_certified_cefr_level: string | null;
  placement_status: string | null;
  current_frontier_rank: number | null;
  current_frontier_rank_low: number | null;
  current_frontier_rank_high: number | null;
};

function emptySettings(): FakeSettings {
  return {
    has_seen_intro: false,
    onboarding_completed_at: null,
    onboarding_entry_mode: null,
    self_certified_cefr_level: null,
    placement_status: "unknown",
    current_frontier_rank: null,
    current_frontier_rank_low: null,
    current_frontier_rank_high: null,
  };
}

function fakeGetOnboardingState(
  s: FakeSettings,
  signedIn = true,
): OnboardingGateInput {
  return {
    signedIn,
    hasSeenIntro: s.has_seen_intro,
    placementStatus: s.placement_status,
    hasFrontierRank: s.current_frontier_rank != null,
    onboardingCompletedAt: s.onboarding_completed_at,
    onboardingEntryMode: s.onboarding_entry_mode,
  };
}

/** Simulated write side of completeOnboardingAsBeginner. */
function commitBeginner(s: FakeSettings) {
  s.has_seen_intro = true;
  s.onboarding_completed_at = "2026-04-11T00:00:00Z";
  s.onboarding_entry_mode = "beginner_default";
  s.current_frontier_rank = BEGINNER_DEFAULT_FRONTIER.frontierRank;
  s.current_frontier_rank_low = BEGINNER_DEFAULT_FRONTIER.frontierRankLow;
  s.current_frontier_rank_high = BEGINNER_DEFAULT_FRONTIER.frontierRankHigh;
  s.placement_status = "estimated";
}

/** Simulated write side of completeOnboardingAsSelfCertified. */
function commitSelfCertified(s: FakeSettings, level: "A1" | "A2" | "B1" | "B2" | "C1") {
  const opt = cefrOption(level);
  s.has_seen_intro = true;
  s.onboarding_completed_at = "2026-04-11T00:00:00Z";
  s.onboarding_entry_mode = "self_certified";
  s.self_certified_cefr_level = level;
  s.current_frontier_rank = opt.frontierRank;
  s.current_frontier_rank_low = opt.frontierRankLow;
  s.current_frontier_rank_high = opt.frontierRankHigh;
  s.placement_status = "estimated";
}

/** Simulated write side of startOnboardingAsBaseline + baseline completion. */
function commitBaselineStart(s: FakeSettings) {
  s.has_seen_intro = true;
  s.onboarding_entry_mode = "baseline";
}
function commitBaselineFinish(s: FakeSettings) {
  s.onboarding_completed_at = "2026-04-11T00:00:00Z";
  s.current_frontier_rank = 1200;
  s.current_frontier_rank_low = 900;
  s.current_frontier_rank_high = 1500;
  s.placement_status = "estimated";
}

describe("first-run onboarding flow (integration)", () => {
  it("routes a first-time user through all linear intro pages", () => {
    const settings = emptySettings();
    expect(
      decideOnboardingGate(fakeGetOnboardingState(settings)).action,
    ).toBe("redirect_intro");

    let page = 0;
    // Walk forward through every linear screen (0..6), back once, forward again.
    for (let i = 0; i < INTRO_PAGE_COUNT - 2; i++) {
      page = introNavReduce(page, "next");
    }
    page = introNavReduce(page, "back");
    page = introNavReduce(page, "next");
    page = introNavReduce(page, "next"); // land on final branching page
    expect(page).toBe(INTRO_PAGE_COUNT - 1);
    expect(introNavState(page).isLast).toBe(true);
  });

  it("'No, I'm new to Spanish' commits beginner_default and bypasses baseline", () => {
    const settings = emptySettings();

    // Branch starts at ask_experience
    let branch: StartBranchStep = { kind: "ask_experience" };
    expect(startBranchCanGoBack(branch)).toBe(false);

    // User answers No → caller triggers beginner commit, branch itself does
    // not advance because the exit is terminal.
    branch = startBranchReduce(branch, {
      kind: "answer_experience",
      hasExperience: false,
    });
    expect(branch.kind).toBe("ask_experience");

    commitBeginner(settings);

    // No baseline row was touched; routing should now allow
    expect(
      decideOnboardingGate(fakeGetOnboardingState(settings)).action,
    ).toBe("allow");
    expect(settings.onboarding_entry_mode).toBe("beginner_default");
    expect(settings.current_frontier_rank).toBe(
      BEGINNER_DEFAULT_FRONTIER.frontierRank,
    );
    expect(settings.self_certified_cefr_level).toBeNull();
  });

  it("'Yes' → 'Take quick placement' routes into baseline", () => {
    const settings = emptySettings();

    let branch: StartBranchStep = { kind: "ask_experience" };
    branch = startBranchReduce(branch, {
      kind: "answer_experience",
      hasExperience: true,
    });
    expect(branch.kind).toBe("pick_path");
    expect(startBranchCanGoBack(branch)).toBe(true);

    // User picks baseline → startOnboardingAsBaseline writes and caller
    // navigates to /placement; then baseline run finishes.
    commitBaselineStart(settings);
    commitBaselineFinish(settings);

    expect(settings.onboarding_entry_mode).toBe("baseline");
    expect(
      decideOnboardingGate(fakeGetOnboardingState(settings)).action,
    ).toBe("allow");
  });

  it("'Yes' → 'Choose my own level' shows the CEFR picker and persists", () => {
    const settings = emptySettings();

    let branch: StartBranchStep = { kind: "ask_experience" };
    branch = startBranchReduce(branch, {
      kind: "answer_experience",
      hasExperience: true,
    });
    branch = startBranchReduce(branch, { kind: "choose_self_certify" });
    expect(branch.kind).toBe("pick_cefr");
    expect(startBranchCanGoBack(branch)).toBe(true);

    // Back from CEFR picker lands on pick_path
    const backed = startBranchReduce(branch, { kind: "back" });
    expect(backed.kind).toBe("pick_path");

    // Going forward again and picking B1
    branch = startBranchReduce(backed, { kind: "choose_self_certify" });
    expect(branch.kind).toBe("pick_cefr");
    commitSelfCertified(settings, "B1");

    expect(settings.onboarding_entry_mode).toBe("self_certified");
    expect(settings.self_certified_cefr_level).toBe("B1");
    expect(settings.current_frontier_rank).toBe(cefrOption("B1").frontierRank);
    expect(
      decideOnboardingGate(fakeGetOnboardingState(settings)).action,
    ).toBe("allow");
  });

  it("legacy users with an existing placement still bypass intro", () => {
    const settings: FakeSettings = {
      ...emptySettings(),
      placement_status: "stable",
      current_frontier_rank: 2500,
      current_frontier_rank_low: 2000,
      current_frontier_rank_high: 3000,
    };
    expect(
      decideOnboardingGate(fakeGetOnboardingState(settings)).action,
    ).toBe("allow");
  });

  it("gate is idempotent — repeat calls never flip to redirect", () => {
    const settings = emptySettings();
    commitBeginner(settings);
    for (let i = 0; i < 5; i++) {
      expect(
        decideOnboardingGate(fakeGetOnboardingState(settings)).action,
      ).toBe("allow");
    }
  });

  it("does not show intro to signed-out visitors", () => {
    expect(
      decideOnboardingGate(fakeGetOnboardingState(emptySettings(), false))
        .action,
    ).toBe("allow");
  });

  it("has an 8-screen onboarding (7 linear + branching final)", () => {
    expect(INTRO_PAGE_COUNT).toBe(8);
  });

  it("exposes 5 CEFR options with can-do descriptions", () => {
    expect(CEFR_OPTIONS.length).toBe(5);
    for (const opt of CEFR_OPTIONS) {
      expect(isCefrLevel(opt.level)).toBe(true);
      expect(opt.canDo.length).toBeGreaterThan(10);
      expect(opt.frontierRankLow).toBeLessThanOrEqual(opt.frontierRank);
      expect(opt.frontierRank).toBeLessThanOrEqual(opt.frontierRankHigh);
    }
  });

  it("CEFR frontier ranks strictly increase from A1 to C1", () => {
    const ranks = CEFR_OPTIONS.map((o) => o.frontierRank);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
  });
});
