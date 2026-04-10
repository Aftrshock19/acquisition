import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InteractiveTextProvider } from "@/components/interactive-text/InteractiveTextProvider";
import { McqCard } from "@/components/srs/cards/McqCard";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";

const sentenceMcqCard: Extract<UnifiedQueueCard, { cardType: "mcq" }> = {
  id: "word-1",
  kind: "review",
  cardType: "mcq",
  questionFormat: "sentence",
  prompt: "Which word completes the sentence?",
  options: ["casa", "perro", "gato", "libro"],
  correctOption: "casa",
  sentenceData: {
    sentence: "Hola casa.",
  },
  lemma: "casa",
  translation: "house",
  definition: "house",
  definitionEs: null,
  definitionEn: "house",
  exampleSentence: "Hola casa.",
  exampleSentenceEn: "Hello house.",
  rank: 1,
  pos: "noun",
  hint: "noun",
};

describe("McqCard", () => {
  it("renders sentence-format MCQ text through the shared interactive text provider", () => {
    const html = renderToStaticMarkup(
      <InteractiveTextProvider
        lang="es"
        initialSavedWordIds={["word-1"]}
        initialSavedLemmas={["casa"]}
        interactionContext="mcq_sentence"
      >
        <McqCard
          card={sentenceMcqCard}
          busy={false}
          submitError={null}
          feedback={null}
          onSelect={() => {}}
          onNext={() => {}}
          retryDelayMs={90000}
        />
      </InteractiveTextProvider>,
    );

    expect(html).toContain("Which word completes the sentence?");
    expect(html).toContain("casa");
    expect(html).toContain("emerald");
    expect(html.match(/<button/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });
});
