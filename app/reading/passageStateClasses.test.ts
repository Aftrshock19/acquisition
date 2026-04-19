import { describe, it, expect } from "vitest";
import { getPassageStateClasses } from "./page";

describe("getPassageStateClasses", () => {
  it("returns emerald (green) classes for completed passage", () => {
    const map = new Map<string, "in_progress" | "completed">([
      ["passage-1", "completed"],
    ]);
    const classes = getPassageStateClasses("passage-1", map);
    expect(classes).toContain("border-emerald");
    expect(classes).toContain("bg-emerald");
  });

  it("returns blue classes for in_progress passage", () => {
    const map = new Map<string, "in_progress" | "completed">([
      ["passage-2", "in_progress"],
    ]);
    const classes = getPassageStateClasses("passage-2", map);
    expect(classes).toContain("border-blue");
    expect(classes).toContain("bg-blue");
  });

  it("returns neutral zinc classes for untouched passage", () => {
    const map = new Map<string, "in_progress" | "completed">();
    const classes = getPassageStateClasses("passage-3", map);
    expect(classes).toContain("border-zinc");
    expect(classes).not.toContain("emerald");
    expect(classes).not.toContain("blue");
  });

  it("completed uses correct semantic colour (green family)", () => {
    const map = new Map<string, "in_progress" | "completed">([
      ["a", "completed"],
    ]);
    const classes = getPassageStateClasses("a", map);
    expect(classes).toMatch(/emerald/);
    expect(classes).not.toMatch(/rose|red|blue/);
  });

  it("in_progress uses correct semantic colour (blue family)", () => {
    const map = new Map<string, "in_progress" | "completed">([
      ["a", "in_progress"],
    ]);
    const classes = getPassageStateClasses("a", map);
    expect(classes).toMatch(/blue/);
    expect(classes).not.toMatch(/emerald|green|rose/);
  });
});
