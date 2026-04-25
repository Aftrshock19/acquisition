import { describe, expect, it } from "vitest";
import {
  buildLearningRangeViewModel,
  resolveTargetFromSession,
  type RawRangeInputs,
} from "./learningRange";

const baseInputs: RawRangeInputs = {
  currentFrontierRank: null,
  selfCertifiedCefr: null,
  onboardingEntryMode: null,
  target: 20,
};

describe("resolveTargetFromSession", () => {
  it("assigned > 0 wins over snapshot and fallback", () => {
    expect(resolveTargetFromSession(50, 30, 100)).toBe(50);
  });
  it("assigned null falls through to snapshot", () => {
    expect(resolveTargetFromSession(null, 30, 100)).toBe(30);
  });
  it("assigned 0 falls through to snapshot", () => {
    expect(resolveTargetFromSession(0, 30, 100)).toBe(30);
  });
  it("snapshot null falls through to fallback", () => {
    expect(resolveTargetFromSession(null, null, 100)).toBe(100);
  });
  it("snapshot 0 falls through to fallback", () => {
    expect(resolveTargetFromSession(0, 0, 100)).toBe(100);
  });
  it("negative snapshot is treated as missing", () => {
    expect(resolveTargetFromSession(null, -5, 100)).toBe(100);
  });
});

describe("buildLearningRangeViewModel — substage mapping", () => {
  it("null rank → A1-- with hasPlacement=false and 'placement not set' helper", () => {
    const vm = buildLearningRangeViewModel(baseInputs);
    expect(vm.label).toBe("A1--");
    expect(vm.frontierRank).toBeNull();
    expect(vm.hasPlacement).toBe(false);
    expect(vm.source).toBe("none");
    expect(vm.sourceLabel).toBe("Placement not set");
    expect(vm.helperCopy.toLowerCase()).toContain("placement");
    expect(vm.frontierDisplay).toBe("Not set yet");
    expect(vm.progressWithinRangePercent).toBe(0);
  });

  it("rank 1 → A1--", () => {
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: 1,
      onboardingEntryMode: "baseline",
    });
    expect(vm.label).toBe("A1--");
    expect(vm.rankMin).toBe(0);
    expect(vm.rankMax).toBe(150);
  });

  it("rank 150 → A1-- (boundary inclusive)", () => {
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: 150,
      onboardingEntryMode: "baseline",
    });
    expect(vm.label).toBe("A1--");
  });

  it("rank 151 → A1- (next bucket)", () => {
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: 151,
      onboardingEntryMode: "baseline",
    });
    expect(vm.label).toBe("A1-");
  });

  it("rank 6450 (mid B1) gives correct band, percent, and words-to-next", () => {
    // B1 = stage 13, rankMin=5901, rankMax=6900.
    // Position in band: 6450 - 5901 + 1 = 550 of 1000 → 55%.
    // Next band: B1+ starts at 6901, so wordsUntilNext = 6901 - 6450 = 451.
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: 6450,
      onboardingEntryMode: "baseline",
    });
    expect(vm.label).toBe("B1");
    expect(vm.rankMin).toBe(5901);
    expect(vm.rankMax).toBe(6900);
    expect(vm.progressWithinRangePercent).toBe(55);
    expect(vm.wordsUntilNextRange).toBe(451);
    expect(vm.nextLabel).toBe("B1+");
    expect(vm.isTopOfBank).toBe(false);
    expect(vm.frontierDisplay).toContain("6,450");
  });

  it("rank > 35000 → C2++ top of bank", () => {
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: 50000,
      onboardingEntryMode: "baseline",
    });
    expect(vm.label).toBe("C2++");
    expect(vm.isTopOfBank).toBe(true);
    expect(vm.wordsUntilNextRange).toBeNull();
    expect(vm.nextLabel).toBeNull();
    expect(vm.progressWithinRangePercent).toBe(100);
    expect(vm.helperCopy.toLowerCase()).toContain("top");
  });

  it("rank exactly 35000 (top boundary) → C2++ top of bank", () => {
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: 35000,
      onboardingEntryMode: "baseline",
    });
    expect(vm.label).toBe("C2++");
    expect(vm.isTopOfBank).toBe(true);
    expect(vm.nextLabel).toBeNull();
  });

  it("self-certified fallback when no rank: rank derived from CEFR_OPTIONS", () => {
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: null,
      selfCertifiedCefr: "B1",
      onboardingEntryMode: "self_certified",
    });
    // CEFR_OPTIONS B1 frontierRank = 2500 → falls in stage 8 (A2: 2401–2980).
    expect(vm.frontierRank).toBe(2500);
    expect(vm.label).toBe("A2");
    expect(vm.source).toBe("self_certified");
    expect(vm.sourceLabel).toBe("Self-certified");
    expect(vm.hasPlacement).toBe(true);
  });
});

describe("buildLearningRangeViewModel — passage mode from target", () => {
  it("target 20 → short", () => {
    const vm = buildLearningRangeViewModel({ ...baseInputs, target: 20 });
    expect(vm.passageMode).toBe("short");
  });
  it("target 30 → short (boundary inclusive)", () => {
    const vm = buildLearningRangeViewModel({ ...baseInputs, target: 30 });
    expect(vm.passageMode).toBe("short");
  });
  it("target 31 → medium", () => {
    const vm = buildLearningRangeViewModel({ ...baseInputs, target: 31 });
    expect(vm.passageMode).toBe("medium");
  });
  it("target 70 → medium (boundary inclusive)", () => {
    const vm = buildLearningRangeViewModel({ ...baseInputs, target: 70 });
    expect(vm.passageMode).toBe("medium");
  });
  it("target 71 → long", () => {
    const vm = buildLearningRangeViewModel({ ...baseInputs, target: 71 });
    expect(vm.passageMode).toBe("long");
  });
  it("target 130 → long (boundary inclusive)", () => {
    const vm = buildLearningRangeViewModel({ ...baseInputs, target: 130 });
    expect(vm.passageMode).toBe("long");
  });
  it("target 131 → very_long", () => {
    const vm = buildLearningRangeViewModel({ ...baseInputs, target: 131 });
    expect(vm.passageMode).toBe("very_long");
  });
  it("targetCards always reflects the input", () => {
    const vm = buildLearningRangeViewModel({ ...baseInputs, target: 42 });
    expect(vm.targetCards).toBe(42);
  });
});

describe("buildLearningRangeViewModel — source resolution", () => {
  it("rank present + onboarding_entry_mode='baseline' → placement source", () => {
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: 500,
      onboardingEntryMode: "baseline",
    });
    expect(vm.source).toBe("placement");
    expect(vm.sourceLabel).toBe("Placement test");
  });

  it("rank present + onboarding_entry_mode='self_certified' → self_certified source", () => {
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: 1200,
      selfCertifiedCefr: "A2",
      onboardingEntryMode: "self_certified",
    });
    expect(vm.source).toBe("self_certified");
    expect(vm.sourceLabel).toBe("Self-certified");
  });

  it("rank present + onboarding_entry_mode='beginner_default' → beginner_default source", () => {
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: 300,
      onboardingEntryMode: "beginner_default",
    });
    expect(vm.source).toBe("beginner_default");
    expect(vm.sourceLabel).toBe("Default starting range");
  });

  it("rank present + onboarding_entry_mode null (legacy) → placement", () => {
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: 500,
      onboardingEntryMode: null,
    });
    expect(vm.source).toBe("placement");
  });
});

describe("buildLearningRangeViewModel — helper copy gates", () => {
  it("no placement → helper points the user to placement", () => {
    const vm = buildLearningRangeViewModel(baseInputs);
    expect(vm.helperCopy.toLowerCase()).toContain("placement");
  });

  it("normal mid-band placement → standard explanation", () => {
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: 5000,
      onboardingEntryMode: "baseline",
    });
    expect(vm.helperCopy).toContain("vocabulary frontier");
    expect(vm.helperCopy).toContain("flashcard workload");
  });

  it("top of bank → top-of-bank copy", () => {
    const vm = buildLearningRangeViewModel({
      ...baseInputs,
      currentFrontierRank: 35000,
      onboardingEntryMode: "baseline",
    });
    expect(vm.helperCopy.toLowerCase()).toContain("top");
  });
});
