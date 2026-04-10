"use client";

import type { ReactNode } from "react";
import {
  FlashcardContainer,
  FlashcardFeedbackPanel,
  FlashcardSuccessActions,
} from "@/components/srs/cards/FlashcardContainer";
import type { Grade } from "@/lib/srs/types";
import {
  getNormalReviewResultLabel,
  type NormalReviewChoice,
} from "@/lib/srs/normalReview";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";

type NormalEsToEnCardProps = {
  card: Extract<
    UnifiedQueueCard,
    { cardType: "normal"; direction: "es_to_en" }
  >;
  busy: boolean;
  submitError: string | null;
  showPosHint?: boolean;
  revealed: boolean;
  submittedGrade?: Grade | null;
  navigation?: ReactNode;
  onReveal: () => void;
  onChoice: (choice: NormalReviewChoice) => void;
  onNext: () => void;
};

export function NormalEsToEnCard({
  card,
  busy,
  submitError,
  showPosHint = true,
  revealed,
  submittedGrade,
  navigation,
  onReveal,
  onChoice,
  onNext,
}: NormalEsToEnCardProps) {
  const answered = submittedGrade !== null && submittedGrade !== undefined;
  const isAgain = submittedGrade === "again";
  const resultLabel = getNormalReviewResultLabel(submittedGrade);
  const helperText = !revealed
    ? "Try to recall it first, then reveal the answer and judge whether you had it before seeing it. Press Enter to reveal."
    : answered
      ? isAgain
        ? "This card will repeat after a few more cards."
        : null
      : "Choose I missed it if you only had it after seeing the answer.";

  return (
    <div className="flex flex-col gap-6">
      <FlashcardContainer
        typeLabel="Recall English translation"
        title="Recall English translation"
        navigation={navigation}
      >
        <p className="mt-2 text-2xl font-semibold tracking-tight">{card.lemma}</p>
        {showPosHint && card.hint ? (
          <p className="mt-1 text-sm text-zinc-500">({card.hint})</p>
        ) : null}

        {revealed ? (
          <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
              English translation
            </p>
            <p className="mt-2 text-lg font-medium">{card.definition ?? "—"}</p>
          </div>
        ) : null}

        {submitError ? (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {submitError}
          </p>
        ) : null}
      </FlashcardContainer>

      {!revealed ? (
        <button
          type="button"
          onClick={onReveal}
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Show answer
        </button>
      ) : answered ? (
        <>
          <FlashcardFeedbackPanel
            tone={isAgain ? "error" : "success"}
            title={
              <>
                Result: <span>{resultLabel ?? submittedGrade}</span>
              </>
            }
            secondary={
              isAgain
                ? "Will repeat after a few more cards"
                : undefined
            }
          />
          {isAgain ? (
            <button
              type="button"
              onClick={onNext}
              disabled={busy}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Next
            </button>
          ) : (
            <FlashcardSuccessActions onNext={onNext} busy={busy} />
          )}
        </>
      ) : (
        <NormalGradeButtons busy={busy} onChoice={onChoice} />
      )}

      {helperText ? <p className="text-sm text-zinc-500">{helperText}</p> : null}
    </div>
  );
}

function NormalGradeButtons({
  busy,
  onChoice,
}: {
  busy: boolean;
  onChoice: (choice: NormalReviewChoice) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <GradeButton
        label="I missed it"
        className="border-rose-200 text-rose-700 hover:bg-rose-50/50 dark:border-rose-900/70 dark:text-rose-300 dark:hover:bg-rose-950/20"
        disabled={busy}
        onClick={() => onChoice("missed")}
      />
      <GradeButton
        label="I got it"
        className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-200 dark:hover:bg-green-950/50"
        disabled={busy}
        onClick={() => onChoice("got_it")}
      />
    </div>
  );
}

function GradeButton({
  label,
  onClick,
  className,
  disabled,
}: {
  label: string;
  onClick: () => void;
  className: string;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${className}`}
    >
      {label}
    </button>
  );
}
