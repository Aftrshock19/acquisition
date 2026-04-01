"use client";

import type { ReactNode, RefObject } from "react";
import { FlashcardContainer } from "@/components/srs/cards/FlashcardContainer";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";

type ClozeCardProps = {
  card: Extract<UnifiedQueueCard, { cardType: "cloze" }>;
  value: string;
  busy: boolean;
  submitError: string | null;
  showPosHint?: boolean;
  feedback:
    | {
        correct: boolean;
        expected: string;
      }
    | null;
  inputRef?: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onCheck: () => void;
  onNext: () => void;
  navigation?: ReactNode;
};

export function ClozeCard({
  card,
  value,
  busy,
  submitError,
  showPosHint = true,
  feedback,
  inputRef,
  onChange,
  onCheck,
  onNext,
  navigation,
}: ClozeCardProps) {
  const needsCorrection = feedback?.correct === false;
  const showingSuccess = feedback?.correct === true;

  return (
    <div className="flex flex-col gap-6">
      <FlashcardContainer
        title={card.direction === "en_to_es" ? "Meaning" : "Word"}
        navigation={navigation}
      >
        <p className="mt-2 text-zinc-700 dark:text-zinc-200">
          {card.direction === "en_to_es" ? (card.definition ?? "—") : card.lemma}
        </p>
        {showPosHint && card.hint ? (
          <p className="mt-1 text-sm text-zinc-500">({card.hint})</p>
        ) : null}
        {submitError ? (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {submitError}
          </p>
        ) : null}

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            needsCorrection
              ? feedback.expected
              : card.direction === "en_to_es"
                ? "Type the Spanish word..."
                : "Type the meaning..."
          }
          aria-invalid={needsCorrection}
          readOnly={showingSuccess}
          className={`mt-4 w-full rounded-lg px-3 py-2 text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 ${
            showingSuccess
              ? "border border-zinc-400 bg-zinc-100 focus:border-zinc-700 focus:ring-zinc-700 dark:border-zinc-500 dark:bg-zinc-800"
              : needsCorrection
              ? "border border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500 dark:border-red-800 dark:bg-red-950/40"
              : "border border-zinc-300 bg-white focus:border-zinc-500 focus:ring-zinc-500 dark:border-zinc-600"
          }`}
          autoComplete="off"
          disabled={busy || showingSuccess}
        />
        {needsCorrection ? (
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">
            Type the correct word to continue.
          </p>
        ) : null}
      </FlashcardContainer>

      <button
        type="button"
        onClick={showingSuccess ? onNext : onCheck}
        disabled={busy || !value.trim()}
        className={`rounded-lg px-4 font-medium text-white disabled:opacity-50 dark:text-zinc-900 ${
          showingSuccess
            ? "bg-zinc-900 py-3 text-base shadow-lg shadow-zinc-900/20 hover:bg-zinc-700 dark:bg-zinc-100 dark:hover:bg-zinc-200"
            : "bg-zinc-900 py-2 text-sm hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200"
        }`}
      >
        {showingSuccess ? "Next" : needsCorrection ? "Continue" : "Check"}
      </button>

      <p className="text-sm text-zinc-500">
        {showingSuccess
          ? "Press Enter to continue"
          : needsCorrection
            ? "Press Enter to continue"
            : "Press Enter to check"}
      </p>
    </div>
  );
}
