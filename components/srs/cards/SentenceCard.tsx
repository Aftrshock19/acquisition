"use client";

import {
  Fragment,
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  FlashcardContainer,
  FlashcardSuccessActions,
  getFlashcardFieldToneClasses,
} from "@/components/srs/cards/FlashcardContainer";
import { SENTENCE_CLOZE_BLANK_TOKEN } from "@/components/srs/logic/buildSentencePrompt";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";

const SENTENCE_SUPPORT_EXPANDED_STORAGE_KEY =
  "sentence-card-support-expanded";

type SentenceCardProps = {
  card: Extract<UnifiedQueueCard, { cardType: "sentences" }>;
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

export function SentenceCard({
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
}: SentenceCardProps) {
  const [supportExpanded, setSupportExpanded] = useState(false);
  const needsCorrection = feedback?.correct === false;
  const showingSuccess = feedback?.correct === true;
  const tone = showingSuccess ? "success" : needsCorrection ? "error" : "default";
  const wordTranslation = card.translation?.trim() || null;
  const englishSentence = card.exampleSentenceEn?.trim() || null;
  const hasSupportPanel = Boolean(wordTranslation || englishSentence);
  const inputWidth = Math.max(
    6,
    value.length,
    correctionPlaceholder?.length ?? 0,
    card.correctOption.length,
  );

  useEffect(() => {
    try {
      const savedState = window.localStorage.getItem(
        SENTENCE_SUPPORT_EXPANDED_STORAGE_KEY,
      );
      if (savedState === "true") {
        setSupportExpanded(true);
      }
    } catch {
      // Ignore unavailable storage and keep the default collapsed state.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SENTENCE_SUPPORT_EXPANDED_STORAGE_KEY,
        supportExpanded ? "true" : "false",
      );
    } catch {
      // Ignore unavailable storage.
    }
  }, [supportExpanded]);

  return (
    <div className="flex flex-col gap-6">
      <FlashcardContainer
        typeLabel="Complete the sentence"
        title="Complete the sentence"
        navigation={navigation}
      >
        <p className="mt-2 text-xl font-medium tracking-tight text-zinc-900 dark:text-zinc-100">
          {card.sentenceData.sentence.split(SENTENCE_CLOZE_BLANK_TOKEN).map((part, index) => (
            <Fragment key={`${part}-${index}`}>
              {index > 0 ? (
                <span className="relative mx-1 inline-flex align-baseline">
                  <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={tone === "error" ? undefined : " "}
                    aria-invalid={tone === "error"}
                    autoComplete="off"
                    readOnly={showingSuccess}
                    disabled={busy}
                    style={{ width: `${inputWidth}ch` }}
                    className={`min-w-16 rounded-md px-3 py-1 align-baseline text-center text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-1 disabled:opacity-50 dark:text-zinc-100 ${getFlashcardFieldToneClasses(
                      tone,
                    )}`}
                  />
                  {tone === "error" && correctionPlaceholder ? (
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-center text-sm text-zinc-400 transition-opacity duration-300 dark:text-zinc-500 ${
                        correctionPlaceholderVisible && !value ? "opacity-100" : "opacity-0"
                      }`}
                    >
                      {correctionPlaceholder}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {part}
            </Fragment>
          ))}
        </p>

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
        <details
          open={supportExpanded}
          onToggle={(event) => {
            setSupportExpanded(event.currentTarget.open);
          }}
          className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70"
        >
          <summary className="cursor-pointer list-none">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">
                  {wordTranslation ?? "Unavailable"}
                </p>
              </div>
              {englishSentence ? (
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  {supportExpanded ? "Hide sentence" : "Show sentence"}
                </span>
              ) : null}
            </div>
          </summary>

          {englishSentence ? (
            <div className="mt-3 pt-1">
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {englishSentence}
              </p>
            </div>
          ) : null}
        </details>
      ) : null}

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
