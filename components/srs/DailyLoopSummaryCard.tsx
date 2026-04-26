import Link from "next/link";
import type {
  DailyLoopSummary,
  FlashcardSummary,
  ListeningSummary,
  ReadingSummary,
} from "@/lib/loop/dailySummary";

const numberFormatter = new Intl.NumberFormat("en-GB");

export function DailyLoopSummaryCard({ summary }: { summary: DailyLoopSummary }) {
  return (
    <div className="app-card flex flex-col gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">All done for today</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          Today&apos;s loop is complete.
        </p>
      </div>

      <FlashcardsBlock summary={summary.flashcards} />
      <ReadingBlock summary={summary.reading} />
      <ListeningBlock summary={summary.listening} />

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

// ---------------------------------------------------------------------------

function FlashcardsBlock({ summary }: { summary: FlashcardSummary }) {
  const primary =
    summary.cardsPracticed === 1
      ? "1 card practiced"
      : `${summary.cardsPracticed} cards practiced`;

  const clauses: string[] = [];
  if (summary.newCount > 0) clauses.push(`${summary.newCount} new`);
  if (summary.reviewCount > 0) clauses.push(`${summary.reviewCount} reviews`);
  if (summary.showAccuracy && summary.accuracyPercent !== null) {
    clauses.push(`${summary.accuracyPercent}% accuracy`);
  }

  return (
    <section className="border-t border-zinc-200 pt-5 dark:border-zinc-800">
      <SectionLabel>Flashcards</SectionLabel>
      <p className="mt-1 text-zinc-900 dark:text-zinc-100">{primary}</p>
      {clauses.length > 0 ? (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {clauses.join(" · ")}
        </p>
      ) : null}
      {summary.showAttemptsLine ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          {summary.cardsPracticed} unique cards · {summary.attempts} total attempts
        </p>
      ) : null}
    </section>
  );
}

function ReadingBlock({ summary }: { summary: ReadingSummary }) {
  if (!summary.completed) return null;

  const hasStats =
    summary.completedCount > 0 &&
    (summary.totalWords !== null || summary.totalMinutes !== null);

  return (
    <section className="border-t border-zinc-200 pt-5 dark:border-zinc-800">
      <SectionLabel>Reading</SectionLabel>
      {hasStats ? (
        <p className="mt-1 text-zinc-900 dark:text-zinc-100">
          {formatReadingPrimary(summary)}
        </p>
      ) : (
        <p className="mt-1 text-zinc-900 dark:text-zinc-100">Reading completed</p>
      )}
      {summary.displayLabel ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Reading level: {summary.displayLabel}
        </p>
      ) : null}
    </section>
  );
}

function ListeningBlock({ summary }: { summary: ListeningSummary }) {
  if (!summary.completed) return null;

  const hasStats = summary.completedCount > 0 && summary.totalMinutes !== null;

  return (
    <section className="border-t border-zinc-200 pt-5 dark:border-zinc-800">
      <SectionLabel>Listening</SectionLabel>
      {hasStats ? (
        <p className="mt-1 text-zinc-900 dark:text-zinc-100">
          {formatListeningPrimary(summary)}
        </p>
      ) : (
        <p className="mt-1 text-zinc-900 dark:text-zinc-100">Listening completed</p>
      )}
      {summary.displayLabel ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Listening level: {summary.displayLabel}
        </p>
      ) : null}
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
      {children}
    </p>
  );
}

function formatReadingPrimary(summary: ReadingSummary): string {
  const passageWord = summary.completedCount === 1 ? "passage" : "passages";
  const parts: string[] = [`${summary.completedCount} ${passageWord}`];
  if (summary.totalWords !== null) {
    parts.push(`${numberFormatter.format(summary.totalWords)} words`);
  }
  if (summary.totalMinutes !== null) {
    parts.push(`${summary.totalMinutes} min`);
  }
  return parts.join(" · ");
}

function formatListeningPrimary(summary: ListeningSummary): string {
  const trackWord = summary.completedCount === 1 ? "track" : "tracks";
  const parts: string[] = [`${summary.completedCount} ${trackWord}`];
  if (summary.totalMinutes !== null) {
    parts.push(`${summary.totalMinutes} min`);
  }
  return parts.join(" · ");
}
