import { Home as HomeIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTodayFlashcards } from "@/app/actions/srs";
import { TodaySession } from "@/components/srs/TodaySession";
import { getPlacementBannerState } from "@/lib/placement/status";
import { shouldRedirectToIntro } from "@/lib/onboarding/state";

export default async function TodayPage() {
  if (await shouldRedirectToIntro()) {
    redirect("/onboarding");
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
  const enabledTypeCount = Object.values(effectiveSettings.enabledTypes).filter(
    Boolean,
  ).length;

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
              Flashcards are done. Read one short text, then move on to the matched audio.
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
        ) : (
          <div className="app-card flex flex-col gap-4 p-8">
            <h2 className="text-xl font-semibold tracking-tight">
              All done for today
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              No reviews or new words due. Come back tomorrow or check your{" "}
              <Link
                href="/progress"
                className="font-medium text-zinc-900 underline dark:text-zinc-100"
              >
                progress
              </Link>
              . If you haven’t added vocabulary yet, run{" "}
              <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-700">
                npm run seed
              </code>{" "}
              to load sample words.
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
