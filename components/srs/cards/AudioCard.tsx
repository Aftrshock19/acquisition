"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  FlashcardContainer,
  FlashcardFeedbackPanel,
  FlashcardSuccessActions,
} from "@/components/srs/cards/FlashcardContainer";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";
import {
  FLASHCARD_SAVE_FALLBACK,
  toSafeUserMessage,
} from "@/lib/errors/userMessages";

type AudioCardProps = {
  card: Extract<UnifiedQueueCard, { cardType: "audio" }>;
  busy: boolean;
  submitError: string | null;
  showPosHint?: boolean;
  feedback:
    | {
        correct: boolean;
        expected: string;
      }
    | null;
  dontKnowRevealed?: boolean;
  onSelect: (option: string) => void;
  onDontKnow?: () => void;
  onNext: () => void;
  navigation?: ReactNode;
};

export function AudioCard({
  card,
  busy,
  submitError,
  showPosHint = true,
  feedback,
  dontKnowRevealed = false,
  onSelect,
  onDontKnow,
  onNext,
  navigation,
}: AudioCardProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    void playCardAudio(card, audioRef.current);
  }, [card]);

  const resolved = Boolean(feedback);

  if (resolved && !dontKnowRevealed) {
    return (
      <FeedbackBlock
        correct={feedback!.correct}
        expected={feedback!.expected}
        onNext={onNext}
        busy={busy}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <FlashcardContainer typeLabel="Audio" title="Audio" navigation={navigation}>
        <p className="mt-2 text-lg font-medium">{card.prompt}</p>
        {showPosHint && card.hint ? (
          <p className="mt-1 text-sm text-zinc-500">({card.hint})</p>
        ) : null}
        {submitError ? (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {toSafeUserMessage(submitError, FLASHCARD_SAVE_FALLBACK)}
          </p>
        ) : null}

        <div className="mt-4">
          {card.audioUrl ? <audio ref={audioRef} src={card.audioUrl} preload="none" /> : null}
          <button
            type="button"
            onClick={() => {
              void playCardAudio(card, audioRef.current);
            }}
            disabled={busy}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Play again
          </button>
        </div>
      </FlashcardContainer>

      <div className="grid gap-2">
        {card.options.map((option) => {
          const isCorrect = option === card.correctOption;

          if (dontKnowRevealed) {
            return (
              <div
                key={option}
                className={`rounded-lg border px-4 py-3 text-left text-sm ${
                  isCorrect
                    ? "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100"
                    : "border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-500"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span>{option}</span>
                  {isCorrect ? (
                    <span className="text-xs uppercase tracking-[0.12em]">
                      Correct answer
                    </span>
                  ) : null}
                </div>
              </div>
            );
          }

          return (
            <button
              key={option}
              type="button"
              onClick={() => onSelect(option)}
              disabled={busy}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-3 text-left text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              {option}
            </button>
          );
        })}
      </div>

      {dontKnowRevealed ? (
        <button
          type="button"
          onClick={onNext}
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Continue
        </button>
      ) : onDontKnow ? (
        <button
          type="button"
          onClick={onDontKnow}
          disabled={busy}
          className="self-center text-sm text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          I don&apos;t know
        </button>
      ) : null}
    </div>
  );
}

async function playCardAudio(
  card: Extract<UnifiedQueueCard, { cardType: "audio" }>,
  audioElement: HTMLAudioElement | null,
) {
  if (card.audioUrl && audioElement) {
    audioElement.currentTime = 0;
    await audioElement.play().catch(() => undefined);
    return;
  }

  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(card.audioText);
  utterance.lang = "es-ES";
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
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
