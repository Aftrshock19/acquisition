"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CalendarDayMetrics } from "@/lib/progress/calendar";
import { ProgressDayDetail } from "./ProgressDayDetail";

const WEEKDAY_HEADINGS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type ProgressCalendarProps = {
  year: number;
  month: number;
  days: CalendarDayMetrics[];
  prevHref: string;
  nextHref: string;
  todayDate: string;
};

export function ProgressCalendar({
  year,
  month,
  days,
  prevHref,
  nextHref,
  todayDate,
}: ProgressCalendarProps) {
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarDayMetrics>();
    for (const d of days) map.set(d.date, d);
    return map;
  }, [days]);

  const initialSelected = useMemo(() => {
    const todayInMonth = days.find((d) => d.date === todayDate);
    if (todayInMonth) return todayInMonth.date;
    const lastActive = [...days].reverse().find((d) => d.usedApp);
    if (lastActive) return lastActive.date;
    return days[0]?.date ?? null;
  }, [days, todayDate]);

  const [selected, setSelected] = useState<string | null>(initialSelected);

  const leadingBlanks = useMemo(() => {
    const first = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00.000Z`);
    const weekday = first.getUTCDay();
    return (weekday + 6) % 7;
  }, [year, month]);

  const selectedDay = selected ? byDate.get(selected) ?? null : null;

  return (
    <section className="app-card-strong flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={prevHref}
          aria-label="Previous month"
          className="app-button-secondary px-3"
          prefetch={false}
        >
          ←
        </Link>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {MONTH_NAMES[month - 1]} {year}
        </h2>
        <Link
          href={nextHref}
          aria-label="Next month"
          className="app-button-secondary px-3"
          prefetch={false}
        >
          →
        </Link>
      </div>

      <ol
        className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
        aria-hidden
      >
        {WEEKDAY_HEADINGS.map((label) => (
          <li key={label} className="py-1">
            {label}
          </li>
        ))}
      </ol>

      <div
        role="grid"
        aria-label={`${MONTH_NAMES[month - 1]} ${year}`}
        className="grid grid-cols-7 gap-1 sm:gap-1.5"
      >
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <div key={`pad-${i}`} aria-hidden className="aspect-square" />
        ))}
        {days.map((day) => (
          <DayCell
            key={day.date}
            day={day}
            isToday={day.date === todayDate}
            isSelected={day.date === selected}
            onSelect={() => setSelected(day.date)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
        <LegendSwatch status="empty" label="No activity" />
        <LegendSwatch status="partial" label="Some activity" />
        <LegendSwatch status="completed" label="Daily loop completed" />
      </div>

      <ProgressDayDetail day={selectedDay} todayDate={todayDate} />
    </section>
  );
}

function DayCell({
  day,
  isToday,
  isSelected,
  onSelect,
}: {
  day: CalendarDayMetrics;
  isToday: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const dayNum = Number(day.date.slice(8, 10));
  return (
    <button
      type="button"
      role="gridcell"
      aria-pressed={isSelected}
      aria-label={`${day.date} — ${describeStatus(day.status)}`}
      onClick={onSelect}
      className={[
        "relative aspect-square min-h-[40px] rounded-xl text-sm font-medium transition",
        "flex flex-col items-center justify-center gap-1",
        statusClasses(day.status),
        isSelected
          ? "ring-2 ring-zinc-900 dark:ring-zinc-100"
          : isToday
            ? "ring-1 ring-zinc-400 dark:ring-zinc-500"
            : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span>{dayNum}</span>
      <StatusDot status={day.status} />
    </button>
  );
}

function StatusDot({ status }: { status: CalendarDayMetrics["status"] }) {
  if (status === "empty") {
    return <span aria-hidden className="h-1 w-1 rounded-full bg-transparent" />;
  }
  return (
    <span
      aria-hidden
      className={[
        "h-1.5 w-1.5 rounded-full",
        status === "completed"
          ? "bg-emerald-600 dark:bg-emerald-300"
          : "bg-amber-500 dark:bg-amber-300",
      ].join(" ")}
    />
  );
}

function LegendSwatch({
  status,
  label,
}: {
  status: CalendarDayMetrics["status"];
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-md ${statusClasses(status)}`} aria-hidden />
      {label}
    </span>
  );
}

function statusClasses(status: CalendarDayMetrics["status"]) {
  if (status === "completed") {
    return "bg-emerald-100 text-emerald-900 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-100 dark:hover:bg-emerald-900/60";
  }
  if (status === "partial") {
    return "bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-100 dark:hover:bg-amber-900/40";
  }
  return "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-400 dark:hover:bg-zinc-800";
}

function describeStatus(status: CalendarDayMetrics["status"]) {
  if (status === "completed") return "daily loop completed";
  if (status === "partial") return "some activity";
  return "no activity";
}
