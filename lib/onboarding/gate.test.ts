import { describe, expect, it } from "vitest";
import { decideOnboardingGate } from "./gate";

const base = {
  signedIn: true,
  hasSeenIntro: false,
  placementStatus: "unknown" as string | null,
  hasFrontierRank: false,
  onboardingCompletedAt: null as string | null,
  onboardingEntryMode: null as
    | "beginner_default"
    | "baseline"
    | "self_certified"
    | null,
};

describe("decideOnboardingGate", () => {
  it("allows signed-out users through", () => {
    expect(decideOnboardingGate({ ...base, signedIn: false })).toEqual({
      action: "allow",
    });
  });

  it("redirects first-time signed-in users to the intro", () => {
    expect(decideOnboardingGate(base)).toEqual({ action: "redirect_intro" });
  });

  it("allows users who have seen the intro", () => {
    expect(
      decideOnboardingGate({ ...base, hasSeenIntro: true }),
    ).toEqual({ action: "allow" });
  });

  it("allows users who have already completed onboarding", () => {
    expect(
      decideOnboardingGate({
        ...base,
        onboardingCompletedAt: "2026-01-01T00:00:00Z",
      }),
    ).toEqual({ action: "allow" });
  });

  it("allows users whose placement is already known", () => {
    expect(
      decideOnboardingGate({ ...base, placementStatus: "estimated" }),
    ).toEqual({ action: "allow" });
  });

  it("allows users who already have a frontier rank", () => {
    expect(
      decideOnboardingGate({ ...base, hasFrontierRank: true }),
    ).toEqual({ action: "allow" });
  });

  it("allows users who finished onboarding as beginner_default", () => {
    expect(
      decideOnboardingGate({
        ...base,
        onboardingEntryMode: "beginner_default",
      }),
    ).toEqual({ action: "allow" });
  });

  it("allows users who finished onboarding as self_certified", () => {
    expect(
      decideOnboardingGate({ ...base, onboardingEntryMode: "self_certified" }),
    ).toEqual({ action: "allow" });
  });

  it("allows users who finished onboarding as baseline", () => {
    expect(
      decideOnboardingGate({ ...base, onboardingEntryMode: "baseline" }),
    ).toEqual({ action: "allow" });
  });
});
