"use client";

import { useEffect, useState } from "react";

const HIDDEN_TRANSLATION_MASK = "mmmmmmmmmmm";
const HIDE_TRANSLATION_TRANSITION_MS = 140;

type SupportPanelProps = {
  translation: string | null;
  englishSentence?: string | null;
  hideTranslation?: boolean;
  storageKey?: string;
};

export function SupportPanel({
  translation,
  englishSentence = null,
  hideTranslation = false,
  storageKey,
}: SupportPanelProps) {
  const [supportExpanded, setSupportExpanded] = useState(() =>
    storageKey ? readStoredBoolean(storageKey) : false,
  );

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(
        storageKey,
        supportExpanded ? "true" : "false",
      );
    } catch {
      // Ignore unavailable storage.
    }
  }, [storageKey, supportExpanded]);

  const [translationRevealed, setTranslationRevealed] = useState(false);
  const [translationHiding, setTranslationHiding] = useState(false);

  useEffect(() => {
    if (!translationHiding) return;
    const timeoutId = window.setTimeout(() => {
      setTranslationRevealed(false);
      setTranslationHiding(false);
    }, HIDE_TRANSLATION_TRANSITION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [translationHiding]);

  const hasSentence = Boolean(englishSentence);
  const showEnglishSentence = hasSentence && supportExpanded;
  const showMaskedTranslation =
    hideTranslation && !translationRevealed && !translationHiding;
  const translationDisplayText = showMaskedTranslation
    ? HIDDEN_TRANSLATION_MASK
    : translation;
  const hiddenTranslationWidthCh = Math.max(
    HIDDEN_TRANSLATION_MASK.length,
    translation?.length ?? 0,
  );
  const hiddenTranslationWidthStyle = {
    width: `${hiddenTranslationWidthCh}ch`,
    maxWidth: "100%",
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
      <div className="flex flex-col items-start gap-2">
        <div className="min-w-0 max-w-full">
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
              title={
                translationRevealed ? "Hide translation" : "Reveal translation"
              }
              style={
                showMaskedTranslation ? hiddenTranslationWidthStyle : undefined
              }
              className={`group -mx-1.5 -my-1 inline-flex max-w-full rounded-md px-1.5 py-1 text-left transition-[background-color,box-shadow] duration-150 hover:bg-zinc-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:hover:bg-zinc-800/80 dark:focus-visible:ring-zinc-500 ${
                showMaskedTranslation
                  ? "bg-zinc-200/60 dark:bg-transparent"
                  : ""
              }`}
            >
              <span
                className={`block max-w-full whitespace-normal break-words [overflow-wrap:anywhere] text-base font-medium transition-[filter,opacity,color,width,text-shadow,background-color] duration-150 ${
                  showMaskedTranslation
                    ? "select-none overflow-hidden rounded-md text-left tracking-[0.12em] text-zinc-500 blur-[7px] opacity-95 [text-shadow:0_0_14px_rgba(113,113,122,0.9)] dark:text-white dark:[text-shadow:0_0_14px_rgba(255,255,255,0.95)]"
                    : translationHiding
                      ? "w-auto text-zinc-500 blur-[7px] opacity-95 [text-shadow:0_0_14px_rgba(113,113,122,0.9)] dark:text-white dark:[text-shadow:0_0_14px_rgba(255,255,255,0.95)]"
                      : "w-auto text-zinc-900 opacity-100 dark:text-zinc-100"
                }`}
                style={
                  showMaskedTranslation
                    ? hiddenTranslationWidthStyle
                    : undefined
                }
              >
                {translationDisplayText}
              </span>
            </button>
          ) : (
            <p className="max-w-full whitespace-normal break-words [overflow-wrap:anywhere] text-base font-medium text-zinc-900 dark:text-zinc-100">
              {translation ?? "Unavailable"}
            </p>
          )}
        </div>
        {hasSentence ? (
          <button
            type="button"
            onClick={() => setSupportExpanded((current) => !current)}
            aria-expanded={supportExpanded}
            className="shrink-0 self-start whitespace-nowrap text-left text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            {supportExpanded ? "Hide sentence" : "Show sentence"}
          </button>
        ) : null}
      </div>

      {showEnglishSentence ? (
        <div className="mt-3 pt-1">
          <p className="max-w-full whitespace-normal break-words [overflow-wrap:anywhere] text-sm text-zinc-700 dark:text-zinc-300">
            {englishSentence}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function readStoredBoolean(key: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}
