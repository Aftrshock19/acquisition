"use client";

import type { ReactNode, RefObject } from "react";
import {
  FlashcardContainer,
  FlashcardSuccessActions,
} from "@/components/srs/cards/FlashcardContainer";
import { TextAnswerInput } from "@/components/srs/cards/TextAnswerInput";

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
  answerRevealed?: boolean;
  navigation?: ReactNode;
  onChange: (value: string) => void;
  onCheck: () => void;
  onReveal?: () => void;
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
  answerRevealed = false,
  navigation,
  onChange,
  onCheck,
  onReveal,
  onNext,
}: TypingFlashcardCardProps) {
  const needsCorrection = feedback?.correct === false && !answerRevealed;
  const showingSuccess = feedback?.correct === true;
  const isShowAnswer = !needsCorrection && !showingSuccess && !answerRevealed && !value.trim() && onReveal;

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

        {answerRevealed && feedback ? (
          <div className="mt-4 rounded-lg border border-zinc-300 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
              Correct answer
            </p>
            <p className="mt-2 text-lg font-medium text-zinc-900 dark:text-zinc-100">
              {feedback.expected}
            </p>
          </div>
        ) : (
          <>
            <TextAnswerInput
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
          </>
        )}
      </FlashcardContainer>

      {answerRevealed ? (
        <button
          key="continue-after-reveal"
          type="button"
          onClick={onNext}
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Continue
        </button>
      ) : showingSuccess ? (
        <FlashcardSuccessActions onNext={onNext} busy={busy} />
      ) : (
        <>
          <button
            key={isShowAnswer ? "show-answer" : needsCorrection ? "try-again" : "check"}
            type="button"
            onClick={isShowAnswer ? onReveal : onCheck}
            disabled={busy || (needsCorrection && !value.trim())}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {needsCorrection ? "Continue" : isShowAnswer ? "Show answer" : "Check"}
          </button>

          <p className="text-sm text-zinc-500">
            {needsCorrection
              ? "Press Enter to continue"
              : isShowAnswer
                ? "Press Enter to show answer"
                : "Press Enter to check"}
          </p>
        </>
      )}
    </div>
  );
}
