import Link from "next/link";
import { redirect } from "next/navigation";
import { TodayCard } from "@/components/home/TodayCard";
import { WeeklyProgressCard } from "@/components/progress/WeeklyProgressCard";
import { getAppSessionDate } from "@/lib/analytics/date";
import { getCalendarWeekSummary, type CalendarDayStatus } from "@/lib/progress/calendar";
import { getUserSettings } from "@/lib/settings/getUserSettings";
import { shouldRedirectToIntro } from "@/lib/onboarding/state";
import { getSupabaseServerContextFast } from "@/lib/supabase/server";

export default async function HomePage() {
  const { signedIn } = await getUserSettings();
  if (signedIn && (await shouldRedirectToIntro())) {
    redirect("/onboarding");
  }

  const week = signedIn ? await loadCurrentWeek() : null;
  const todayStatus: CalendarDayStatus = resolveTodayStatus(week);

  return (
    <main className="app-shell">
      <section className="flex items-start justify-between gap-4">
        <div className="app-hero">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
            Daily language system
          </p>
          <h1 className="app-title">Acquisition</h1>
          <p className="app-subtitle">Your daily Spanish practice.</p>
        </div>
      </section>

      {signedIn ? (
        <>
          <TodayCard status={todayStatus} />
          {week ? <WeeklyProgressCard week={week} /> : null}

          <nav
            aria-label="Account"
            className="flex flex-wrap items-center justify-end gap-2 pt-1 text-sm"
          >
            <Link
              href="/profile"
              className="text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
            >
              Profile
            </Link>
            <span aria-hidden className="text-zinc-300 dark:text-zinc-700">·</span>
            <Link
              href="/settings"
              className="text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
            >
              Settings
            </Link>
          </nav>
        </>
      ) : (
        <Link
          href="/login"
          className="flex min-h-32 items-center justify-center rounded-2xl bg-zinc-900 px-8 py-6 text-center text-xl font-semibold text-white shadow-lg shadow-zinc-900/15 transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Sign in
        </Link>
      )}
    </main>
  );
}

function resolveTodayStatus(
  week: Awaited<ReturnType<typeof getCalendarWeekSummary>> | null,
): CalendarDayStatus {
  if (!week) return "empty";
  const today = getAppSessionDate();
  return week.days.find((d) => d.date === today)?.status ?? "empty";
}

async function loadCurrentWeek() {
  const { supabase, user } = await getSupabaseServerContextFast();
  if (!supabase || !user) return null;
  try {
    return await getCalendarWeekSummary(supabase, user.id);
  } catch (err) {
    console.error("[home] failed to load weekly progress card", err);
    return null;
  }
}
