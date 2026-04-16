import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TypingFlashcardCard } from "@/components/srs/cards/TypingFlashcardCard";

function renderTyping(props: {
  value?: string;
  feedback?: { correct: boolean; expected: string } | null;
  answerRevealed?: boolean;
  onReveal?: () => void;
}) {
  return renderToStaticMarkup(
    <TypingFlashcardCard
      typeLabel="Test"
      title="Test"
      prompt={<p>Prompt text</p>}
      value={props.value ?? ""}
      busy={false}
      submitError={null}
      feedback={props.feedback ?? null}
      inputPlaceholder="Type here..."
      answerRevealed={props.answerRevealed}
      onChange={() => {}}
      onCheck={() => {}}
      onReveal={props.onReveal}
      onNext={() => {}}
    />,
  );
}

describe("TypingFlashcardCard — Show answer flow", () => {
  it("shows 'Show answer' when input is empty and onReveal is provided", () => {
    const html = renderTyping({ value: "", onReveal: () => {} });
    expect(html).toContain("Show answer");
    expect(html).toContain("Press Enter to show answer");
    expect(html).not.toContain("Check");
  });

  it("shows 'Check' when input has text", () => {
    const html = renderTyping({ value: "hola", onReveal: () => {} });
    expect(html).toContain("Check");
    expect(html).toContain("Press Enter to check");
    expect(html).not.toContain("Show answer");
  });

  it("shows correct answer panel and Continue when answerRevealed is true", () => {
    const html = renderTyping({
      value: "",
      feedback: { correct: false, expected: "casa" },
      answerRevealed: true,
      onReveal: () => {},
    });
    expect(html).toContain("Correct answer");
    expect(html).toContain("casa");
    expect(html).toContain("Continue");
    // Should not show the input field or correction mode
    expect(html).not.toContain("Type here...");
    expect(html).not.toContain("Press Enter to continue");
  });

  it("does not enter correction mode when answer is revealed", () => {
    const html = renderTyping({
      value: "",
      feedback: { correct: false, expected: "casa" },
      answerRevealed: true,
    });
    // No correction-mode "Continue" button (the one with disabled-when-empty logic)
    // Instead has the revealed-path Continue
    expect(html).toContain("Continue");
    expect(html).toContain("Correct answer");
  });

  it("still shows correction mode for genuine wrong typed answers", () => {
    const html = renderTyping({
      value: "wrong",
      feedback: { correct: false, expected: "casa" },
      answerRevealed: false,
    });
    expect(html).toContain("Continue");
    expect(html).not.toContain("Correct answer");
    // Input should still be present for correction
    expect(html).toContain("Press Enter to continue");
  });

  it("still shows success flow for correct answers", () => {
    const html = renderTyping({
      value: "casa",
      feedback: { correct: true, expected: "casa" },
      answerRevealed: false,
    });
    expect(html).toContain("Next");
    expect(html).toContain("Advancing automatically");
  });
});
