import Link from "next/link";
import { BackButton } from "@/components/BackButton";
import { clampSessionDateRange, formatSessionDateLabel, getDefaultSessionDateRange } from "@/lib/analytics/date";
import { getUserAnalyticsBundle } from "@/lib/analytics/service";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProgressPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedFrom = getSearchParamValue(resolvedSearchParams.from);
  const requestedTo = getSearchParamValue(resolvedSearchParams.to);
  const range = clampSessionDateRange(requestedFrom, requestedTo, 14);
  const defaultRange = getDefaultSessionDateRange(14);
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Progress</h1>
          <p className="app-subtitle">Session metrics are unavailable until Supabase is configured.</p>
        </section>
      </main>
    );
  }

  const { user, error: authError } = await getSupabaseUser(supabase);

  if (authError) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Progress</h1>
          <p className="app-subtitle">There was a problem loading your metrics.</p>
        </section>

        <section className="app-card-strong flex flex-col gap-3 border-red-200 bg-red-50/90 p-8 dark:border-red-900/50 dark:bg-red-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-red-900 dark:text-red-100">
            Error loading progress
          </h2>
          <p className="text-sm leading-6 text-red-800 dark:text-red-200">
            {authError}
          </p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Progress</h1>
          <p className="app-subtitle">Sign in to view your session metrics and exports.</p>
        </section>

        <section className="app-card flex flex-col gap-3 p-8">
          <Link href="/login" className="app-button self-start">
            Sign in
          </Link>
        </section>
      </main>
    );
  }

  const bundle = await getUserAnalyticsBundle(supabase, user.id, range);
  const today = bundle.today;
  const last7 = bundle.dailyAggregates.slice(-7);
  const last14 = bundle.dailyAggregates.slice(-14);
  const sessionsCompletedLast7 = last7.filter((day) => day.session_completed).length;
  const daysActiveLast14 = last14.filter((day) => day.days_active_flag).length;

  return (
    <main className="app-shell">
      <BackButton />

      <section className="app-hero">
        <h1 className="app-title">Progress</h1>
        <p className="app-subtitle">A plain view of the session data the app will export for analysis.</p>
      </section>

      <section className="app-card-strong flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Range
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {formatSessionDateLabel(range.from)} to {formatSessionDateLabel(range.to)}
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            The cards, totals, and exports below all come from the same derived analytics bundle.
          </p>
        </div>

        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
          <label className="flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-200">
            From
            <input
              type="date"
              name="from"
              defaultValue={range.from}
              className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-200">
            To
            <input
              type="date"
              name="to"
              defaultValue={range.to}
              className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </label>
          <button type="submit" className="app-button self-end">
            Apply
          </button>
          <Link
            href={`/progress?from=${defaultRange.from}&to=${defaultRange.to}`}
            className="app-button-secondary self-end text-center"
          >
            Last 14 days
          </Link>
        </form>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Today session"
          value={today ? formatTodayStatus(today.stage, today.session_completed) : "No session yet"}
          detail={today ? `${today.flashcards_completed} of ${today.flashcards_assigned} flashcards completed.` : "No activity has been recorded for today yet."}
        />
        <MetricCard
          label="Flashcards today"
          value={today ? `${today.flashcards_completed}/${today.flashcards_assigned}` : "0/0"}
          detail={today ? `${today.new_card_main_queue_attempts} new, ${today.review_card_main_queue_attempts} review.` : "No flashcard attempts recorded today."}
        />
        <MetricCard
          label="Accuracy today"
          value={today?.accuracy !== null && today?.accuracy !== undefined ? formatPercent(today.accuracy) : "No attempts"}
          detail="Correct flashcard attempts divided by total attempts today."
        />
        <MetricCard
          label="Logged active time"
          value={today ? formatDuration(today.logged_active_time_seconds) : "0m"}
          detail="Sum of submitted-attempt time, client-recorded reading time, and client-recorded listening time for today."
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Reader today"
          value={formatBoolean(today?.reader_completed ?? false)}
          detail={`Saved words: ${today?.reader_saved_words ?? 0}`}
        />
        <MetricCard
          label="Listening today"
          value={formatBoolean(today?.listening_completed ?? false)}
          detail="Marked complete only when the listening step is saved."
        />
        <MetricCard
          label="Sessions completed"
          value={`${sessionsCompletedLast7} / ${Math.min(7, last7.length)}`}
          detail="Completed sessions across the last 7 tracked days."
        />
        <MetricCard
          label="Days active"
          value={`${daysActiveLast14} / ${Math.min(14, last14.length)}`}
          detail="Days with any recorded study activity across the last 14 tracked days."
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <SummaryCard
          title="Stage totals"
          rows={[
            { label: "Started", value: String(bundle.summary.stage_totals.started) },
            { label: "Flashcards completed", value: String(bundle.summary.stage_totals.flashcards_completed) },
            { label: "Reading completed", value: String(bundle.summary.stage_totals.reading_completed) },
            { label: "Listening completed", value: String(bundle.summary.stage_totals.listening_completed) },
            { label: "Completed", value: String(bundle.summary.stage_totals.completed) },
          ]}
        />
        <SummaryCard
          title="Stage drop-off"
          rows={[
            { label: "Before flashcards complete", value: String(bundle.summary.stage_drop_off.before_flashcards_complete) },
            { label: "Before reading complete", value: String(bundle.summary.stage_drop_off.before_reading_complete) },
            { label: "Before listening complete", value: String(bundle.summary.stage_drop_off.before_listening_complete) },
            { label: "Review correctness (retention proxy)", value: formatPercent(bundle.summary.review_retention_proxy.review_accuracy) },
            { label: "Mean inter-review interval", value: formatHours(bundle.summary.review_retention_proxy.average_delta_hours) },
          ]}
        />
      </section>

      <section className="app-card flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Export
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Dissertation export
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            JSON downloads the full bundle. CSV downloads one dataset at a time with stable columns.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href={buildExportHref("all", "json", range)} className="app-button">
            Download JSON bundle
          </Link>
          <Link href={buildExportHref("daily_aggregates", "csv", range)} className="app-button-secondary">
            Daily aggregates CSV
          </Link>
          <Link href={buildExportHref("sessions", "csv", range)} className="app-button-secondary">
            Sessions CSV
          </Link>
          <Link href={buildExportHref("review_events", "csv", range)} className="app-button-secondary">
            Review events CSV
          </Link>
          <Link href={buildExportHref("reading_events", "csv", range)} className="app-button-secondary">
            Reading CSV
          </Link>
          <Link href={buildExportHref("listening_events", "csv", range)} className="app-button-secondary">
            Listening CSV
          </Link>
          <Link href={buildExportHref("saved_words", "csv", range)} className="app-button-secondary">
            Saved words CSV
          </Link>
        </div>

        <Link
          href={`/progress/debug?from=${range.from}&to=${range.to}`}
          className="text-sm font-medium text-zinc-900 underline dark:text-zinc-100"
        >
          Open consistency checks
        </Link>
      </section>

      <section className="app-card flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Recent days
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Last 7 days
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2 text-sm">
            <thead>
              <tr className="text-left text-zinc-500 dark:text-zinc-400">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Session</th>
                <th className="px-3 py-2 font-medium">Flashcards</th>
                <th className="px-3 py-2 font-medium">Accuracy</th>
                <th className="px-3 py-2 font-medium">Reading</th>
                <th className="px-3 py-2 font-medium">Listening</th>
                <th className="px-3 py-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {last7.map((day) => (
                <tr key={day.session_date} className="rounded-xl bg-zinc-50 text-zinc-900 dark:bg-zinc-900/60 dark:text-zinc-100">
                  <td className="rounded-l-xl px-3 py-3">{formatSessionDateLabel(day.session_date)}</td>
                  <td className="px-3 py-3">{formatTodayStatus(day.stage, day.session_completed)}</td>
                  <td className="px-3 py-3">{day.flashcard_completed_count}/{day.assigned_flashcard_count}</td>
                  <td className="px-3 py-3">{formatPercent(day.flashcard_accuracy)}</td>
                  <td className="px-3 py-3">{formatBoolean(day.reading_completed)}</td>
                  <td className="px-3 py-3">{formatBoolean(day.listening_completed)}</td>
                  <td className="rounded-r-xl px-3 py-3">{formatDuration(day.total_time_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="app-card flex flex-col gap-3 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {value}
      </p>
      <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{detail}</p>
    </article>
  );
}

function SummaryCard({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string }[];
}) {
  return (
    <section className="app-card flex flex-col gap-4 p-5 sm:p-6">
      <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {title}
      </h2>
      <dl className="grid gap-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-900/60">
            <dt className="text-sm text-zinc-600 dark:text-zinc-300">{row.label}</dt>
            <dd className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function buildExportHref(
  dataset: string,
  format: "json" | "csv",
  range: { from: string; to: string },
) {
  return `/api/progress/export?dataset=${dataset}&format=${format}&from=${range.from}&to=${range.to}`;
}

function formatTodayStatus(stage: string | null | undefined, completed: boolean) {
  if (completed) {
    return "Complete";
  }

  if (!stage) {
    return "Not started";
  }

  return stage[0].toUpperCase() + stage.slice(1);
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function formatHours(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "No review data";
  }

  return `${value.toFixed(1)}h`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "No data";
  }

  return `${Math.round(value * 100)}%`;
}

function formatBoolean(value: boolean) {
  return value ? "Yes" : "No";
}

function getSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
