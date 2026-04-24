"use client";

import { type ReactNode, type RefObject } from "react";
import { InteractiveText } from "@/components/interactive-text/InteractiveText";
import {
  FlashcardContainer,
  FlashcardSuccessActions,
} from "@/components/srs/cards/FlashcardContainer";
import { SentenceClozePrompt } from "@/components/srs/cards/SentenceClozePrompt";
import { SupportPanel } from "@/components/srs/cards/SupportPanel";
import { TextAnswerInput } from "@/components/srs/cards/TextAnswerInput";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";

const SENTENCE_SUPPORT_EXPANDED_STORAGE_KEY = "sentence-card-support-expanded";

type SentenceCardProps = {
  card: Extract<UnifiedQueueCard, { cardType: "sentences" }>;
  value: string;
  busy: boolean;
  submitError: string | null;
  showPosHint?: boolean;
  hideTranslation?: boolean;
  feedback: {
    correct: boolean;
    expected: string;
  } | null;
  correctionPlaceholder?: string;
  correctionPlaceholderVisible?: boolean;
  answerRevealed?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onCheck: () => void;
  onReveal?: () => void;
  onNext: () => void;
  navigation?: ReactNode;
};

export function SentenceCard({
  card,
  value,
  busy,
  submitError,
  showPosHint = true,
  hideTranslation = false,
  feedback,
  correctionPlaceholder,
  correctionPlaceholderVisible = false,
  answerRevealed = false,
  inputRef,
  onChange,
  onCheck,
  onReveal,
  onNext,
  navigation,
}: SentenceCardProps) {
  const needsCorrection = feedback?.correct === false && !answerRevealed;
  const showingSuccess = feedback?.correct === true;
  const tone = showingSuccess
    ? "success"
    : needsCorrection
      ? "error"
      : "default";
  const isShowAnswer =
    !needsCorrection &&
    !showingSuccess &&
    !answerRevealed &&
    !value.trim() &&
    onReveal;
  const wordTranslation = card.translation?.trim() || null;
  const englishSentence = card.exampleSentenceEn?.trim() || null;
  const hasSupportPanel = Boolean(wordTranslation || englishSentence);
  const inputWidth = Math.max(
    6,
    value.length,
    correctionPlaceholder?.length ?? 0,
    card.correctOption.length,
  );

  return (
    <div className="flex flex-col gap-6">
      <FlashcardContainer
        typeLabel="Complete the sentence"
        title="Complete the sentence"
        navigation={navigation}
      >
        <SentenceClozePrompt
          sentence={card.sentenceData.sentence}
          className="mt-2 text-xl font-medium tracking-tight break-words text-zinc-900 dark:text-zinc-100"
          blankContent={
            answerRevealed && feedback ? (
              <span className="inline-flex min-w-16 max-w-[20ch] items-center justify-center overflow-hidden rounded-md border border-zinc-300 bg-zinc-50 px-1 py-0.5 align-middle text-xl font-medium tracking-tight text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-100">
                {feedback.expected}
              </span>
            ) : (
              <TextAnswerInput
                value={value}
                onChange={onChange}
                correctionHint={correctionPlaceholder}
                correctionHintVisible={correctionPlaceholderVisible}
                tone={tone}
                inputRef={inputRef}
                readOnly={showingSuccess}
                disabled={busy}
                variant="inline"
                wrapperClassName="inline-flex max-w-[20ch] items-center justify-center overflow-hidden rounded-md px-1 py-0.5 align-middle"
                inputStyle={{ width: `${inputWidth}ch` }}
              />
            )
          }
          renderTextPart={(part, index) => (
            <InteractiveText
              text={part}
              tokenKeyPrefix={`sentence-card-${card.id}-${index}`}
              preserveFocusOnPress
            />
          )}
        />

        {showPosHint && card.hint ? (
          <p className="mt-2 text-sm text-zinc-500">({card.hint})</p>
        ) : null}

        {submitError ? (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {submitError}
          </p>
        ) : null}
      </FlashcardContainer>

      {hasSupportPanel ? (
        <SupportPanel
          key={`${card.id}-${hideTranslation ? "hidden" : "shown"}`}
          translation={wordTranslation}
          englishSentence={englishSentence}
          hideTranslation={hideTranslation}
          storageKey={SENTENCE_SUPPORT_EXPANDED_STORAGE_KEY}
        />
      ) : null}

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
            {needsCorrection
              ? "Try again"
              : isShowAnswer
                ? "Show answer"
                : "Check"}
          </button>
          <p className="text-sm text-zinc-500">
            {needsCorrection
              ? "Press Enter to try again"
              : isShowAnswer
                ? "Press Enter to show answer"
                : "Press Enter to check"}
          </p>
        </>
      )}
    </div>
  );
}
