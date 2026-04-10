import { redirect } from "next/navigation";
import { ReaderSession } from "@/components/reader/ReaderSession";
import { getTodayDailySessionRow } from "@/lib/loop/dailySessions";
import { getListeningAssetForTextId } from "@/lib/loop/listening";
import { getTextById } from "@/lib/loop/texts";
import { getSavedWordsState } from "@/lib/reader/savedWords";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ textId: string }>;
}) {
  const { textId } = await params;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Reader</h1>
          <p className="app-subtitle">
            Open a saved text and tap words to inspect them.
          </p>
        </section>

        <div className="app-card-strong flex flex-col gap-4 border-amber-200 bg-amber-50/90 p-8 dark:border-amber-900/50 dark:bg-amber-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-amber-900 dark:text-amber-100">
            Supabase not configured
          </h2>
          <p className="text-amber-800 dark:text-amber-200">
            Copy <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">.env.example</code> to{" "}
            <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">.env.local</code> and set{" "}
            <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="rounded bg-amber-200 px-1 dark:bg-amber-900/50">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
          </p>
        </div>
      </main>
    );
  }

  const { user, error } = await getSupabaseUser(supabase);

  if (error) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Reader</h1>
          <p className="app-subtitle">
            Open a saved text and tap words to inspect them.
          </p>
        </section>

        <div className="app-card-strong flex flex-col gap-4 border-red-200 bg-red-50/90 p-8 dark:border-red-900/50 dark:bg-red-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-red-900 dark:text-red-100">
            Authentication unavailable
          </h2>
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      </main>
    );
  }

  if (!user) {
    redirect("/login");
  }

  let text = null;
  try {
    text = await getTextById(supabase, textId);
  } catch (error) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Reader</h1>
          <p className="app-subtitle">
            Something went wrong while loading this text.
          </p>
        </section>

        <div className="app-card-strong flex flex-col gap-4 border-red-200 bg-red-50/90 p-8 dark:border-red-900/50 dark:bg-red-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-red-900 dark:text-red-100">
            Error loading text
          </h2>
          <p className="text-red-800 dark:text-red-200">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      </main>
    );
  }

  if (!text) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Reader</h1>
          <p className="app-subtitle">
            This text could not be found.
          </p>
        </section>

        <section className="app-card flex flex-col gap-3 p-8">
          <h2 className="text-xl font-semibold tracking-tight">Text unavailable</h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            No text matched <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">{textId}</code>.
          </p>
        </section>
      </main>
    );
  }

  const [savedState, listeningAsset, dailySession] = await Promise.all([
    getSavedWordState(supabase, user.id, text.lang),
    getListeningAssetForTextId(supabase, text.id),
    getTodayDailySessionRow(supabase, user.id),
  ]);
  const readingDoneForText = Boolean(
    dailySession?.reading_done &&
      dailySession.reading_text_id === text.id,
  );
  const listeningDoneForText = listeningAsset
    ? Boolean(
        dailySession?.listening_done &&
          dailySession.listening_asset_id === listeningAsset.id,
      )
    : readingDoneForText;

  return (
    <main className="app-shell">
      <section className="app-hero">
        <h1 className="app-title">{text.title}</h1>
        <p className="app-subtitle">
          Tap a word to see its definition and save it to your manual deck.
        </p>
      </section>

      <ReaderSession
        text={text}
        initialSavedWordIds={savedState.wordIds}
        initialSavedLemmas={savedState.lemmas}
        listeningAssetId={listeningAsset?.id ?? null}
        readingDone={readingDoneForText}
        listeningDone={listeningDoneForText}
      />
    </main>
  );
}

async function getSavedWordState(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  userId: string,
  language: string,
) {
  return getSavedWordsState(supabase, userId, language);
}
