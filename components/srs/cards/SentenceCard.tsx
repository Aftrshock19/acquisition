"use client";

import type { ReactNode } from "react";
import { FlashcardContainer } from "@/components/srs/cards/FlashcardContainer";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";

type SentenceCardProps = {
  card: Extract<UnifiedQueueCard, { cardType: "sentences" }>;
  busy: boolean;
  submitError: string | null;
  showPosHint?: boolean;
  feedback:
    | {
        correct: boolean;
        expected: string;
      }
    | null;
  onSelect: (option: string) => void;
  onNext: () => void;
  retryDelayMs: number;
  navigation?: ReactNode;
};

export function SentenceCard({
  card,
  busy,
  submitError,
  showPosHint = true,
  feedback,
  onSelect,
  onNext,
  retryDelayMs,
  navigation,
}: SentenceCardProps) {
  if (feedback) {
    return (
      <FeedbackBlock
        correct={feedback.correct}
        expected={feedback.expected}
        onNext={onNext}
        retryDelayMs={retryDelayMs}
        busy={busy}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <FlashcardContainer title="Sentence" navigation={navigation}>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{card.prompt}</p>
        <p className="mt-4 text-xl font-medium tracking-tight">{card.sentenceData.sentence}</p>
        {card.sentenceData.translation ? (
          <p className="mt-2 text-sm text-zinc-500">
            {card.sentenceData.translation}
          </p>
        ) : null}
        {showPosHint && card.hint ? (
          <p className="mt-2 text-sm text-zinc-500">({card.hint})</p>
        ) : null}
        {submitError ? (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {submitError}
          </p>
        ) : null}
      </FlashcardContainer>

      <div className="grid gap-2">
        {card.options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            disabled={busy}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-3 text-left text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function FeedbackBlock({
  correct,
  expected,
  onNext,
  retryDelayMs,
  busy,
}: {
  correct: boolean;
  expected: string;
  onNext: () => void;
  retryDelayMs: number;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div
        className={`rounded-xl border p-6 ${
          correct
            ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/40"
            : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40"
        }`}
      >
        <p className="font-medium">{correct ? "Correct" : "Incorrect"}</p>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">Expected: {expected}</p>
        {!correct ? (
          <p className="mt-1 text-sm text-zinc-500">
            Will repeat in {Math.max(1, Math.round(retryDelayMs / 1000))}s
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onNext}
        disabled={busy}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Next
      </button>
    </div>
  );
}
