"use client";

import type { ReactNode, RefObject } from "react";
import {
  FlashcardContainer,
  FlashcardSuccessActions,
} from "@/components/srs/cards/FlashcardContainer";
import { CorrectionHintInput } from "@/components/srs/cards/CorrectionHintInput";
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
  correctionPlaceholder?: string;
  correctionPlaceholderVisible?: boolean;
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
  correctionPlaceholder,
  correctionPlaceholderVisible = false,
  inputRef,
  onChange,
  onCheck,
  onNext,
  navigation,
}: ClozeCardProps) {
  const needsCorrection = feedback?.correct === false;
  const showingSuccess = feedback?.correct === true;
  const showAcceptedAnswers = showingSuccess && feedback.expected.includes(" or ");
  const translationLabel =
    card.direction === "en_to_es"
      ? "Write Spanish translation"
      : "Write English translation";

  return (
    <div className="flex flex-col gap-6">
      <FlashcardContainer
        typeLabel={translationLabel}
        title={translationLabel}
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

        <CorrectionHintInput
          value={value}
          onChange={onChange}
          placeholder={translationLabel + "..."}
          correctionHint={correctionPlaceholder}
          correctionHintVisible={correctionPlaceholderVisible}
          tone={showingSuccess ? "success" : needsCorrection ? "error" : "default"}
          inputRef={inputRef}
          readOnly={showingSuccess}
          disabled={busy}
          wrapperClassName="mt-4"
        />

        {showAcceptedAnswers ? (
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
