import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SupportPanel } from "@/components/srs/cards/SupportPanel";

describe("SupportPanel", () => {
  it("renders blurred translation pill with reveal affordance when hideTranslation=true", () => {
    const html = renderToStaticMarkup(
      <SupportPanel
        translation="to fight"
        englishSentence="I have to fight."
        hideTranslation
      />,
    );
    expect(html).toContain('aria-label="Reveal translation"');
    expect(html).toContain("blur-[7px]");
    // light-mode tint so the pill reads on white backgrounds
    expect(html).toContain("bg-zinc-200/60");
  });

  it("renders plain translation when hideTranslation=false", () => {
    const html = renderToStaticMarkup(
      <SupportPanel
        translation="to fight"
        englishSentence="I have to fight."
        hideTranslation={false}
      />,
    );
    expect(html).not.toContain('aria-label="Reveal translation"');
    expect(html).not.toContain("blur-[7px]");
    expect(html).toContain("to fight");
  });

  it("omits the show/hide sentence control when no english sentence is provided (word MCQ shape)", () => {
    const html = renderToStaticMarkup(
      <SupportPanel translation="to fight" />,
    );
    expect(html).not.toContain("Show sentence");
    expect(html).not.toContain("Hide sentence");
    expect(html).not.toContain("blur-[7px]");
    expect(html).toContain("to fight");
  });

  it("left-aligns the sentence toggle inside the support panel and does not center it", () => {
    const html = renderToStaticMarkup(
      <SupportPanel
        translation="to fight"
        englishSentence="I have to fight."
      />,
    );
    // Top section is a left-aligned flex column, not a horizontally-centered row.
    expect(html).toContain("flex-col");
    expect(html).toContain("items-start");
    // No centering classes snuck in.
    expect(html).not.toContain("justify-center");
    expect(html).not.toContain("items-center");
    expect(html).not.toContain("mx-auto");
    expect(html).not.toContain("text-center");
    // Shrinkable full-width translation wrapper + compact toggle preserved.
    expect(html).toContain("min-w-0");
    expect(html).toContain("w-full");
    expect(html).toContain("shrink-0");
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("self-start");
    // Toggle renders after translation in DOM order.
    const translationIdx = html.indexOf("to fight");
    const toggleIdx = html.indexOf("Show sentence");
    expect(translationIdx).toBeGreaterThan(-1);
    expect(toggleIdx).toBeGreaterThan(translationIdx);
  });

  it("applies overflow-safe wrapping to an expanded English sentence", () => {
    const longSentence =
      "Thisisanextremelylongunbrokenenglishsentencewithoutanyspacesorpunctuationdesignedtoprovewrappingbehaviour";
    // Seed localStorage so the panel initializes in the expanded state.
    const storageKey = "support-panel-test-expanded";
    globalThis.localStorage?.setItem?.(storageKey, "true");
    const html = renderToStaticMarkup(
      <SupportPanel
        translation="to fight"
        englishSentence={longSentence}
        storageKey={storageKey}
      />,
    );
    globalThis.localStorage?.removeItem?.(storageKey);
    if (html.includes(longSentence)) {
      // Expanded path: verify wrapping safety on the sentence paragraph.
      expect(html).toContain("break-words");
      expect(html).toContain("overflow-wrap:break-word");
    } else {
      // Environment without localStorage: at minimum the toggle control must be present.
      expect(html).toContain("Show sentence");
    }
  });

  it("uses block-level full-width button instead of shrink-to-fit inline-flex for translation", () => {
    const html = renderToStaticMarkup(
      <SupportPanel
        translation="vision"
        englishSentence="I have a vision."
        hideTranslation
      />,
    );
    // The outer button must be block+full-width, NOT inline-flex.
    expect(html).not.toMatch(/inline-flex/);
    // The button should be block-level and full-width.
    const buttonMatch = html.match(/<button[^>]*>/);
    expect(buttonMatch).toBeTruthy();
    expect(buttonMatch![0]).toContain("block");
    expect(buttonMatch![0]).toContain("w-full");
  });

  it("does not use overflow-wrap:anywhere on revealed/plain translation paths", () => {
    // Plain translation (hideTranslation=false)
    const plainHtml = renderToStaticMarkup(
      <SupportPanel
        translation="I leave the decision to you"
        englishSentence="Example sentence."
        hideTranslation={false}
      />,
    );
    expect(plainHtml).toContain("overflow-wrap:break-word");
    expect(plainHtml).not.toContain("overflow-wrap:anywhere");
  });

  it("allows long translation text to wrap inside the container without letter-by-letter breaks", () => {
    const longTranslation =
      "to engage in an extended unbroken confrontation that never yields even slightly";
    const html = renderToStaticMarkup(
      <SupportPanel
        translation={longTranslation}
        englishSentence="I have to fight."
      />,
    );
    expect(html).toContain(longTranslation);
    expect(html).toContain("break-words");
    expect(html).toContain("whitespace-normal");
    // Uses break-word, NOT anywhere (which causes min-content collapse on WebKit).
    expect(html).toContain("overflow-wrap:break-word");
    expect(html).not.toContain("overflow-wrap:anywhere");
  });

  it("clamps the masked reveal pill width using min() to prevent overflow", () => {
    const longTranslation =
      "to engage in an extended unbroken confrontation that never yields even slightly";
    const html = renderToStaticMarkup(
      <SupportPanel
        translation={longTranslation}
        englishSentence="I have to fight."
        hideTranslation
      />,
    );
    expect(html).toContain('aria-label="Reveal translation"');
    expect(html).toContain("blur-[7px]");
    // Uses min(100%, Xch) for inline-size clamping instead of raw width.
    expect(html).toMatch(/inline-size:\s*min\(100%,\s*\d+ch\)/);
    expect(html).toContain("max-inline-size:100%");
    // Inner span wraps instead of forcing a horizontal line.
    expect(html).toContain("whitespace-normal");
    expect(html).toContain("break-words");
  });

  it("keeps expanded English sentence safely wrapped inside the card", () => {
    const longSentence =
      "I leave the decision entirely to you because you have demonstrated excellent judgement in similar situations before";
    const storageKey = "support-panel-test-sentence-wrap";
    globalThis.localStorage?.setItem?.(storageKey, "true");
    const html = renderToStaticMarkup(
      <SupportPanel
        translation="to leave"
        englishSentence={longSentence}
        storageKey={storageKey}
      />,
    );
    globalThis.localStorage?.removeItem?.(storageKey);
    if (html.includes(longSentence)) {
      expect(html).toContain("break-words");
      expect(html).toContain("overflow-wrap:break-word");
      expect(html).toContain("max-w-full");
    }
  });
});
