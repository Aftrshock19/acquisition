import Link from "next/link";
import type { ReadingRecommendation } from "@/lib/reading/recommendation";

type Props = {
  recommendation: ReadingRecommendation;
};

const MODE_LABELS: Record<string, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
  very_long: "Very long",
};

export function RecommendedReadingCard({ recommendation }: Props) {
  const { kind, passage, reason } = recommendation;
  const isContinue = kind === "continue";

  return (
    <section className="app-card-strong flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          {isContinue ? "Continue reading" : "Recommended for you"}
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
        {isContinue
          ? "You started this passage — pick up where you left off."
          : `A ${reason.toLowerCase()} matched to your current level.`}
      </p>

      <Link
        href={`/reader/${passage.id}`}
        className="app-button self-start"
      >
        {isContinue ? "Continue" : "Read now"}
      </Link>
    </section>
  );
}
