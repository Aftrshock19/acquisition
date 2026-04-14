import Link from "next/link";
import { getAppSessionDate } from "@/lib/analytics/date";
import type { CalendarDayMetrics, CalendarWeekSummary } from "@/lib/progress/calendar";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function WeeklyProgressCard({ week }: { week: CalendarWeekSummary }) {
  const today = getAppSessionDate();

  return (
    <Link
      href="/progress"
      aria-label="Tap to view full calendar"
      className="app-link-card flex flex-col gap-4 p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            This week
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Tap to view full calendar
          </p>
        </div>
        <span
          aria-hidden
          className="text-zinc-400 transition group-hover:translate-x-0.5 dark:text-zinc-500"
        >
          →
        </span>
      </div>

      <ul className="grid grid-cols-7 gap-1.5" role="list">
        {week.days.map((day, index) => (
          <WeekCell
            key={day.date}
            day={day}
            label={WEEKDAY_LABELS[index] ?? ""}
            isToday={day.date === today}
          />
        ))}
      </ul>
    </Link>
  );
}

function WeekCell({
  day,
  label,
  isToday,
}: {
  day: CalendarDayMetrics;
  label: string;
  isToday: boolean;
}) {
  return (
    <li className="flex flex-col items-center gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span
        aria-label={`${label}: ${day.status}`}
        className={[
          "flex h-9 w-full items-center justify-center rounded-xl text-xs font-medium transition",
          statusClasses(day.status),
          isToday ? "ring-2 ring-offset-1 ring-zinc-900/70 dark:ring-zinc-100/70 ring-offset-transparent" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {Number(day.date.slice(8, 10))}
      </span>
    </li>
  );
}

function statusClasses(status: CalendarDayMetrics["status"]) {
  if (status === "completed") {
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100";
  }
  if (status === "partial") {
    return "bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100";
  }
  return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400";
}
