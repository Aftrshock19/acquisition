import { describe, expect, it } from "vitest";
import {
  formatDefinitionCandidates,
  isCorrectClozeAnswer,
  splitDefinitionCandidates,
} from "./cloze";

describe("cloze helpers", () => {
  it("splits semicolon-delimited English definitions into separate candidates", () => {
    expect(
      splitDefinitionCandidates(
        "oneself; himself; herself; itself; themselves",
      ),
    ).toEqual([
      "oneself",
      "himself",
      "herself",
      "itself",
      "themselves",
    ]);
  });

  it("removes bracketed notes from English candidates and feedback", () => {
    expect(
      splitDefinitionCandidates(
        "oneself [reflexive]; himself (male); herself {female}",
      ),
    ).toEqual(["oneself", "himself", "herself"]);

    expect(
      formatDefinitionCandidates(
        splitDefinitionCandidates(
          "oneself [reflexive]; himself (male); herself {female}",
        ),
      ),
    ).toBe("oneself or himself or herself");
  });

  it("accepts any listed English meaning when the user writes several of them", () => {
    const expected = splitDefinitionCandidates(
      "oneself; himself; herself; itself; themselves",
    );

    expect(isCorrectClozeAnswer("himself or herself", expected, true)).toBe(
      true,
    );
    expect(isCorrectClozeAnswer("itself,themselves", expected, true)).toBe(
      true,
    );
  });

  it("does not accept unrelated answers in multi-answer mode", () => {
    const expected = splitDefinitionCandidates(
      "oneself; himself; herself; itself; themselves",
    );

    expect(isCorrectClozeAnswer("myself", expected, true)).toBe(false);
  });

  it("ignores bracketed text in the typed answer", () => {
    const expected = splitDefinitionCandidates("himself [male]; herself");

    expect(isCorrectClozeAnswer("himself [male]", expected, true)).toBe(true);
    expect(isCorrectClozeAnswer("herself (female)", expected, true)).toBe(true);
  });

  it("formats correction feedback with or between English meanings", () => {
    expect(
      formatDefinitionCandidates([
        "oneself",
        "himself",
        "herself",
        "itself",
        "themselves",
      ]),
    ).toBe("oneself or himself or herself or itself or themselves");
  });
});
