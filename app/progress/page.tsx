import Link from "next/link";
import { BackButton } from "@/components/BackButton";
import { ProgressCalendar } from "@/components/progress/ProgressCalendar";
import { getAppSessionDate } from "@/lib/analytics/date";
import {
  getCalendarMonthSummary,
  parseYearMonth,
  shiftMonth,
  type CalendarMonthSummary,
} from "@/lib/progress/calendar";
import {
  loadCurrentLearningRange,
  type LearningRangeViewModel,
} from "@/lib/progress/learningRange";
import type { PassageMode } from "@/lib/recommendation/substages";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProgressPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = (await searchParams) ?? {};
  const { year, month } = parseYearMonth(
    getSearchParamValue(resolved.year),
    getSearchParamValue(resolved.month),
  );
  const todayDate = getAppSessionDate();

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return (
      <Shell>
        <p className="app-subtitle">Progress is unavailable until Supabase is configured.</p>
      </Shell>
    );
  }

  const { user, error: authError } = await getSupabaseUser(supabase);
  if (authError) {
    return (
      <Shell>
        <section className="app-card-strong flex flex-col gap-3 border-red-200 bg-red-50/90 p-8 dark:border-red-900/50 dark:bg-red-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-red-900 dark:text-red-100">
            Could not load progress
          </h2>
          <p className="text-sm leading-6 text-red-800 dark:text-red-200">{authError}</p>
        </section>
      </Shell>
    );
  }

  if (!user) {
    return (
      <Shell>
        <section className="app-card flex flex-col gap-3 p-8">
          <p className="app-subtitle">Sign in to view your progress calendar.</p>
          <Link href="/login" className="app-button self-start">
            Sign in
          </Link>
        </section>
      </Shell>
    );
  }

  const [summary, learningRange] = await Promise.all([
    getCalendarMonthSummary(supabase, user.id, year, month),
    loadCurrentLearningRange(supabase, user.id),
  ]);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  return (
    <Shell>
      <MonthlySummary summary={summary} />

      <LearningRangeSection data={learningRange} />

      <ProgressCalendar
        year={year}
        month={month}
        days={summary.days}
        prevHref={`/progress?year=${prev.year}&month=${prev.month}`}
        nextHref={`/progress?year=${next.year}&month=${next.month}`}
        todayDate={todayDate}
      />

      {summary.activeDays === 0 ? (
        <section className="app-card flex flex-col gap-2 p-5">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No activity recorded this month yet. Come back after a session to see it here.
          </p>
        </section>
      ) : null}

      <ExportSection year={year} month={month} startDate={summary.startDate} endDate={summary.endDate} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-shell">
      <BackButton />
      <section className="app-hero">
        <h1 className="app-title">Progress</h1>
        <p className="app-subtitle">A calm learning logbook of your daily practice.</p>
      </section>
      {children}
    </main>
  );
}

function MonthlySummary({ summary }: { summary: CalendarMonthSummary }) {
  return (
    <section aria-label="Monthly summary" className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <PrimaryTile label="Active days" value={String(summary.activeDays)} />
        <PrimaryTile label="Completed days" value={String(summary.completedDays)} />
        <PrimaryTile label="Total learning time" value={formatMinutes(summary.totalMinutes)} />
      </div>

      <dl className="flex flex-wrap gap-x-5 gap-y-2 px-1 text-xs text-zinc-500 dark:text-zinc-400">
        <SecondaryChip label="Completion rate" value={formatPercent(summary.completionRate)} />
        <SecondaryChip label="Average accuracy" value={formatPercent(summary.averageAccuracy)} />
        <SecondaryChip label="Total flashcards" value={String(summary.totalFlashcards)} />
      </dl>
    </section>
  );
}

const PASSAGE_MODE_LABEL: Record<PassageMode, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
  very_long: "Very long",
};

function LearningRangeSection({ data }: { data: LearningRangeViewModel }) {
  return (
    <section
      aria-label="Current learning range"
      className="flex flex-col gap-3"
    >
      <article className="app-card-strong flex flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
              Current learning range
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl">
              {data.label} content range
            </h2>
          </div>
          <span className="rounded-full border border-zinc-200 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
            {data.sourceLabel}
          </span>
        </div>

        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Vocabulary frontier: {data.frontierDisplay}
        </p>

        {data.hasPlacement ? (
          <div className="flex flex-col gap-2">
            <div
              className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
              role="progressbar"
              aria-label={`Progress within ${data.label} range`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={data.progressWithinRangePercent}
            >
              <div
                className="h-full rounded-full bg-zinc-900 transition-[width] duration-500 ease-out dark:bg-zinc-100"
                style={{ width: `${data.progressWithinRangePercent}%` }}
              />
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              {data.isTopOfBank ? (
                <span>Top of the current word bank</span>
              ) : data.frontierRank != null ? (
                <span>
                  {data.frontierRank.toLocaleString("en-US")} /{" "}
                  {data.rankMax.toLocaleString("en-US")} words in {data.label}
                </span>
              ) : null}
              {!data.isTopOfBank &&
              data.wordsUntilNextRange != null &&
              data.nextLabel != null ? (
                <span>
                  {data.wordsUntilNextRange.toLocaleString("en-US")} words until{" "}
                  {data.nextLabel}
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Placement not set yet — showing the absolute beginner range.
          </p>
        )}
      </article>

      <div className="grid gap-3 sm:grid-cols-3">
        <article className="app-card flex flex-col gap-1 p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Reading difficulty
          </p>
          <p className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {data.label}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            From your vocabulary frontier
          </p>
        </article>
        <article className="app-card flex flex-col gap-1 p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Passage length
          </p>
          <p className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {PASSAGE_MODE_LABEL[data.passageMode]}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Today&apos;s flashcard target: {data.targetCards} cards
          </p>
        </article>
        <article className="app-card flex flex-col gap-1 p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Listening
          </p>
          <p className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Matched after reading
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            In your daily loop
          </p>
        </article>
      </div>

      <p className="px-1 text-xs leading-5 text-zinc-500 dark:text-zinc-500">
        {data.helperCopy}
      </p>
    </section>
  );
}

function PrimaryTile({ label, value }: { label: string; value: string }) {
  return (
    <article className="app-card flex flex-col gap-1 p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {value}
      </p>
    </article>
  );
}

function SecondaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className="font-medium text-zinc-700 dark:text-zinc-300">{value}</dd>
    </div>
  );
}

function ExportSection({
  year,
  month,
  startDate,
  endDate,
}: {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
}) {
  const range = { from: startDate, to: endDate };
  return (
    <details className="app-card-muted group rounded-2xl border border-zinc-200/70 p-5 dark:border-zinc-800/70">
      <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-400">
        <span>
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-500">
            Research tools ·{" "}
          </span>
          Export {formatMonthLabel(year, month)}
        </span>
        <span aria-hidden className="text-zinc-400 transition group-open:rotate-90">
          ›
        </span>
      </summary>

      <div className="mt-4 flex flex-col gap-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Downloads use the same analytics source as the calendar above.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={buildExportHref("all", "json", range)} className="app-button-secondary text-xs">
            JSON bundle
          </Link>
          <Link href={buildExportHref("daily_aggregates", "csv", range)} className="app-button-secondary text-xs">
            Daily aggregates CSV
          </Link>
          <Link href={buildExportHref("sessions", "csv", range)} className="app-button-secondary text-xs">
            Sessions CSV
          </Link>
          <Link href={buildExportHref("review_events", "csv", range)} className="app-button-secondary text-xs">
            Review events CSV
          </Link>
          <Link href={buildExportHref("reading_events", "csv", range)} className="app-button-secondary text-xs">
            Reading CSV
          </Link>
          <Link href={buildExportHref("listening_events", "csv", range)} className="app-button-secondary text-xs">
            Listening CSV
          </Link>
          <Link href={buildExportHref("saved_words", "csv", range)} className="app-button-secondary text-xs">
            Saved words CSV
          </Link>
        </div>
        <Link
          href={`/progress/debug?from=${range.from}&to=${range.to}`}
          className="text-xs font-medium text-zinc-700 underline underline-offset-2 dark:text-zinc-300"
        >
          Open consistency checks
        </Link>
      </div>
    </details>
  );
}

function buildExportHref(
  dataset: string,
  format: "json" | "csv",
  range: { from: string; to: string },
) {
  return `/api/progress/export?dataset=${dataset}&format=${format}&from=${range.from}&to=${range.to}`;
}

function formatMonthLabel(year: number, month: number) {
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${names[month - 1]} ${year}`;
}

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatMinutes(total: number) {
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function getSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
