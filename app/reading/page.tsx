import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getReadingIndexData,
  type ReadingIndexCollection,
  type ReadingIndexText,
} from "@/lib/loop/texts";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ReadingPage() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Reading</h1>
          <p className="app-subtitle">
            Choose a short text and open one reading chunk at a time.
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
          <h1 className="app-title">Reading</h1>
          <p className="app-subtitle">
            Choose a short text and open one reading chunk at a time.
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

  let readingIndex = null;

  try {
    readingIndex = await getReadingIndexData(supabase);
  } catch (loadError) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Reading</h1>
          <p className="app-subtitle">
            Something went wrong while loading your reading library.
          </p>
        </section>

        <div className="app-card-strong flex flex-col gap-4 border-red-200 bg-red-50/90 p-8 dark:border-red-900/50 dark:bg-red-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-red-900 dark:text-red-100">
            Error loading texts
          </h2>
          <p className="text-red-800 dark:text-red-200">
            {loadError instanceof Error ? loadError.message : "Unknown error"}
          </p>
        </div>
      </main>
    );
  }

  const { collections, standaloneTexts } = readingIndex;
  const hasContent = collections.length > 0 || standaloneTexts.length > 0;

  return (
    <main className="app-shell">
      <section className="app-hero">
        <h1 className="app-title">Reading</h1>
        <p className="app-subtitle">
          Open one manageable chunk, read at a comfortable pace, and tap words only when you need them.
        </p>
      </section>

      {!hasContent ? (
        <section className="app-card flex flex-col gap-3 p-8">
          <h2 className="text-xl font-semibold tracking-tight">No reading texts yet</h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            The reader index will appear here once texts are available in Supabase.
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-6">
          {collections.map((collection) => (
            <ReadingCollectionSection
              key={collection.id}
              collection={collection}
            />
          ))}

          {standaloneTexts.length > 0 ? (
            <section className="app-card-strong flex flex-col gap-5 p-5 sm:p-6">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                  Standalone
                </p>
                <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                  Individual texts
                </h2>
                <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                  Short pieces that do not belong to a larger collection.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {standaloneTexts.map((text) => (
                  <ReadingTextCard key={text.id} text={text} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}

function ReadingCollectionSection({
  collection,
}: {
  collection: ReadingIndexCollection;
}) {
  return (
    <section className="app-card-strong flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800">
            Collection
          </span>
          <span>{collection.texts.length} parts</span>
          {collection.author ? <span>By {collection.author}</span> : null}
        </div>

        <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {collection.title}
        </h2>

        {collection.description ? (
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {collection.description}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        {collection.texts.map((text) => (
          <ReadingTextCard key={text.id} text={text} />
        ))}
      </div>
    </section>
  );
}

function ReadingTextCard({ text }: { text: ReadingIndexText }) {
  return (
    <Link
      href={`/reader/${text.id}`}
      className="app-card flex items-start justify-between gap-4 p-4 transition hover:-translate-y-0.5 hover:bg-white dark:hover:bg-zinc-900/90 sm:p-5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {text.sectionNumber !== null ? (
            <span className="rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800">
              Section {text.sectionNumber}
            </span>
          ) : null}
          <span>{text.lang.toUpperCase()}</span>
        </div>

        <h3 className="mt-3 text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-lg">
          {text.title}
        </h3>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          {text.wordCount !== null ? (
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-800/80">
              {formatWordCount(text.wordCount)}
            </span>
          ) : null}
          {text.estimatedMinutes !== null ? (
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-800/80">
              {formatMinutes(text.estimatedMinutes)}
            </span>
          ) : null}
          {text.difficultyCefr ? (
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 uppercase dark:bg-zinc-800/80">
              {text.difficultyCefr}
            </span>
          ) : null}
        </div>
      </div>

      <span className="app-button-secondary shrink-0 self-center">Open</span>
    </Link>
  );
}

function formatWordCount(wordCount: number) {
  return `${wordCount.toLocaleString("en-GB")} words`;
}

function formatMinutes(minutes: number) {
  return `${minutes} min`;
}
