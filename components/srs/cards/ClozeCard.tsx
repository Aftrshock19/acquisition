"use client";

import type { ReactNode, RefObject } from "react";
import { TypingFlashcardCard } from "@/components/srs/cards/TypingFlashcardCard";
import {
  getEnglishPromptText,
  type UnifiedQueueCard,
} from "@/components/srs/logic/buildUnifiedQueue";

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
  answerRevealed?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onCheck: () => void;
  onReveal?: () => void;
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
  answerRevealed = false,
  inputRef,
  onChange,
  onCheck,
  onReveal,
  onNext,
  navigation,
}: ClozeCardProps) {
  const translationLabel =
    card.direction === "en_to_es"
      ? "Write Spanish translation"
      : "Write English translation";

  return (
    <TypingFlashcardCard
      typeLabel={translationLabel}
      title={translationLabel}
      prompt={
        <>
          <p className="mt-2 text-zinc-700 dark:text-zinc-200">
            {card.direction === "en_to_es" ? (getEnglishPromptText(card) ?? "—") : card.lemma}
          </p>
          {showPosHint && card.hint ? (
            <p className="mt-2 text-sm text-zinc-500">({card.hint})</p>
          ) : null}
        </>
      }
      value={value}
      busy={busy}
      submitError={submitError}
      feedback={feedback}
      correctionPlaceholder={correctionPlaceholder}
      correctionPlaceholderVisible={correctionPlaceholderVisible}
      answerRevealed={answerRevealed}
      inputRef={inputRef}
      inputPlaceholder={`${translationLabel}...`}
      showAcceptedAnswers={Boolean(feedback?.expected.includes(" or "))}
      navigation={navigation}
      onChange={onChange}
      onCheck={onCheck}
      onReveal={onReveal}
      onNext={onNext}
    />
  );
}
