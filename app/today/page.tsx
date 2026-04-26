import { Home as HomeIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTodayFlashcards, skipFlashcardsToReading } from "@/app/actions/srs";
import { ExtendFlashcardsPanel } from "@/components/srs/ExtendFlashcardsPanel";
import { PracticeCompleteScreen } from "@/components/srs/PracticeCompleteScreen";
import { TodaySession } from "@/components/srs/TodaySession";
import { getPlacementBannerState } from "@/lib/placement/status";
import {
  shouldRedirectToIntro,
  shouldRedirectToPlacement,
} from "@/lib/onboarding/state";
import type { DailySessionRow } from "@/lib/srs/types";

function computeDailySessionElapsedMs(session: DailySessionRow) {
  const start = session.started_at ? Date.parse(session.started_at) : NaN;
  const end = session.last_active_at ? Date.parse(session.last_active_at) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return end - start;
}

export default async function TodayPage() {
  if (await shouldRedirectToIntro()) {
    redirect("/onboarding");
  }
  if (await shouldRedirectToPlacement()) {
    redirect("/placement");
  }
  const todayShellClassName = "app-shell";
  const [result, placementBanner] = await Promise.all([
    getTodayFlashcards("es"),
    getPlacementBannerState(),
  ]);
  const session = result.ok
    ? result.session
    : {
        dueReviews: result.session?.dueReviews ?? [],
        newWords: result.session?.newWords ?? [],
        configMissing: result.configMissing,
        signedIn: result.signedIn,
        error: result.error,
      };
  const effectiveSettings = result.effectiveSettings;
  const dailySession = result.dailySession ?? null;
  const hasCards = session.dueReviews.length > 0 || session.newWords.length > 0;

  // Daily-loop completion lives at /done, not on the Vocabulary page. Once
  // the loop is finished for the day, route users there so the heading and
  // shell reflect "whole loop done" rather than a vocab tab.
  if (dailySession?.stage === "completed") {
    redirect("/done");
  }
  const enabledTypeCount = Object.values(effectiveSettings.enabledTypes).filter(
    Boolean,
  ).length;

  if (!hasCards) {
    console.log("[today-page:!hasCards]", {
      hasCards,
      effectiveDailyLimit: effectiveSettings.dailyLimit,
      manualTargetMode: effectiveSettings.manualTargetMode,
      dailySession: dailySession
        ? {
            id: dailySession.id,
            stage: dailySession.stage,
            flashcard_completed_count: dailySession.flashcard_completed_count,
            flashcard_new_completed_count:
              dailySession.flashcard_new_completed_count,
            flashcard_review_completed_count:
              dailySession.flashcard_review_completed_count,
            flashcard_retry_count: dailySession.flashcard_retry_count,
            assigned_flashcard_count: dailySession.assigned_flashcard_count,
            reading_done: dailySession.reading_done,
            listening_done: dailySession.listening_done,
          }
        : null,
      targetMetComparison: dailySession
        ? {
            completed: dailySession.flashcard_completed_count,
            limit: effectiveSettings.dailyLimit,
            completedGteLimit:
              dailySession.flashcard_completed_count >=
              effectiveSettings.dailyLimit,
          }
        : null,
    });
  }

  if (session.configMissing) {
    return (
      <main className={todayShellClassName}>
        <section className="app-hero">
          <h1 className="app-title">Vocabulary</h1>
        </section>
        <div className="app-card-strong flex flex-col gap-4 border-amber-200 bg-amber-50/90 p-8 dark:border-amber-900/50 dark:bg-amber-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-amber-900 dark:text-amber-100">
            Supabase not configured
          </h2>
          <p className="text-amber-800 dark:text-amber-200">
            Copy{" "}
            <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">
              .env.example
            </code>{" "}
            to{" "}
            <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">
              .env.local
            </code>{" "}
            and set{" "}
            <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">
              NEXT_PUBLIC_SUPABASE_URL
            </code>{" "}
            and{" "}
            <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">
              NEXT_PUBLIC_SUPABASE_ANON_KEY
            </code>{" "}
            from your{" "}
            <a
              href="https://supabase.com/dashboard/project/_/settings/api"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              Supabase project API settings
            </a>
            . Restart the dev server after changing env.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={todayShellClassName}>
      <section className="app-hero flex flex-row items-center gap-3">
        <Link href="/" aria-label="Home" className="app-icon-button shrink-0">
          <HomeIcon aria-hidden="true" className="h-5 w-5" />
        </Link>
        <h1 className="app-title">Vocabulary</h1>
      </section>
      {placementBanner.show ? (
        <div className="app-card flex flex-col gap-3 border-blue-200 bg-blue-50/70 p-6 dark:border-blue-900/50 dark:bg-blue-950/20 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {placementBanner.hasActiveRun
                ? "Continue your placement check"
                : "Find your starting point"}
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              About 3 minutes. Helps us pick the right words and texts for you.
            </p>
          </div>
          <Link
            href="/placement"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            {placementBanner.hasActiveRun ? "Resume" : "Start"}
          </Link>
        </div>
      ) : null}
      {session.error ? (
        <div className="app-card-strong flex flex-col gap-4 border-red-200 bg-red-50/90 p-8 dark:border-red-900/50 dark:bg-red-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-red-900 dark:text-red-100">
            Error loading words
          </h2>
          <p className="text-red-800 dark:text-red-200">{session.error}</p>
        </div>
      ) : session.signedIn && enabledTypeCount === 0 ? (
        <div className="app-card flex flex-col gap-4 p-8">
          <h2 className="text-xl font-semibold tracking-tight">
            No flashcard types enabled
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            Your settings currently disable all flashcard types. Enable at least
            one type in{" "}
            <Link
              href="/settings"
              className="font-medium text-zinc-900 underline dark:text-zinc-100"
            >
              Settings
            </Link>
            .
          </p>
        </div>
      ) : !session.signedIn ? (
        <div className="app-card flex flex-col gap-4 p-8">
          <h2 className="text-xl font-semibold tracking-tight">
            Sign in to see your reviews
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            Daily reviews and new words are available after you{" "}
            <Link
              href="/login"
              className="font-medium text-zinc-900 underline dark:text-zinc-100"
            >
              sign in
            </Link>
            .
          </p>
        </div>
      ) : !hasCards ? (
        dailySession?.stage === "reading" ? (
          <div className="app-card flex flex-col gap-4 p-8">
            <h2 className="text-xl font-semibold tracking-tight">
              Reading is next
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              Flashcard practice is done. Read one short text, then move on to the matched audio.
            </p>
            <Link
              href={
                dailySession.reading_text_id
                  ? `/reader/${dailySession.reading_text_id}`
                  : "/reading"
              }
              className="app-button self-start"
            >
              Continue to reading
            </Link>
            <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
              <ExtendFlashcardsPanel />
            </div>
          </div>
        ) : dailySession?.stage === "listening" ? (
          <div className="app-card flex flex-col gap-4 p-8">
            <h2 className="text-xl font-semibold tracking-tight">
              Listening is next
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              Reading is logged. Finish with one calm listening pass and you are done for today.
            </p>
            <Link
              href={
                dailySession.listening_asset_id
                  ? `/listening/${dailySession.listening_asset_id}`
                  : "/listening"
              }
              className="app-button self-start"
            >
              Continue to listening
            </Link>
          </div>
        ) : dailySession &&
          dailySession.flashcard_completed_count >=
            effectiveSettings.dailyLimit ? (
          <PracticeCompleteScreen
            cardsPracticed={dailySession.flashcard_completed_count}
            newCardsPracticed={dailySession.flashcard_new_completed_count}
            reviewCardsPracticed={dailySession.flashcard_review_completed_count}
            accuracy={null}
            timeOnTaskMs={computeDailySessionElapsedMs(dailySession)}
          />
        ) : dailySession &&
          dailySession.stage === "flashcards" &&
          dailySession.flashcard_completed_count > 0 ? (
          <div className="app-card flex flex-col gap-4 p-8">
            <h2 className="text-xl font-semibold tracking-tight">
              No more words available
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              No more words available near your level right now. You&apos;ve practiced{" "}
              {dailySession.flashcard_completed_count} cards today.
            </p>
            <form action={skipFlashcardsToReading}>
              <button type="submit" className="app-button self-start">
                Continue to reading
              </button>
            </form>
          </div>
        ) : dailySession ? (
          <div className="app-card flex flex-col gap-4 p-8">
            <h2 className="text-xl font-semibold tracking-tight">
              Target reached
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              You&apos;ve met your flashcard target for today. Come back tomorrow for your next session, or check your{" "}
              <Link
                href="/progress"
                className="font-medium text-zinc-900 underline dark:text-zinc-100"
              >
                progress
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="app-card flex flex-col gap-4 p-8">
            <h2 className="text-xl font-semibold tracking-tight">
              All caught up
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              No reviews or new words are scheduled right now. Check back tomorrow or view your{" "}
              <Link
                href="/progress"
                className="font-medium text-zinc-900 underline dark:text-zinc-100"
              >
                progress
              </Link>
              .
            </p>
          </div>
        )
      ) : (
        <TodaySession
          enabledTypes={effectiveSettings.enabledTypes}
          mcqQuestionFormats={effectiveSettings.mcqQuestionFormats}
          session={session}
          initialSavedWordIds={result.savedWords.wordIds}
          initialSavedLemmas={result.savedWords.lemmas}
          dailyLimit={effectiveSettings.dailyLimit}
          manualTargetMode={effectiveSettings.manualTargetMode}
          autoAdvanceCorrect={effectiveSettings.autoAdvanceCorrect}
          showPosHint={effectiveSettings.showPosHint}
          hideTranslationSentences={effectiveSettings.hideTranslationSentences}
          initialDailySession={dailySession}
          workloadPolicy={result.ok ? result.workloadPolicy : undefined}
        />
      )}
    </main>
  );
}
