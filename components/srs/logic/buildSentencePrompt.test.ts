import { describe, expect, it } from "vitest";
import {
  buildSentencePrompt,
  SENTENCE_CLOZE_BLANK_TOKEN,
} from "@/components/srs/logic/buildSentencePrompt";

describe("buildSentencePrompt", () => {
  it("replaces the target lemma with a single inline blank", () => {
    const prompt = buildSentencePrompt({
      lemma: "comer",
      exampleSentence: "Voy a comer ahora mismo.",
      exampleSentenceEn: "I am going to eat right now.",
      pos: "verb",
    });

    expect(prompt.answer).toBe("comer");
    expect(prompt.sentence).toBe(
      `Voy a ${SENTENCE_CLOZE_BLANK_TOKEN} ahora mismo.`,
    );
  });

  it("matches accented words without breaking punctuation", () => {
    const prompt = buildSentencePrompt({
      lemma: "acción",
      exampleSentence: "La acción, de repente, cambió todo.",
      pos: "noun",
    });

    expect(prompt.sentence).toBe(
      `La ${SENTENCE_CLOZE_BLANK_TOKEN}, de repente, cambió todo.`,
    );
  });

  it("keeps fallback prompts to a single blank token when no sentence exists", () => {
    const prompt = buildSentencePrompt({
      lemma: "rápido",
      pos: "adj",
    });

    expect(prompt.sentence.match(new RegExp(SENTENCE_CLOZE_BLANK_TOKEN, "g")))
      .toHaveLength(1);
  });
});
