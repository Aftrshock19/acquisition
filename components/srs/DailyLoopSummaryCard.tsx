import Link from "next/link";
import type { ReactNode } from "react";
import { DailyLoopSummaryBlocks } from "@/components/srs/DailyLoopSummaryBlocks";
import type { DailyLoopSummary } from "@/lib/loop/dailySummary";

export function DailyLoopSummaryCard({
  summary,
  children,
}: {
  summary: DailyLoopSummary;
  children?: ReactNode;
}) {
  return (
    <div className="app-card flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">All done for today</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          Today&apos;s loop is complete.
        </p>
      </div>

      <DailyLoopSummaryBlocks summary={summary} />

      {children}

      <p className="border-t border-zinc-200 pt-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        Come back tomorrow or check your{" "}
        <Link
          href="/progress"
          className="font-medium text-zinc-900 underline dark:text-zinc-100"
        >
          progress
        </Link>
        .
      </p>
    </div>
  );
}
