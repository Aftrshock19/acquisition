"use client";

import type { ReactNode } from "react";
import { InteractiveText } from "@/components/interactive-text/InteractiveText";
import {
  FlashcardContainer,
  FlashcardFeedbackPanel,
  FlashcardSuccessActions,
} from "@/components/srs/cards/FlashcardContainer";
import { SentenceClozePrompt } from "@/components/srs/cards/SentenceClozePrompt";
import { SupportPanel } from "@/components/srs/cards/SupportPanel";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";

const MCQ_SUPPORT_EXPANDED_STORAGE_KEY = "mcq-card-support-expanded";

type McqCardProps = {
  card: Extract<UnifiedQueueCard, { cardType: "mcq" }>;
  busy: boolean;
  submitError: string | null;
  showPosHint?: boolean;
  hideTranslation?: boolean;
  feedback:
    | {
        correct: boolean;
        expected: string;
      }
    | null;
  onSelect: (option: string) => void;
  onNext: () => void;
  navigation?: ReactNode;
};

export function McqCard({
  card,
  busy,
  submitError,
  showPosHint = true,
  hideTranslation = false,
  feedback,
  onSelect,
  onNext,
  navigation,
}: McqCardProps) {
  if (feedback) {
    return (
      <FeedbackBlock
        correct={feedback.correct}
        expected={feedback.expected}
        onNext={onNext}
        busy={busy}
      />
    );
  }

  const isSentenceFormat =
    card.questionFormat === "sentence" && Boolean(card.sentenceData);
  const wordTranslation = card.translation?.trim() || null;
  const englishSentence = isSentenceFormat
    ? card.exampleSentenceEn?.trim() || null
    : null;
  const hasSupportPanel = Boolean(wordTranslation || englishSentence);

  return (
    <div className="flex flex-col gap-6">
      <FlashcardContainer
        typeLabel="Multiple Choice"
        title="Multiple choice"
        navigation={navigation}
      >
        <p className="mt-2 text-lg font-medium">{card.prompt}</p>
        {isSentenceFormat && card.sentenceData ? (
          <SentenceClozePrompt
            sentence={card.sentenceData.sentence}
            className="mt-4 text-xl font-medium tracking-tight text-zinc-900 dark:text-zinc-100"
            renderTextPart={(part, index) => (
              <InteractiveText
                text={part}
                tokenKeyPrefix={`mcq-card-${card.id}-${index}`}
                preserveFocusOnPress
              />
            )}
          />
        ) : null}
        {showPosHint && card.hint ? (
          <p className="mt-1 text-sm text-zinc-500">({card.hint})</p>
        ) : null}
        {submitError ? (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {submitError}
          </p>
        ) : null}
      </FlashcardContainer>

      {hasSupportPanel ? (
        <SupportPanel
          key={
            isSentenceFormat
              ? `${card.id}-${hideTranslation ? "hidden" : "shown"}`
              : card.id
          }
          translation={wordTranslation}
          englishSentence={englishSentence}
          hideTranslation={isSentenceFormat ? hideTranslation : false}
          storageKey={
            isSentenceFormat ? MCQ_SUPPORT_EXPANDED_STORAGE_KEY : undefined
          }
        />
      ) : null}

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
  busy,
}: {
  correct: boolean;
  expected: string;
  onNext: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <FlashcardFeedbackPanel
        tone={correct ? "success" : "error"}
        title={correct ? "Correct" : "Incorrect"}
        detail={`Expected: ${expected}`}
        secondary={
          !correct ? "Will repeat after a few more cards" : undefined
        }
      />
      {correct ? (
        <FlashcardSuccessActions onNext={onNext} busy={busy} />
      ) : (
        <button
          type="button"
          onClick={onNext}
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Next
        </button>
      )}
    </div>
  );
}
