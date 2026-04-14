import { describe, it, expect } from "vitest";
import { buildMcqOptions } from "./buildMcqOptions";

describe("buildMcqOptions", () => {
  it("uses translation as the correct answer when definitions are null (fresh-user case)", () => {
    const target = {
      id: "a",
      lemma: "pelear",
      translation: "to fight",
      rank: 100,
      hint: "verb",
    };
    const pool = [
      target,
      { id: "b", lemma: "correr", translation: "to run", rank: 101, hint: "verb" },
      { id: "c", lemma: "saltar", translation: "to jump", rank: 102, hint: "verb" },
      { id: "d", lemma: "nadar", translation: "to swim", rank: 103, hint: "verb" },
    ];

    const { correctOption, options } = buildMcqOptions(target, pool);

    expect(correctOption).toBe("to fight");
    expect(correctOption).not.toBe("pelear");
    expect(options).toContain("to fight");
    expect(options).not.toContain("pelear");
  });

  it("falls back to lemma only when translation is absent", () => {
    const target = { id: "a", lemma: "pelear", translation: null, rank: 100 };
    const { correctOption } = buildMcqOptions(target, [target]);
    expect(correctOption).toBe("pelear");
  });

  it("draws distractors from other cards' translations", () => {
    const target = { id: "a", lemma: "pelear", translation: "to fight", rank: 100, hint: "verb" };
    const pool = [
      target,
      { id: "b", lemma: "correr", translation: "to run", rank: 101, hint: "verb" },
      { id: "c", lemma: "saltar", translation: "to jump", rank: 102, hint: "verb" },
      { id: "d", lemma: "nadar", translation: "to swim", rank: 103, hint: "verb" },
    ];

    const { options } = buildMcqOptions(target, pool);

    expect(options).toEqual(expect.arrayContaining(["to run", "to jump", "to swim"]));
    // distractors should not be Spanish lemmas
    expect(options).not.toContain("correr");
    expect(options).not.toContain("saltar");
    expect(options).not.toContain("nadar");
  });
});
