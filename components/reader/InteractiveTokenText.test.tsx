import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InteractiveText } from "@/components/interactive-text/InteractiveText";
import { InteractiveTextProvider } from "@/components/interactive-text/InteractiveTextProvider";

describe("InteractiveText", () => {
  it("renders only real word tokens as buttons and preserves punctuation inside the provider", () => {
    const html = renderToStaticMarkup(
      <InteractiveTextProvider
        lang="es"
        initialSavedWordIds={["word-2"]}
        initialSavedLemmas={["mundo"]}
        interactionContext="test"
      >
        <InteractiveText
          text="Hola,  mundo."
          tokenKeyPrefix="reader-test"
        />
      </InteractiveTextProvider>,
    );

    expect(html.match(/<button/g)?.length ?? 0).toBe(2);
    expect(html).toContain(">Hola</button><span>,</span>");
    expect(html).toContain("<span>  </span>");
    expect(html).toContain(">mundo</button><span>.</span>");
    expect(html).toContain("emerald");
  });

  it("renders plain text when there is no provider", () => {
    const html = renderToStaticMarkup(
      <InteractiveText text="Hola mundo" tokenKeyPrefix="plain-test" />,
    );

    expect(html).not.toContain("<button");
    expect(html).toContain("Hola");
    expect(html).toContain("mundo");
  });
});
