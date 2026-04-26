import { describe, expect, it } from "vitest";
import {
  INTRO_PAGE_COUNT,
  introNavReduce,
  introNavState,
} from "./introNavigation";

describe("intro navigation", () => {
  it("has exactly 4 pages (3 linear + placement-start final)", () => {
    expect(INTRO_PAGE_COUNT).toBe(4);
  });

  it("starts on page 0 with no Back", () => {
    const s = introNavState(0);
    expect(s.page).toBe(0);
    expect(s.canGoBack).toBe(false);
    expect(s.isLast).toBe(false);
  });

  it("Next moves forward, clamped at the last page", () => {
    expect(introNavReduce(0, "next")).toBe(1);
    expect(introNavReduce(INTRO_PAGE_COUNT - 2, "next")).toBe(
      INTRO_PAGE_COUNT - 1,
    );
    expect(introNavReduce(INTRO_PAGE_COUNT - 1, "next")).toBe(
      INTRO_PAGE_COUNT - 1,
    );
  });

  it("walking Next from 0 eventually lands on the placement-start page", () => {
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

  it("only the final page is marked isLast", () => {
    for (let i = 0; i < INTRO_PAGE_COUNT - 1; i++) {
      expect(introNavState(i).isLast).toBe(false);
    }
    expect(introNavState(INTRO_PAGE_COUNT - 1).isLast).toBe(true);
  });
});
