import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReaderView } from "@/components/reader/ReaderView";
import type { ReaderText } from "@/lib/reader/types";

const sampleText: ReaderText = {
  id: "text-1",
  lang: "es",
  title: "Reader sample",
  content: "Hola mundo.\n\nAdios sol.",
  collectionId: null,
  orderIndex: null,
  sectionNumber: null,
  wordCount: null,
  estimatedMinutes: null,
  difficultyCefr: null,
  collection: null,
};

describe("ReaderView", () => {
  it("renders reader content through the shared interactive text provider", () => {
    const html = renderToStaticMarkup(
      <ReaderView
        text={sampleText}
        initialSavedWordIds={["word-2"]}
        initialSavedLemmas={["mundo"]}
      />,
    );

    expect(html.match(/<button/g)?.length ?? 0).toBe(4);
    expect(html).toContain("emerald");
  });
});
