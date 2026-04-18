import { describe, expect, it } from "vitest";
import { deriveCefrBand, deriveSubstageLabel } from "./substageLabel";

describe("deriveSubstageLabel", () => {
  it("maps A1 band positions", () => {
    expect(deriveSubstageLabel(1)).toBe("A1--");
    expect(deriveSubstageLabel(2)).toBe("A1-");
    expect(deriveSubstageLabel(3)).toBe("A1");
    expect(deriveSubstageLabel(4)).toBe("A1+");
    expect(deriveSubstageLabel(5)).toBe("A1++");
  });

  it("rolls over into A2 at stage 6", () => {
    expect(deriveSubstageLabel(6)).toBe("A2--");
  });

  it("handles B1 top and C2 top", () => {
    expect(deriveSubstageLabel(15)).toBe("B1++");
    expect(deriveSubstageLabel(30)).toBe("C2++");
  });

  it("returns stringified number for out-of-range values", () => {
    expect(deriveSubstageLabel(0)).toBe("0");
    expect(deriveSubstageLabel(31)).toBe("31");
    expect(deriveSubstageLabel(-1)).toBe("-1");
    expect(deriveSubstageLabel(100)).toBe("100");
  });
});

describe("deriveCefrBand", () => {
  it("returns the broad band for in-range indexes", () => {
    expect(deriveCefrBand(1)).toBe("A1");
    expect(deriveCefrBand(5)).toBe("A1");
    expect(deriveCefrBand(6)).toBe("A2");
    expect(deriveCefrBand(15)).toBe("B1");
    expect(deriveCefrBand(30)).toBe("C2");
  });

  it("returns empty string for out-of-range values", () => {
    expect(deriveCefrBand(0)).toBe("");
    expect(deriveCefrBand(31)).toBe("");
    expect(deriveCefrBand(-1)).toBe("");
  });
});
