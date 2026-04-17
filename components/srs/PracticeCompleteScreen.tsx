"use client";

import Link from "next/link";
import { useState } from "react";
import { FlashcardAmountChooser } from "@/components/srs/FlashcardAmountChooser";

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

  const elapsedMin = Math.max(1, Math.round(timeOnTaskMs / 60_000));
  const allExhausted = reviewsExhausted && newWordsExhausted;
  const canExtend = Boolean(onLoadMore) && !allExhausted;

  if (view === "chooser") {
    return (
      <FlashcardAmountChooser
        loadingMore={loadingMore}
        onPick={(n) => {
          onLoadMore?.(n);
          setView("results");
        }}
        onUnlimited={
          onStartUnlimited
            ? () => {
                onStartUnlimited();
                setView("results");
              }
            : undefined
        }
        onCancel={() => setView("results")}
      />
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
