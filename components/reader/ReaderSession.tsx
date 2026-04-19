"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  markReadingOpened,
  markReadingComplete,
  uncompleteReadingStep,
} from "@/app/actions/srs";
import { ReadingQuiz } from "@/components/reader/ReadingQuiz";
import { InteractiveText } from "@/components/interactive-text/InteractiveText";
import { InteractiveTextProvider } from "@/components/interactive-text/InteractiveTextProvider";
import { toReadingBlocks } from "@/lib/loop/reader";
import { tokenize } from "@/lib/reader/tokenize";
import type { ReaderText } from "@/lib/reader/types";
import type { ReadingQuestion } from "@/lib/reading/types";

type ReaderSessionProps = {
  text: ReaderText;
  initialSavedWordIds: string[];
  initialSavedLemmas: string[];
  listeningAssetId: string | null;
  readingDone: boolean;
  listeningDone: boolean;
  questions?: ReadingQuestion[];
  initialCompleted?: boolean;
};

export function ReaderSession({
  text,
  initialSavedWordIds,
  initialSavedLemmas,
  listeningAssetId,
  readingDone,
  listeningDone,
  questions = [],
  initialCompleted = false,
}: ReaderSessionProps) {
  const blocks = useMemo(
    () => toReadingBlocks(text.content).map((block) => tokenize(block)),
    [text.content],
  );
  const activeStartedAtRef = useRef<number | null>(null);
  const accumulatedMsRef = useRef(0);
  const [quizOpen, setQuizOpen] = useState(false);
  const [localCompleted, setLocalCompleted] = useState(initialCompleted);
  const [completionPending, startCompletionTransition] = useTransition();
  const [completionError, setCompletionError] = useState<string | null>(null);

  useEffect(() => {
    void markReadingOpened({ textId: text.id });
  }, [text.id]);

  useEffect(() => {
    const activate = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (activeStartedAtRef.current === null) {
        activeStartedAtRef.current = Date.now();
      }
    };
    const deactivate = () => {
      if (activeStartedAtRef.current === null) {
        return;
      }

      accumulatedMsRef.current += Date.now() - activeStartedAtRef.current;
      activeStartedAtRef.current = null;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        activate();
        return;
      }

      deactivate();
    };

    handleVisibilityChange();
    window.addEventListener("focus", activate);
    window.addEventListener("blur", deactivate);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      deactivate();
      window.removeEventListener("focus", activate);
      window.removeEventListener("blur", deactivate);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  function getReadingTimeSeconds() {
    const liveMs =
      activeStartedAtRef.current === null ? 0 : Date.now() - activeStartedAtRef.current;
    return Math.max(0, Math.round((accumulatedMsRef.current + liveMs) / 1000));
  }

  function handleMarkComplete() {
    if (completionPending || localCompleted) return;
    startCompletionTransition(async () => {
      setCompletionError(null);
      const result = await markReadingComplete({
        textId: text.id,
        readingTimeSeconds: getReadingTimeSeconds(),
      });
      if (!result.ok) {
        setCompletionError(result.error);
        return;
      }
      setLocalCompleted(true);
    });
  }

  function handleUncomplete() {
    if (completionPending || !localCompleted) return;
    startCompletionTransition(async () => {
      setCompletionError(null);
      const result = await uncompleteReadingStep({ textId: text.id });
      if (!result.ok) {
        setCompletionError(result.error);
        return;
      }
      setLocalCompleted(false);
    });
  }

  return (
    <>
      <InteractiveTextProvider
        lang={text.lang}
        initialSavedWordIds={initialSavedWordIds}
        initialSavedLemmas={initialSavedLemmas}
        interactionContext="reader"
        textId={text.id}
        saveSource="reader"
      >
        <section className="app-card-strong flex flex-col gap-6 p-5 sm:p-7">
          {/* ── Header ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link
                href="/reading"
                aria-label="Back to reading"
                className="app-icon-button shrink-0"
              >
                <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
                  <path
                    d="M11.5 4.5L6 10l5.5 5.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
                Reading
              </p>
            </div>
            <button
              type="button"
              disabled={completionPending}
              onClick={localCompleted ? handleUncomplete : handleMarkComplete}
              className={localCompleted
                ? "rounded-full border border-emerald-200 bg-emerald-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700"
                : "rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-800 disabled:opacity-30 disabled:hover:border-zinc-200 disabled:hover:text-zinc-500 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200 dark:disabled:hover:border-zinc-700 dark:disabled:hover:text-zinc-400"}
              data-testid={localCompleted ? "complete-pill" : "mark-complete-button"}
            >
              {localCompleted ? "Complete" : "Mark complete"}
            </button>
          </div>

          {completionError ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {completionError}
            </p>
          ) : null}

          <div className="flex flex-col gap-5 text-lg leading-9 text-zinc-900 dark:text-zinc-100 sm:text-xl sm:leading-10">
            {blocks.map((block, blockIndex) => (
              <p
                key={`${blockIndex}-${block[0]?.surface ?? "empty"}`}
                className="whitespace-pre-wrap"
              >
                <InteractiveText
                  tokens={block}
                  tokenKeyPrefix={`reader-block-${blockIndex}`}
                />
              </p>
            ))}
          </div>
        </section>
      </InteractiveTextProvider>

      {/* ── Action row ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/listening"
          className="app-button"
          data-testid="go-to-listening-button"
        >
          Go to listening
        </Link>
        {questions.length > 0 ? (
          <button
            type="button"
            onClick={() => setQuizOpen((o) => !o)}
            className="app-button-secondary"
            data-testid="check-understanding-button"
          >
            {quizOpen ? "Hide questions" : "Check understanding"}
          </button>
        ) : null}
        <Link
          href="/reading"
          className="text-sm font-medium text-zinc-500 transition hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          data-testid="another-passage-button"
        >
          Another passage
        </Link>
      </div>

      {/* ── Reading comprehension (hidden by default) ─────── */}
      {quizOpen && questions.length > 0 ? (
        <ReadingQuiz
          textId={text.id}
          questions={questions}
          onComplete={() => setQuizOpen(false)}
        />
      ) : null}
    </>
  );
}
