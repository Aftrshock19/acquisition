import { describe, it, expect } from "vitest";

import {
  classifyMorphology,
  effectiveDiagnosticRank,
} from "./morphology";

describe("classifyMorphology", () => {
  it("tags infinitives as base verbs", () => {
    expect(classifyMorphology("hablar", "verb").morphologyClass).toBe("base");
    expect(classifyMorphology("comer", "verb").morphologyClass).toBe("base");
    expect(classifyMorphology("vivir", "verb").morphologyClass).toBe("base");
  });

  it("tags gerund and participle forms as common inflection", () => {
    expect(classifyMorphology("hablando", "verb").morphologyClass).toBe(
      "common_inflection",
    );
    expect(classifyMorphology("comido", "verb").morphologyClass).toBe(
      "common_inflection",
    );
  });

  it("tags regular tense inflections as regular_inflection", () => {
    expect(classifyMorphology("hablamos", "verb").morphologyClass).toBe(
      "regular_inflection",
    );
    expect(classifyMorphology("comíais", "verb").morphologyClass).toBe(
      "regular_inflection",
    );
  });

  it("tags marked subjunctive and archaic endings as irregular_or_marked_inflection", () => {
    expect(classifyMorphology("anduviésemos", "verb").morphologyClass).toBe(
      "irregular_or_marked_inflection",
    );
    expect(classifyMorphology("hablaron", "verb").morphologyClass).toBe(
      "irregular_or_marked_inflection",
    );
    expect(classifyMorphology("hablaríamos", "verb").morphologyClass).toBe(
      "irregular_or_marked_inflection",
    );
  });

  it("tags nouns and adjectives ending in -s as common inflection (plural)", () => {
    const r = classifyMorphology("casas", "noun");
    expect(r.morphologyClass).toBe("common_inflection");
    expect(r.isInflectedForm).toBe(true);
  });

  it("tags base nouns as base", () => {
    expect(classifyMorphology("casa", "noun").morphologyClass).toBe("base");
    expect(classifyMorphology("perro", "noun").morphologyClass).toBe("base");
  });

  it("morphologyWeight decreases with markedness", () => {
    expect(classifyMorphology("hablar", "verb").morphologyWeight).toBe(1.0);
    expect(classifyMorphology("hablando", "verb").morphologyWeight).toBeLessThan(1.0);
    expect(classifyMorphology("hablamos", "verb").morphologyWeight).toBeLessThan(
      classifyMorphology("hablando", "verb").morphologyWeight,
    );
    expect(
      classifyMorphology("anduviésemos", "verb").morphologyWeight,
    ).toBeLessThan(classifyMorphology("hablamos", "verb").morphologyWeight);
  });
});

describe("effectiveDiagnosticRank", () => {
  it("common base lemma stays at its lemma rank", () => {
    const m = classifyMorphology("hablar", "verb");
    expect(effectiveDiagnosticRank(100, m)).toBe(100);
  });

  it("rare marked inflection of a common lemma gets a bounded penalty", () => {
    const m = classifyMorphology("anduviésemos", "verb");
    const eff = effectiveDiagnosticRank(500, m);
    // Not more than ~3× lemma rank — rare marked forms must not behave like
    // ultra-rare lexical items (rank 30k+).
    expect(eff).toBeGreaterThan(500);
    expect(eff).toBeLessThan(500 * 10);
  });

  it("regular inflection penalty is smaller than marked inflection penalty", () => {
    const reg = classifyMorphology("hablamos", "verb");
    const marked = classifyMorphology("hablaríamos", "verb");
    expect(effectiveDiagnosticRank(100, reg)).toBeLessThan(
      effectiveDiagnosticRank(100, marked),
    );
  });
});
