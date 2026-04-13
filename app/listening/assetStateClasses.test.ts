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

  it("returns sky (blue) classes for in_progress asset", () => {
    const map = new Map<string, "in_progress" | "completed">([
      ["asset-2", "in_progress"],
    ]);
    const classes = getAssetStateClasses("asset-2", map);
    expect(classes).toContain("border-sky");
    expect(classes).toContain("bg-sky");
  });

  it("returns neutral zinc classes for untouched asset", () => {
    const map = new Map<string, "in_progress" | "completed">();
    const classes = getAssetStateClasses("asset-3", map);
    expect(classes).toContain("border-zinc");
    expect(classes).not.toContain("emerald");
    expect(classes).not.toContain("sky");
  });

  it("completed uses correct semantic colour (green family)", () => {
    const map = new Map<string, "in_progress" | "completed">([
      ["a", "completed"],
    ]);
    const classes = getAssetStateClasses("a", map);
    expect(classes).toMatch(/emerald/);
    expect(classes).not.toMatch(/rose|red|sky/);
  });

  it("in_progress uses correct semantic colour (blue family)", () => {
    const map = new Map<string, "in_progress" | "completed">([
      ["a", "in_progress"],
    ]);
    const classes = getAssetStateClasses("a", map);
    expect(classes).toMatch(/sky/);
    expect(classes).not.toMatch(/emerald|green|rose/);
  });
});
