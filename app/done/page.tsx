import { Home as HomeIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DailyLoopSummaryCard } from "@/components/srs/DailyLoopSummaryCard";
import { ExtendFlashcardsPanel } from "@/components/srs/ExtendFlashcardsPanel";
import { getTodayDailySessionRow } from "@/lib/loop/dailySessions";
import { loadDailyLoopSummary } from "@/lib/loop/dailySummary";
import { getSupabaseServerContextFast } from "@/lib/supabase/server";

export default async function DonePage() {
  const { supabase, user } = await getSupabaseServerContextFast();
  if (!supabase || !user) {
    redirect("/login");
  }

  const dailySession = await getTodayDailySessionRow(supabase, user.id);
  if (!dailySession || dailySession.stage !== "completed") {
    redirect("/today");
  }

  const summary = await loadDailyLoopSummary(supabase, dailySession);

  return (
    <main className="app-shell">
      <section className="app-hero flex flex-row items-center gap-3">
        <Link href="/" aria-label="Home" className="app-icon-button shrink-0">
          <HomeIcon aria-hidden="true" className="h-5 w-5" />
        </Link>
        <h1 className="app-title">Daily loop complete</h1>
      </section>
      <DailyLoopSummaryCard summary={summary}>
        <div className="flex flex-col gap-4">
          <ExtendFlashcardsPanel />
          <div className="flex flex-row flex-wrap gap-6">
            <Link
              href="/reading"
              className="text-sm text-zinc-600 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Read another passage
            </Link>
            <Link
              href="/listening"
              className="text-sm text-zinc-600 underline hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Listen to another track
            </Link>
          </div>
        </div>
      </DailyLoopSummaryCard>
    </main>
  );
}
