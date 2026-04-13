import { describe, it, expect } from "vitest";
import { getAssetStateClasses } from "./page";

describe("getAssetStateClasses", () => {
  it("returns emerald (green) classes for completed asset", () => {
    const map = new Map<string, "in_progress" | "completed">([
      ["asset-1", "completed"],
    ]);
    const classes = getAssetStateClasses("asset-1", map);
    expect(classes).toContain("border-emerald");
    expect(classes).toContain("bg-emerald");
  });

  it("returns rose (red) classes for in_progress asset", () => {
    const map = new Map<string, "in_progress" | "completed">([
      ["asset-2", "in_progress"],
    ]);
    const classes = getAssetStateClasses("asset-2", map);
    expect(classes).toContain("border-rose");
    expect(classes).toContain("bg-rose");
  });

  it("returns neutral zinc classes for untouched asset", () => {
    const map = new Map<string, "in_progress" | "completed">();
    const classes = getAssetStateClasses("asset-3", map);
    expect(classes).toContain("border-zinc");
    expect(classes).not.toContain("emerald");
    expect(classes).not.toContain("rose");
  });

  it("completed uses correct semantic colour (green family)", () => {
    const map = new Map<string, "in_progress" | "completed">([
      ["a", "completed"],
    ]);
    const classes = getAssetStateClasses("a", map);
    // Must use emerald (the app's global correct/success colour family)
    expect(classes).toMatch(/emerald/);
    // Must NOT use rose or red
    expect(classes).not.toMatch(/rose|red/);
  });

  it("in_progress uses correct semantic colour (red family)", () => {
    const map = new Map<string, "in_progress" | "completed">([
      ["a", "in_progress"],
    ]);
    const classes = getAssetStateClasses("a", map);
    // Must use rose (the app's global incorrect/warning colour family)
    expect(classes).toMatch(/rose/);
    // Must NOT use emerald or green
    expect(classes).not.toMatch(/emerald|green/);
  });
});
