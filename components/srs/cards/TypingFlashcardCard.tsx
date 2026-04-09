"use client";

import type { ReactNode, RefObject } from "react";
import {
  FlashcardContainer,
  FlashcardSuccessActions,
} from "@/components/srs/cards/FlashcardContainer";
import { CorrectionHintInput } from "@/components/srs/cards/CorrectionHintInput";

type TypingFlashcardCardProps = {
  typeLabel: string;
  title: string;
  prompt: ReactNode;
  value: string;
  busy: boolean;
  submitError: string | null;
  feedback:
    | {
        correct: boolean;
        expected: string;
      }
    | null;
  correctionPlaceholder?: string;
  correctionPlaceholderVisible?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  inputPlaceholder: string;
  showAcceptedAnswers?: boolean;
  navigation?: ReactNode;
  onChange: (value: string) => void;
  onCheck: () => void;
  onNext: () => void;
};

export function TypingFlashcardCard({
  typeLabel,
  title,
  prompt,
  value,
  busy,
  submitError,
  feedback,
  correctionPlaceholder,
  correctionPlaceholderVisible = false,
  inputRef,
  inputPlaceholder,
  showAcceptedAnswers = false,
  navigation,
  onChange,
  onCheck,
  onNext,
}: TypingFlashcardCardProps) {
  const needsCorrection = feedback?.correct === false;
  const showingSuccess = feedback?.correct === true;

  return (
    <div className="flex flex-col gap-6">
      <FlashcardContainer
        typeLabel={typeLabel}
        title={title}
        navigation={navigation}
      >
        {prompt}
        {submitError ? (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {submitError}
          </p>
        ) : null}

        <CorrectionHintInput
          value={value}
          onChange={onChange}
          placeholder={inputPlaceholder}
          correctionHint={correctionPlaceholder}
          correctionHintVisible={correctionPlaceholderVisible}
          tone={showingSuccess ? "success" : needsCorrection ? "error" : "default"}
          inputRef={inputRef}
          readOnly={showingSuccess}
          disabled={busy}
          wrapperClassName="mt-4"
        />

        {showingSuccess && showAcceptedAnswers ? (
          <div className="mt-4 rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/40">
            <p className="text-xs uppercase tracking-[0.14em] text-green-700 dark:text-green-300">
              Correct answers
            </p>
            <p className="mt-2 text-green-900 dark:text-green-100">
              {feedback.expected}
            </p>
          </div>
        ) : null}
      </FlashcardContainer>

      {showingSuccess ? (
        <FlashcardSuccessActions onNext={onNext} busy={busy} />
      ) : (
        <>
          <button
            type="button"
            onClick={onCheck}
            disabled={busy || !value.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {needsCorrection ? "Continue" : "Check"}
          </button>

          <p className="text-sm text-zinc-500">
            {needsCorrection ? "Press Enter to continue" : "Press Enter to check"}
          </p>
        </>
      )}
    </div>
  );
}
