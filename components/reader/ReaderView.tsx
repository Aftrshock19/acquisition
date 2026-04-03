"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { X } from "lucide-react";
import { lookupReaderWordAction, saveReaderWordAction } from "@/app/reader/actions";
import { toReadingBlocks } from "@/lib/loop/reader";
import { tokenize } from "@/lib/reader/tokenize";
import type { ReaderLookupEntry, ReaderText, ReaderToken } from "@/lib/reader/types";

type ReaderViewProps = {
  text: ReaderText;
  initialSavedWordIds: string[];
  initialSavedLemmas: string[];
};

type SelectedToken = {
  surface: string;
  normalized: string;
};

type LookupState =
  | {
      status: "idle" | "loading" | "missing";
      entry: null;
      error: null;
    }
  | {
      status: "success";
      entry: ReaderLookupEntry;
      error: null;
    }
  | {
      status: "error";
      entry: null;
      error: string;
    };

const INITIAL_LOOKUP_STATE: LookupState = {
  status: "idle",
  entry: null,
  error: null,
};

export function ReaderView({
  text,
  initialSavedWordIds,
  initialSavedLemmas,
}: ReaderViewProps) {
  const blocks = useMemo(
    () => toReadingBlocks(text.content).map((block) => tokenize(block)),
    [text.content],
  );
  const [selectedToken, setSelectedToken] = useState<SelectedToken | null>(null);
  const [lookupState, setLookupState] = useState<LookupState>(INITIAL_LOOKUP_STATE);
  const [savedWordIds, setSavedWordIds] = useState(() => new Set(initialSavedWordIds));
  const [savedNormalized, setSavedNormalized] = useState(
    () => new Set(initialSavedLemmas.map((lemma) => lemma.toLocaleLowerCase("es"))),
  );
  const [resolvedWordIds, setResolvedWordIds] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [, startLookupTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();
  const lookupRequestRef = useRef(0);

  function handleTokenPress(token: ReaderToken) {
    if (!token.isWord) return;

    const nextRequestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = nextRequestId;

    setSelectedToken({
      surface: token.surface,
      normalized: token.normalized,
    });
    setLookupState({
      status: "loading",
      entry: null,
      error: null,
    });
    setSaveError(null);

    startLookupTransition(() => {
      void lookupReaderWordAction({
        lang: text.lang,
        normalized: token.normalized,
      }).then((result) => {
        if (lookupRequestRef.current !== nextRequestId) {
          return;
        }

        if (!result.ok) {
          setLookupState({
            status: "error",
            entry: null,
            error: result.error,
          });
          return;
        }

        if (!result.entry) {
          setLookupState({
            status: "missing",
            entry: null,
            error: null,
          });
          return;
        }

        const entry = result.entry;

        setResolvedWordIds((current) => ({
          ...current,
          [token.normalized]: entry.id,
        }));
        setLookupState({
          status: "success",
          entry,
          error: null,
        });
      });
    });
  }

  function handleClose() {
    setSelectedToken(null);
    setLookupState(INITIAL_LOOKUP_STATE);
    setSaveError(null);
  }

  function handleSave() {
    if (!selectedToken || lookupState.status !== "success") {
      return;
    }

    const entry = lookupState.entry;
    const previousSavedWordIds = new Set(savedWordIds);
    const previousSavedNormalized = new Set(savedNormalized);

    setSaveError(null);
    setSavedWordIds((current) => new Set(current).add(entry.id));
    setSavedNormalized((current) => {
      const next = new Set(current);
      next.add(selectedToken.normalized);
      next.add(entry.lemma.toLocaleLowerCase("es"));
      return next;
    });
    setResolvedWordIds((current) => ({
      ...current,
      [selectedToken.normalized]: entry.id,
    }));

    startSaveTransition(() => {
      void saveReaderWordAction({
        lang: text.lang,
        wordId: entry.id,
      }).then((result) => {
        if (result.ok) {
          return;
        }

        setSavedWordIds(previousSavedWordIds);
        setSavedNormalized(previousSavedNormalized);
        setSaveError(result.error);
      });
    });
  }

  const currentEntrySaved =
    lookupState.status === "success"
      ? savedWordIds.has(lookupState.entry.id)
      : false;

  return (
    <>
      <section className="app-card-strong flex flex-col gap-6 p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="rounded-full border border-zinc-200 px-3 py-1 dark:border-zinc-800">
            {text.lang.toUpperCase()}
          </span>
          <span>Saved words stay highlighted in this text.</span>
        </div>

        <div className="flex flex-col gap-5 text-lg leading-9 text-zinc-900 dark:text-zinc-100 sm:text-xl sm:leading-10">
          {blocks.map((block, blockIndex) => (
            <p
              key={`${blockIndex}-${block[0]?.surface ?? "empty"}`}
              className="whitespace-pre-wrap"
            >
              {block.map((token, tokenIndex) =>
                token.isWord ? (
                  <button
                    key={`${blockIndex}-${tokenIndex}-${token.surface}`}
                    type="button"
                    onClick={() => handleTokenPress(token)}
                    className={getWordButtonClassName(
                      isSavedToken(
                        token,
                        savedNormalized,
                        savedWordIds,
                        resolvedWordIds,
                      ),
                    )}
                  >
                    {token.surface}
                  </button>
                ) : (
                  <span key={`${blockIndex}-${tokenIndex}-${token.surface}`}>
                    {token.surface}
                  </span>
                ),
              )}
            </p>
          ))}
        </div>
      </section>

      {selectedToken ? (
        <div className="fixed inset-0 z-40 bg-zinc-950/20 backdrop-blur-[1px]" onClick={handleClose}>
          <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-2xl px-3 pb-3 md:inset-x-auto md:bottom-6 md:left-1/2 md:w-[min(32rem,calc(100vw-2rem))] md:-translate-x-1/2 md:px-0 md:pb-0">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="reader-word-panel-title"
              className="app-card-strong flex max-h-[80vh] flex-col gap-4 rounded-[1.75rem] p-5 sm:p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                    Word
                  </p>
                  <h2
                    id="reader-word-panel-title"
                    className="mt-2 break-words text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50"
                  >
                    {selectedToken.surface}
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={handleClose}
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
                      onClick={handleSave}
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
      ) : null}
    </>
  );
}

function isSavedToken(
  token: ReaderToken,
  savedNormalized: Set<string>,
  savedWordIds: Set<string>,
  resolvedWordIds: Record<string, string>,
) {
  if (savedNormalized.has(token.normalized)) {
    return true;
  }

  const resolvedWordId = resolvedWordIds[token.normalized];
  return resolvedWordId ? savedWordIds.has(resolvedWordId) : false;
}

function getWordButtonClassName(saved: boolean) {
  return [
    "inline rounded-md px-0.5 py-0.5 text-left outline-none",
    "focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
    saved
      ? "bg-emerald-100/90 text-emerald-900 hover:bg-emerald-200/90 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
      : "text-inherit hover:bg-zinc-200/70 dark:hover:bg-zinc-800/80",
  ].join(" ");
}
