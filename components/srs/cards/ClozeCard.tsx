"use client";

import type { RefObject } from "react";
import type { UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";

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
  inputRef?: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onCheck: () => void;
  onNext: () => void;
  retryDelayMs: number;
};

export function ClozeCard({
  card,
  value,
  busy,
  submitError,
  showPosHint = true,
  feedback,
  inputRef,
  onChange,
  onCheck,
  onNext,
  retryDelayMs,
}: ClozeCardProps) {
  if (feedback) {
    return (
      <div className="flex flex-col gap-6">
        <div
          className={`rounded-xl border p-6 ${
            feedback.correct
              ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/40"
              : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40"
          }`}
        >
          <p className="font-medium">{feedback.correct ? "Correct" : "Incorrect"}</p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            Expected: {feedback.expected}
          </p>
          {!feedback.correct ? (
            <p className="mt-1 text-sm text-zinc-500">
              Will repeat in {Math.max(1, Math.round(retryDelayMs / 1000))}s
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onNext}
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Next
        </button>

        <p className="text-sm text-zinc-500">Press Enter to continue</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          {card.direction === "en_to_es" ? "Meaning" : "Word"}
        </p>
        <p className="mt-2 text-zinc-700 dark:text-zinc-200">
          {card.direction === "en_to_es" ? (card.definition ?? "—") : card.lemma}
        </p>
        {showPosHint && card.hint ? (
          <p className="mt-1 text-sm text-zinc-500">({card.hint})</p>
        ) : null}
        {submitError ? (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {submitError}
          </p>
        ) : null}

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            card.direction === "en_to_es"
              ? "Type the Spanish word..."
              : "Type the meaning..."
          }
          className="mt-4 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          autoComplete="off"
          disabled={busy}
        />
      </div>

      <button
        type="button"
        onClick={onCheck}
        disabled={busy || !value.trim()}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Check
      </button>

      <p className="text-sm text-zinc-500">Press Enter to check</p>
    </div>
  );
}
