import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NormalEnToEsCard } from "@/components/srs/cards/NormalEnToEsCard";
import { NormalEsToEnCard } from "@/components/srs/cards/NormalEsToEnCard";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";

const enToEsCard: Extract<
  UnifiedQueueCard,
  { cardType: "normal"; direction: "en_to_es" }
> = {
  id: "word-1",
  kind: "review",
  cardType: "normal",
  direction: "en_to_es",
  lemma: "casa",
  definition: "house",
  translation: null,
  definitionEs: null,
  definitionEn: "house",
  exampleSentence: null,
  exampleSentenceEn: null,
  rank: 1,
  pos: "noun",
  hint: "noun",
};

const esToEnCard: Extract<
  UnifiedQueueCard,
  { cardType: "normal"; direction: "es_to_en" }
> = {
  ...enToEsCard,
  direction: "es_to_en",
};

describe("normal card UI", () => {
  it("renders the English prompt with reveal CTA before showing the answer", () => {
    const html = renderToStaticMarkup(
      <NormalEnToEsCard
        card={enToEsCard}
        busy={false}
        submitError={null}
        revealed={false}
        submittedGrade={null}
        onReveal={() => {}}
        onChoice={() => {}}
        onNext={() => {}}
        retryDelayMs={90000}
      />,
    );

    expect(html).toContain("house");
    expect(html).toContain("Show answer");
    expect(html).toContain("Press Enter to reveal.");
    expect(html).not.toContain("casa");
    expect(html).not.toContain("I missed it");
    expect(html).not.toContain("I got it");
  });

  it("shows only the two binary choices after reveal for English to Spanish cards", () => {
    const html = renderToStaticMarkup(
      <NormalEnToEsCard
        card={enToEsCard}
        busy={false}
        submitError={null}
        revealed
        submittedGrade={null}
        onReveal={() => {}}
        onChoice={() => {}}
        onNext={() => {}}
        retryDelayMs={90000}
      />,
    );

    expect(html).toContain("Spanish translation");
    expect(html).toContain("casa");
    expect(html).toContain("I missed it");
    expect(html).toContain("I got it");
    expect(html).not.toContain("Again");
    expect(html).not.toContain("Hard");
    expect(html).not.toContain("Good");
    expect(html).not.toContain("Easy");
  });

  it("shows only the two binary choices after reveal for Spanish to English cards", () => {
    const html = renderToStaticMarkup(
      <NormalEsToEnCard
        card={esToEnCard}
        busy={false}
        submitError={null}
        revealed
        submittedGrade={null}
        onReveal={() => {}}
        onChoice={() => {}}
        onNext={() => {}}
        retryDelayMs={90000}
      />,
    );

    expect(html).toContain("English translation");
    expect(html).toContain("house");
    expect(html).toContain("I missed it");
    expect(html).toContain("I got it");
    expect(html).not.toContain("Again");
    expect(html).not.toContain("Hard");
    expect(html).not.toContain("Good");
    expect(html).not.toContain("Easy");
  });
});
