"use client";

import { X } from "lucide-react";
import type {
  InteractiveTextLookupState,
  SelectedWordToken,
} from "@/components/interactive-text/useInteractiveTextController";

type WordLookupPanelProps = {
  interactionContext?: string;
  selectedToken: SelectedWordToken | null;
  lookupState: InteractiveTextLookupState;
  currentEntrySaved: boolean;
  savePending: boolean;
  saveError: string | null;
  onClose: () => void;
  onSave: () => void;
};

export function WordLookupPanel({
  interactionContext,
  selectedToken,
  lookupState,
  currentEntrySaved,
  savePending,
  saveError,
  onClose,
  onSave,
}: WordLookupPanelProps) {
  if (!selectedToken) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-zinc-950/20 backdrop-blur-[1px]"
      data-interaction-context={interactionContext}
      onClick={onClose}
    >
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-2xl px-3 pb-3 md:inset-x-auto md:bottom-6 md:left-1/2 md:w-[min(32rem,calc(100vw-2rem))] md:-translate-x-1/2 md:px-0 md:pb-0">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="interactive-text-word-panel-title"
          className="app-card-strong flex max-h-[80vh] flex-col gap-4 rounded-[1.75rem] p-5 sm:p-6"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                Word
              </p>
              <h2
                id="interactive-text-word-panel-title"
                className="mt-2 break-words text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
              >
                {selectedToken.surface}
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="app-icon-button shrink-0"
              aria-label="Close definition panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {lookupState.status === "loading" ? (
            <div className="app-card-muted flex flex-col gap-3 p-4 text-sm text-zinc-600 dark:text-zinc-300">
              <div className="h-4 w-20 animate-pulse rounded-full bg-zinc-200/80 dark:bg-zinc-800/80" />
              <div className="h-4 w-full animate-pulse rounded-full bg-zinc-200/70 dark:bg-zinc-800/70" />
              <div className="h-4 w-5/6 animate-pulse rounded-full bg-zinc-200/60 dark:bg-zinc-800/60" />
            </div>
          ) : null}

          {lookupState.status === "error" ? (
            <div className="rounded-2xl border border-red-200 bg-red-50/90 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {lookupState.error}
            </div>
          ) : null}

          {lookupState.status === "missing" ? (
            <div className="app-card-muted flex flex-col gap-2 p-4 text-sm text-zinc-600 dark:text-zinc-300">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">
                No dictionary entry yet
              </p>
              <p>
                This word is not in the current lookup tables. You can keep
                reading and try another word.
              </p>
            </div>
          ) : null}

          {lookupState.status === "success" ? (
            <div className="flex flex-col gap-4">
              <div className="app-card-muted flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
                    {lookupState.entry.lemma}
                  </span>
                  {lookupState.entry.pos ? (
                    <span className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                      {lookupState.entry.pos}
                    </span>
                  ) : null}
                  {currentEntrySaved ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                      Saved
                    </span>
                  ) : null}
                </div>

                <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-200">
                  {lookupState.entry.definition ?? "No definition available yet."}
                </p>
              </div>

              {saveError ? (
                <p className="rounded-xl border border-red-200 bg-red-50/90 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                  {saveError}
                </p>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  Saving adds this word to your manual saved deck and
                  ensures an SRS row exists.
                </p>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={currentEntrySaved || savePending}
                  className={currentEntrySaved ? "app-button-secondary" : "app-button"}
                >
                  {currentEntrySaved ? "Saved" : savePending ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
