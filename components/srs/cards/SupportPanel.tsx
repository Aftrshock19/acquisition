"use client";

import { useEffect, useState } from "react";

const HIDDEN_TRANSLATION_MASK = "mmmmmmmmmmmmmmmm";
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
  const hiddenTranslationWidthStyle = { width: `${hiddenTranslationWidthCh}ch` };

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
        {hasSentence ? (
          <button
            type="button"
            onClick={() => setSupportExpanded((current) => !current)}
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
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}
