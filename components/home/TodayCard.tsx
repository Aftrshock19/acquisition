import Link from "next/link";
import type { CalendarDayStatus } from "@/lib/progress/calendar";

type Props = {
  status: CalendarDayStatus;
};

export function TodayCard({ status }: Props) {
  const { eyebrow, heading, supporting, cta } = copyFor(status);

  return (
    <section
      aria-labelledby="today-card-heading"
      className="app-card-strong flex flex-col gap-5 p-6 sm:p-7"
    >
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
          {eyebrow}
        </p>
        <h2
          id="today-card-heading"
          className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-3xl"
        >
          {heading}
        </h2>
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">
          {supporting}
        </p>
      </div>

      <Link
        href="/today"
        className="app-button self-start px-5 py-3 text-base"
        aria-label={cta.ariaLabel}
      >
        {cta.label}
      </Link>
    </section>
  );
}

function copyFor(status: CalendarDayStatus) {
  if (status === "completed") {
    return {
      eyebrow: "Today",
      heading: "Done for today",
      supporting: "You've finished today's loop. Come back tomorrow.",
      cta: { label: "Review today", ariaLabel: "Open today to review your session" },
    };
  }
  if (status === "partial") {
    return {
      eyebrow: "Today",
      heading: "You've started today",
      supporting: "Pick up where you left off and finish the loop.",
      cta: { label: "Continue today", ariaLabel: "Continue today's session" },
    };
  }
  return {
    eyebrow: "Today",
    heading: "Ready for today",
    supporting: "A short daily loop. Flashcards, then reading, then listening.",
    cta: { label: "Start today", ariaLabel: "Start today's session" },
  };
}
