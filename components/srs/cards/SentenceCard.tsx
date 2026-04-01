"use client";

import type { ReactNode, RefObject } from "react";
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
  correctionValue: string;
  correctionInputRef?: RefObject<HTMLInputElement | null>;
  onSelect: (option: string) => void;
  onCorrectionChange: (value: string) => void;
  onCorrectionSubmit: () => void;
  onNext: () => void;
  navigation?: ReactNode;
};

export function SentenceCard({
  card,
  busy,
  submitError,
  showPosHint = true,
  feedback,
  correctionValue,
  correctionInputRef,
  onSelect,
  onCorrectionChange,
  onCorrectionSubmit,
  onNext,
  navigation,
}: SentenceCardProps) {
  const needsCorrection = feedback?.correct === false;
  const showingSuccess = feedback?.correct === true;

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

        {needsCorrection ? (
          <div className="mt-4">
            <input
              ref={correctionInputRef}
              type="text"
              value={correctionValue}
              onChange={(event) => onCorrectionChange(event.target.value)}
              placeholder={feedback.expected}
              aria-invalid
              autoComplete="off"
              disabled={busy}
              className="w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-zinc-900 placeholder:text-red-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/40 dark:text-zinc-100 dark:placeholder:text-red-300"
            />
            <p className="mt-2 text-sm text-red-700 dark:text-red-300">
              Type the correct word to continue.
            </p>
          </div>
        ) : null}

      </FlashcardContainer>

      {showingSuccess ? (
        <>
          <button
            type="button"
            onClick={onNext}
            disabled={busy}
            className="rounded-lg bg-zinc-900 px-4 py-3 text-base font-medium text-white shadow-lg shadow-zinc-900/20 hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Next
          </button>
          <p className="text-sm text-zinc-500">Press Enter to continue</p>
        </>
      ) : needsCorrection ? (
        <>
          <button
            type="button"
            onClick={onCorrectionSubmit}
            disabled={busy || !correctionValue.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Continue
          </button>
          <p className="text-sm text-zinc-500">Press Enter to continue</p>
        </>
      ) : (
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
      )}
    </div>
  );
}
