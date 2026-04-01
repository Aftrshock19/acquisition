import Link from "next/link";
import { getTodayFlashcards } from "@/app/actions/srs";
import { TodaySession } from "@/components/srs/TodaySession";

export default async function TodayPage() {
  const result = await getTodayFlashcards("es");
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
  const hasCards = session.dueReviews.length > 0 || session.newWords.length > 0;
  const enabledTypeCount = Object.values(effectiveSettings.enabledTypes).filter(
    Boolean,
  ).length;

  if (session.configMissing) {
    return (
      <main className="app-shell">
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
    <main className="app-shell">
      <section className="app-hero">
        <h1 className="app-title">Vocabulary</h1>
      </section>
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
      ) : (
        <TodaySession
          enabledTypes={effectiveSettings.enabledTypes}
          session={session}
          dailyLimit={effectiveSettings.dailyLimit}
          retryDelayMs={effectiveSettings.retryDelaySeconds * 1000}
          showPosHint={effectiveSettings.showPosHint}
          initialDailySession={result.dailySession ?? null}
          initialDebugSnapshot={result.debugSnapshot}
        />
      )}
    </main>
  );
}
