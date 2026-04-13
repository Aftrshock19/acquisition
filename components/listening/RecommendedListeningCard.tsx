import Link from "next/link";
import type { ListeningRecommendation } from "@/lib/listening/recommendation";

type Props = {
  recommendation: ListeningRecommendation;
};

export function RecommendedListeningCard({ recommendation }: Props) {
  const { kind, asset, reason } = recommendation;
  const isContinue = kind === "continue";

  const duration = asset.durationSeconds
    ? asset.durationSeconds < 60
      ? `${Math.round(asset.durationSeconds)}s`
      : `${Math.round(asset.durationSeconds / 60)} min`
    : null;

  return (
    <section className="app-card-strong flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
          {isContinue ? "Continue listening" : "Recommended for you"}
        </p>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {asset.title}
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        {asset.text?.displayLabel ? (
          <span className="rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800">
            {asset.text.displayLabel}
          </span>
        ) : null}
        {duration ? (
          <span className="rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800">
            {duration}
          </span>
        ) : null}
        {asset.text?.passageMode ? (
          <span className="rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800">
            {MODE_LABELS[asset.text.passageMode] ?? asset.text.passageMode}
          </span>
        ) : null}
      </div>

      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {isContinue
          ? "You started this passage pick up where you left off."
          : `A ${reason.toLowerCase()} matched to your current level.`}
      </p>

      <Link href={`/listening/${asset.id}`} className="app-button self-start">
        {isContinue ? "Continue" : "Play now"}
      </Link>
    </section>
  );
}

const MODE_LABELS: Record<string, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
  very_long: "Very long",
};
