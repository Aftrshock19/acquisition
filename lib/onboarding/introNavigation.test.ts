import { describe, expect, it } from "vitest";
import {
  INTRO_PAGE_COUNT,
  introNavReduce,
  introNavState,
  startBranchCanGoBack,
  startBranchReduce,
  type StartBranchStep,
} from "./introNavigation";

describe("intro navigation", () => {
  it("has exactly 8 pages (7 linear + branching final)", () => {
    expect(INTRO_PAGE_COUNT).toBe(8);
  });

  it("starts on page 0 with no Back and Next CTA", () => {
    const s = introNavState(0);
    expect(s.page).toBe(0);
    expect(s.canGoBack).toBe(false);
    expect(s.isLast).toBe(false);
    expect(s.ctaLabel).toBe("Next");
  });

  it("Next moves forward, clamped at the last page", () => {
    expect(introNavReduce(0, "next")).toBe(1);
    expect(introNavReduce(5, "next")).toBe(6);
    expect(introNavReduce(INTRO_PAGE_COUNT - 1, "next")).toBe(
      INTRO_PAGE_COUNT - 1,
    );
  });

  it("walking Next from 0 eventually lands on the branching final page", () => {
    let page = 0;
    for (let i = 0; i < INTRO_PAGE_COUNT - 1; i++) {
      page = introNavReduce(page, "next");
    }
    expect(page).toBe(INTRO_PAGE_COUNT - 1);
    expect(introNavState(page).isLast).toBe(true);
  });

  it("Back moves backward, clamped at the first page", () => {
    expect(introNavReduce(1, "back")).toBe(0);
    expect(introNavReduce(0, "back")).toBe(0);
  });

  it("exposes Back only after the first page", () => {
    expect(introNavState(0).canGoBack).toBe(false);
    expect(introNavState(1).canGoBack).toBe(true);
    expect(introNavState(INTRO_PAGE_COUNT - 1).canGoBack).toBe(true);
  });

  it("final page advertises the branching choose-how-to-start CTA", () => {
    for (let i = 0; i < INTRO_PAGE_COUNT - 1; i++) {
      expect(introNavState(i).ctaLabel).toBe("Next");
      expect(introNavState(i).isLast).toBe(false);
    }
    const last = introNavState(INTRO_PAGE_COUNT - 1);
    expect(last.isLast).toBe(true);
    expect(last.ctaLabel).toBe("Choose how to start");
  });
});

describe("start-branch reducer", () => {
  it("starts at ask_experience with no back", () => {
    const step: StartBranchStep = { kind: "ask_experience" };
    expect(startBranchCanGoBack(step)).toBe(false);
  });

  it("'Yes' advances to pick_path", () => {
    const next = startBranchReduce(
      { kind: "ask_experience" },
      { kind: "answer_experience", hasExperience: true },
    );
    expect(next.kind).toBe("pick_path");
    expect(startBranchCanGoBack(next)).toBe(true);
  });

  it("'No' does not advance the branch (caller commits beginner_default)", () => {
    const next = startBranchReduce(
      { kind: "ask_experience" },
      { kind: "answer_experience", hasExperience: false },
    );
    expect(next.kind).toBe("ask_experience");
  });

  it("choose_self_certify advances pick_path → pick_cefr", () => {
    const next = startBranchReduce(
      { kind: "pick_path" },
      { kind: "choose_self_certify" },
    );
    expect(next.kind).toBe("pick_cefr");
    expect(startBranchCanGoBack(next)).toBe(true);
  });

  it("back on pick_cefr returns to pick_path", () => {
    const next = startBranchReduce({ kind: "pick_cefr" }, { kind: "back" });
    expect(next.kind).toBe("pick_path");
  });

  it("back on pick_path returns to ask_experience", () => {
    const next = startBranchReduce({ kind: "pick_path" }, { kind: "back" });
    expect(next.kind).toBe("ask_experience");
  });

  it("back on ask_experience is a no-op", () => {
    const next = startBranchReduce(
      { kind: "ask_experience" },
      { kind: "back" },
    );
    expect(next.kind).toBe("ask_experience");
  });
});
