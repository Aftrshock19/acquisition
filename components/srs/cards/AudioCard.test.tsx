import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AudioCard } from "@/components/srs/cards/AudioCard";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";

const audioCard: Extract<UnifiedQueueCard, { cardType: "audio" }> = {
  id: "word-1",
  kind: "review",
  cardType: "audio",
  prompt: "Listen and select the correct word",
  options: ["casa", "perro", "gato", "libro"],
  correctOption: "casa",
  audioUrl: null,
  audioText: "casa",
  lemma: "casa",
  definition: "house",
  translation: "house",
  definitionEs: null,
  definitionEn: "house",
  exampleSentence: null,
  exampleSentenceEn: null,
  rank: 1,
  pos: "noun",
  hint: "noun",
};

function renderAudio(props: {
  feedback?: { correct: boolean; expected: string } | null;
  dontKnowRevealed?: boolean;
  onDontKnow?: () => void;
} = {}) {
  return renderToStaticMarkup(
    <AudioCard
      card={audioCard}
      busy={false}
      submitError={null}
      feedback={props.feedback ?? null}
      dontKnowRevealed={props.dontKnowRevealed}
      onSelect={() => {}}
      onDontKnow={props.onDontKnow}
      onNext={() => {}}
    />,
  );
}

describe("AudioCard — I don't know flow", () => {
  it("shows 'I don't know' button when onDontKnow is provided and unresolved", () => {
    const html = renderAudio({ onDontKnow: () => {} });
    expect(html).toContain("don");
    expect(html).toContain("know");
  });

  it("does not show 'I don't know' when onDontKnow is not provided", () => {
    const html = renderAudio();
    expect(html).not.toContain("don");
  });

  it("reveals correct option and shows Continue when dontKnowRevealed", () => {
    const html = renderAudio({
      feedback: { correct: false, expected: "casa" },
      dontKnowRevealed: true,
      onDontKnow: () => {},
    });
    expect(html).toContain("Correct answer");
    expect(html).toContain("bg-green-50");
    expect(html).toContain("Continue");
    expect(html).not.toContain("Incorrect");
  });

  it("shows FeedbackBlock for genuine wrong selection", () => {
    const html = renderAudio({
      feedback: { correct: false, expected: "casa" },
      dontKnowRevealed: false,
    });
    expect(html).toContain("Incorrect");
    expect(html).toContain("Expected:");
  });

  it("option buttons are present in unresolved state", () => {
    const html = renderAudio({ onDontKnow: () => {} });
    const buttonCount = html.match(/<button/g)?.length ?? 0;
    // 4 option buttons + Play again + I don't know = 6
    expect(buttonCount).toBeGreaterThanOrEqual(6);
  });

  it("options become non-interactive divs after dontKnowRevealed", () => {
    const html = renderAudio({
      feedback: { correct: false, expected: "casa" },
      dontKnowRevealed: true,
    });
    // Only the Continue button should remain as a button
    // Options are rendered as divs
    const buttonCount = html.match(/<button/g)?.length ?? 0;
    // Play again button + Continue button = 2
    expect(buttonCount).toBe(2);
  });
});
