"use client";

import Link from "next/link";
import { formatSessionDateLabel } from "@/lib/analytics/date";
import type { CalendarDayMetrics } from "@/lib/progress/calendar";

type Props = {
  day: CalendarDayMetrics | null;
  todayDate?: string;
};

export function ProgressDayDetail({ day, todayDate }: Props) {
  if (!day) {
    return (
      <section aria-live="polite" className="app-card flex flex-col gap-2 p-5">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Select a day to see its details.
        </p>
      </section>
    );
  }

  const isToday = todayDate !== undefined && day.date === todayDate;

  return (
    <section
      aria-live="polite"
      aria-label={`Details for ${day.date}`}
      className="app-card flex flex-col gap-4 p-5"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            {isToday ? "Today" : "Selected day"}
          </p>
          <h3 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {formatSessionDateLabel(day.date)}
          </h3>
        </div>
        <StatusPill status={day.status} />
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <DetailRow
          label="Flashcards done"
          value={`${day.flashcardsDone}${day.flashcardsAssigned ? ` / ${day.flashcardsAssigned}` : ""}`}
        />
        <DetailRow label="Accuracy" value={formatPercent(day.flashcardAccuracy)} />
        <DetailRow label="New words" value={String(day.newWords)} />
        <DetailRow label="Reviews completed" value={String(day.reviewsDone)} />
        <DetailRow label="Saved words" value={String(day.savedWords)} />
        <DetailRow label="Total learning time" value={`${day.timeOnTaskMinutes}m`} />
        <DetailRow label="Reading completed" value={day.readingCompleted ? "Yes" : "No"} />
        <DetailRow label="Listening completed" value={day.listeningCompleted ? "Yes" : "No"} />
        <DetailRow label="Retries" value={String(day.retryCount)} />
      </dl>

      {isToday && day.status !== "completed" ? (
        <Link href="/today" className="app-button self-start">
          {day.status === "partial" ? "Continue today" : "Start today"}
        </Link>
      ) : null}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-zinc-50 px-3 py-2.5 dark:bg-zinc-900/60">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: CalendarDayMetrics["status"] }) {
  const label =
    status === "completed"
      ? "Completed"
      : status === "partial"
        ? "Some activity"
        : "No activity";
  const classes =
    status === "completed"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
      : status === "partial"
        ? "bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100"
        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300";
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${classes}`}>{label}</span>;
}

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}
