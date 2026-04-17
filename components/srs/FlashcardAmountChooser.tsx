"use client";

import { useState } from "react";

type Props = {
  loadingMore?: boolean;
  onPick: (count: number) => void;
  onUnlimited?: () => void;
  onCancel: () => void;
};

export function FlashcardAmountChooser({
  loadingMore = false,
  onPick,
  onUnlimited,
  onCancel,
}: Props) {
  const [customAmount, setCustomAmount] = useState("");

  function handleCustomSubmit() {
    const n = parseInt(customAmount, 10);
    if (Number.isFinite(n) && n > 0) {
      onPick(Math.min(n, 200));
      setCustomAmount("");
    }
  }

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
            onClick={() => onPick(n)}
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
      {onUnlimited ? (
        <button
          type="button"
          className="self-start text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          disabled={loadingMore}
          onClick={onUnlimited}
        >
          Keep going until I stop
        </button>
      ) : null}
      <button
        type="button"
        className="self-start text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
