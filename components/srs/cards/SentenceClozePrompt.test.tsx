import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InteractiveText } from "@/components/interactive-text/InteractiveText";
import { InteractiveTextProvider } from "@/components/interactive-text/InteractiveTextProvider";
import { SentenceClozePrompt } from "@/components/srs/cards/SentenceClozePrompt";
import { SENTENCE_CLOZE_BLANK_TOKEN } from "@/components/srs/logic/buildSentencePrompt";

describe("SentenceClozePrompt", () => {
  it("renders text around the blank and supports interactive text segments", () => {
    const html = renderToStaticMarkup(
      <InteractiveTextProvider
        lang="es"
        initialSavedWordIds={[]}
        initialSavedLemmas={[]}
        interactionContext="sentence_card"
      >
        <SentenceClozePrompt
          sentence={`Hola ${SENTENCE_CLOZE_BLANK_TOKEN} mundo.`}
          blankContent={<span>BLANK</span>}
          renderTextPart={(part, index) => (
            <InteractiveText
              text={part}
              tokenKeyPrefix={`sentence-prompt-${index}`}
            />
          )}
        />
      </InteractiveTextProvider>,
    );

    expect(html).toContain(">Hola</button>");
    expect(html).toContain(">BLANK</span>");
    expect(html).toContain(">mundo</button><span>.</span>");
  });

  it("falls back to the default blank placeholder", () => {
    const html = renderToStaticMarkup(
      <SentenceClozePrompt
        sentence={`Hola ${SENTENCE_CLOZE_BLANK_TOKEN} mundo`}
      />,
    );

    expect(html).toContain("border-dashed");
    expect(html).toContain("Hola");
    expect(html).toContain("mundo");
  });
});
