"use client";

import Link from "next/link";
import { useState } from "react";

type Props = {
  cardsPracticed: number;
  newCardsPracticed: number;
  reviewCardsPracticed: number;
  accuracy: number | null;
  timeOnTaskMs: number;
  reviewsExhausted?: boolean;
  newWordsExhausted?: boolean;
  loadingMore?: boolean;
  onLoadMore?: (count: number) => void;
  onStartUnlimited?: () => void;
};

export function PracticeCompleteScreen({
  cardsPracticed,
  newCardsPracticed,
  reviewCardsPracticed,
  accuracy,
  timeOnTaskMs,
  reviewsExhausted = true,
  newWordsExhausted = true,
  loadingMore = false,
  onLoadMore,
  onStartUnlimited,
}: Props) {
  const [view, setView] = useState<"results" | "chooser">("results");
  const [customAmount, setCustomAmount] = useState("");

  const elapsedMin = Math.max(1, Math.round(timeOnTaskMs / 60_000));
  const allExhausted = reviewsExhausted && newWordsExhausted;
  const canExtend = Boolean(onLoadMore) && !allExhausted;

  function handlePreset(n: number) {
    onLoadMore?.(n);
    setView("results");
    setCustomAmount("");
  }

  function handleCustomSubmit() {
    const n = parseInt(customAmount, 10);
    if (Number.isFinite(n) && n > 0) {
      onLoadMore?.(Math.min(n, 200));
      setView("results");
      setCustomAmount("");
    }
  }

  function handleUnlimited() {
    onStartUnlimited?.();
    setView("results");
  }

  if (view === "chooser") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-xl border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900/50">
        <h2 className="text-lg font-semibold tracking-tight">
          How many more would you like to do?
        </h2>
        <div className="flex flex-wrap gap-2">
          {[5, 10, 20, 50].map((n) => (
            <button
              key={n}
              type="button"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              disabled={loadingMore}
              onClick={() => handlePreset(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={200}
            placeholder="Other amount"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCustomSubmit();
              }
            }}
            className="w-32 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          {customAmount ? (
            <button
              type="button"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              disabled={loadingMore}
              onClick={handleCustomSubmit}
            >
              Go
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="self-start text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          disabled={loadingMore}
          onClick={handleUnlimited}
        >
          Keep going until I stop
        </button>
        <button
          type="button"
          className="self-start text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          onClick={() => setView("results")}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-xl border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900/50">
      <h2 className="text-xl font-semibold tracking-tight">
        Practice complete
      </h2>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryStat label="Cards practiced" value={String(cardsPracticed)} />
        {newCardsPracticed > 0 ? (
          <SummaryStat label="New" value={String(newCardsPracticed)} />
        ) : null}
        {reviewCardsPracticed > 0 ? (
          <SummaryStat label="Reviews" value={String(reviewCardsPracticed)} />
        ) : null}
        {accuracy !== null ? (
          <SummaryStat label="Accuracy" value={`${accuracy}%`} />
        ) : null}
        <SummaryStat label="Time on task" value={`${elapsedMin}m`} />
      </dl>

      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Some words will come back later. Next, you&apos;ll see them again in
        context.
      </p>

      <Link href="/reading" className="app-button self-start">
        Go to reading
      </Link>

      {canExtend ? (
        <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
          <button
            type="button"
            className="text-sm text-zinc-600 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            onClick={() => setView("chooser")}
          >
            Do more flashcards
          </button>
        </div>
      ) : onLoadMore ? (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          No more flashcards are available right now.
        </p>
      ) : null}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-white px-3 py-2.5 dark:bg-zinc-800/60">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </dd>
    </div>
  );
}
