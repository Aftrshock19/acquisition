"use client";

import {
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { InteractiveText } from "@/components/interactive-text/InteractiveText";
import {
  FlashcardContainer,
  FlashcardSuccessActions,
} from "@/components/srs/cards/FlashcardContainer";
import { SentenceClozePrompt } from "@/components/srs/cards/SentenceClozePrompt";
import { TextAnswerInput } from "@/components/srs/cards/TextAnswerInput";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";

const SENTENCE_SUPPORT_EXPANDED_STORAGE_KEY =
  "sentence-card-support-expanded";
const HIDDEN_TRANSLATION_MASK = "mmmmmmmmmmmmmmmm";
const HIDE_TRANSLATION_TRANSITION_MS = 140;

type SentenceCardProps = {
  card: Extract<UnifiedQueueCard, { cardType: "sentences" }>;
  value: string;
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
  hideTranslation = false,
  feedback,
  correctionPlaceholder,
  correctionPlaceholderVisible = false,
  inputRef,
  onChange,
  onCheck,
  onNext,
  navigation,
}: SentenceCardProps) {
  const [supportExpanded, setSupportExpanded] = useState(() =>
    readStoredBoolean(SENTENCE_SUPPORT_EXPANDED_STORAGE_KEY),
  );
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
        <SentenceClozePrompt
          sentence={card.sentenceData.sentence}
          className="mt-2 text-xl font-medium tracking-tight text-zinc-900 dark:text-zinc-100"
          blankContent={
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
              wrapperClassName="mx-1 inline-flex align-baseline"
              inputStyle={{ width: `${inputWidth}ch` }}
            />
          }
          renderTextPart={
            (part, index) => (
              <InteractiveText
                text={part}
                tokenKeyPrefix={`sentence-card-${card.id}-${index}`}
                preserveFocusOnPress
              />
            )
          }
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
        <SentenceSupportPanel
          key={`${card.id}-${hideTranslation ? "hidden" : "shown"}`}
          hideTranslation={hideTranslation}
          translation={wordTranslation}
          englishSentence={englishSentence}
          supportExpanded={supportExpanded}
          onToggleSupportExpanded={() => setSupportExpanded((current) => !current)}
        />
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

function SentenceSupportPanel({
  translation,
  englishSentence,
  hideTranslation,
  supportExpanded,
  onToggleSupportExpanded,
}: {
  translation: string | null;
  englishSentence: string | null;
  hideTranslation: boolean;
  supportExpanded: boolean;
  onToggleSupportExpanded: () => void;
}) {
  const [translationRevealed, setTranslationRevealed] = useState(false);
  const [translationHiding, setTranslationHiding] = useState(false);
  const showEnglishSentence = Boolean(englishSentence) && supportExpanded;
  const showMaskedTranslation =
    hideTranslation && !translationRevealed && !translationHiding;
  const translationDisplayText = showMaskedTranslation
    ? HIDDEN_TRANSLATION_MASK
    : translation;
  const hiddenTranslationWidthCh = Math.max(
    HIDDEN_TRANSLATION_MASK.length,
    translation?.length ?? 0,
  );
  const hiddenTranslationWidthStyle = { width: `${hiddenTranslationWidthCh}ch` };

  useEffect(() => {
    if (!translationHiding) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setTranslationRevealed(false);
      setTranslationHiding(false);
    }, HIDE_TRANSLATION_TRANSITION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [translationHiding]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
      <div className="flex items-start justify-between gap-4">
        <div>
          {hideTranslation && translation ? (
            <button
              type="button"
              onClick={() => {
                if (translationRevealed) {
                  setTranslationHiding(true);
                  return;
                }

                setTranslationHiding(false);
                setTranslationRevealed(true);
              }}
              aria-pressed={translationRevealed}
              aria-label={
                translationRevealed ? "Hide translation" : "Reveal translation"
              }
              title={translationRevealed ? "Hide translation" : "Reveal translation"}
              style={showMaskedTranslation ? hiddenTranslationWidthStyle : undefined}
              className="group -mx-1.5 -my-1 inline-flex rounded-md px-1.5 py-1 text-left transition-[background-color,box-shadow] duration-150 hover:bg-zinc-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:hover:bg-zinc-800/80 dark:focus-visible:ring-zinc-500"
            >
              <span
                className={`inline-block whitespace-nowrap text-base font-medium transition-[filter,opacity,color,width,text-shadow] duration-150 ${
                  showMaskedTranslation
                    ? "select-none overflow-hidden text-left tracking-[0.12em] text-white blur-[7px] opacity-95 [text-shadow:0_0_14px_rgba(255,255,255,0.95)]"
                    : translationHiding
                      ? "w-auto text-white blur-[7px] opacity-95 [text-shadow:0_0_14px_rgba(255,255,255,0.95)]"
                      : "w-auto text-zinc-900 opacity-100 dark:text-zinc-100"
                }`}
                style={showMaskedTranslation ? hiddenTranslationWidthStyle : undefined}
              >
                {translationDisplayText}
              </span>
            </button>
          ) : (
            <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">
              {translation ?? "Unavailable"}
            </p>
          )}
        </div>
        {englishSentence ? (
          <button
            type="button"
            onClick={onToggleSupportExpanded}
            aria-expanded={supportExpanded}
            className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            {supportExpanded ? "Hide sentence" : "Show sentence"}
          </button>
        ) : null}
      </div>

      {showEnglishSentence ? (
        <div className="mt-3 pt-1">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {englishSentence}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function readStoredBoolean(key: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}
