import { describe, expect, it } from "vitest";
import { normalizeWordToken, tokenize } from "@/lib/reader/tokenize";

describe("tokenize", () => {
  it("preserves spaces and punctuation", () => {
    const text = "Hola,  mundo.";
    const tokens = tokenize(text);

    expect(tokens.map((token) => token.surface)).toEqual(["Hola", ",", "  ", "mundo", "."]);
    expect(tokens.map((token) => token.isWord)).toEqual([true, false, false, true, false]);
  });

  it("keeps Spanish diacritics and internal apostrophes in words", () => {
    const text = "Canción d'abril pingüino";
    const tokens = tokenize(text);

    expect(tokens.filter((token) => token.isWord).map((token) => token.normalized)).toEqual([
      "canción",
      "d'abril",
      "pingüino",
    ]);
  });

  it("groups non-word runs without making them clickable", () => {
    const text = "2024...";
    const tokens = tokenize(text);

    expect(tokens).toEqual([
      {
        surface: "2024...",
        normalized: "2024...",
        isWord: false,
      },
    ]);
  });
});

describe("normalizeWordToken", () => {
  it("normalizes casing for Spanish lookup", () => {
    expect(normalizeWordToken("Árbol")).toBe("árbol");
  });
});
