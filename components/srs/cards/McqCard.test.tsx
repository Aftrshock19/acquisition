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

const wordMcqCard: Extract<UnifiedQueueCard, { cardType: "mcq" }> = {
  ...sentenceMcqCard,
  id: "word-2",
  questionFormat: "single_word",
  prompt: "casa",
  sentenceData: undefined,
};

function renderMcq(
  card: Extract<UnifiedQueueCard, { cardType: "mcq" }>,
  props: { hideTranslation?: boolean } = {},
) {
  return renderToStaticMarkup(
    <InteractiveTextProvider
      lang="es"
      initialSavedWordIds={[card.id]}
      initialSavedLemmas={[card.lemma]}
      interactionContext="mcq_sentence"
    >
      <McqCard
        card={card}
        busy={false}
        submitError={null}
        feedback={null}
        hideTranslation={props.hideTranslation}
        onSelect={() => {}}
        onNext={() => {}}
      />
    </InteractiveTextProvider>,
  );
}

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
        />
      </InteractiveTextProvider>,
    );

    expect(html).toContain("Which word completes the sentence?");
    expect(html).toContain("casa");
    expect(html).toContain("emerald");
    expect(html.match(/<button/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it("blurs the translation in sentence MCQ when hideTranslation=true", () => {
    const html = renderMcq(sentenceMcqCard, { hideTranslation: true });
    // Reveal-translation button rendered as a pressable pill
    expect(html).toContain('aria-label="Reveal translation"');
    // Blur class applied
    expect(html).toContain("blur-[7px]");
  });

  it("does not blur translation in sentence MCQ when hideTranslation=false", () => {
    const html = renderMcq(sentenceMcqCard, { hideTranslation: false });
    expect(html).not.toContain('aria-label="Reveal translation"');
    expect(html).not.toContain("blur-[7px]");
    expect(html).toContain("house");
  });

  it("never blurs translation in word MCQ even when hideTranslation=true", () => {
    const html = renderMcq(wordMcqCard, { hideTranslation: true });
    expect(html).not.toContain('aria-label="Reveal translation"');
    expect(html).not.toContain("blur-[7px]");
    expect(html).toContain("house");
  });
});
