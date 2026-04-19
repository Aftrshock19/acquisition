"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { rerollDailyRecommendationAction } from "@/app/actions/recommendation";
import type { ReadingPassageSummary } from "@/lib/reading/types";

type Props = {
  passage: ReadingPassageSummary;
  status: "in_progress" | "completed" | null;
  reason: string;
};

const MODE_LABELS: Record<string, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
  very_long: "Very long",
};

export function RecommendedReadingCard({ passage, status, reason }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rerollError, setRerollError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const isCompleted = status === "completed";

  const onReroll = () => {
    startTransition(async () => {
      setRerollError(null);
      const result = await rerollDailyRecommendationAction("reading");
      if (!result.ok) {
        if (result.error === "no_candidates") {
          setExhausted(true);
          return;
        }
        setRerollError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const stateClasses =
    status === "completed"
      ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
      : status === "in_progress"
        ? "border-blue-400 bg-blue-50/40 dark:border-blue-700 dark:bg-blue-900/20"
        : "";

  return (
    <section className={`app-card-strong flex flex-col gap-4 p-5 sm:p-6 ${stateClasses}`}>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          {isCompleted ? "Today's pick · done" : "Recommended for you"}
        </p>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {passage.title}
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800">
          {passage.displayLabel}
        </span>
        {passage.estimatedMinutes ? (
          <span className="rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800">
            {passage.estimatedMinutes} min
          </span>
        ) : null}
        <span className="rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800">
          {MODE_LABELS[passage.mode] ?? passage.mode}
        </span>
      </div>

      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {isCompleted
          ? "Nicely done. Pick a new one when you're ready."
          : `A ${reason} matched to your current level.`}
      </p>

      {rerollError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {rerollError}
        </p>
      ) : null}

      {isCompleted ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={pending || exhausted}
            className="app-button self-start"
            onClick={onReroll}
          >
            {pending ? "Finding one..." : "Recommend another"}
          </button>
          {exhausted ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Nothing new at your level right now — check back soon.
            </p>
          ) : null}
        </div>
      ) : (
        <Link href={`/reader/${passage.id}`} className="app-button self-start">
          {status === "in_progress" ? "Continue" : "Start"}
        </Link>
      )}
    </section>
  );
}
