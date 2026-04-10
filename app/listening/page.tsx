import Link from "next/link";
import { redirect } from "next/navigation";
import { getListeningIndexData, type ListeningAsset } from "@/lib/loop/listening";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ListeningPage() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Listening</h1>
          <p className="app-subtitle">
            Open a short audio track that matches your reading.
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
          <h1 className="app-title">Listening</h1>
          <p className="app-subtitle">
            Open a short audio track that matches your reading.
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

  let listeningAssets: ListeningAsset[] = [];

  try {
    listeningAssets = await getListeningIndexData(supabase);
  } catch (loadError) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Listening</h1>
          <p className="app-subtitle">
            Something went wrong while loading your listening library.
          </p>
        </section>

        <div className="app-card-strong flex flex-col gap-4 border-red-200 bg-red-50/90 p-8 dark:border-red-900/50 dark:bg-red-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-red-900 dark:text-red-100">
            Error loading listening
          </h2>
          <p className="text-red-800 dark:text-red-200">
            {loadError instanceof Error ? loadError.message : "Unknown error"}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="app-hero">
        <h1 className="app-title">Listening</h1>
        <p className="app-subtitle">
          Choose one calm track, listen at your pace, and open the transcript only when you need it.
        </p>
      </section>

      {listeningAssets.length === 0 ? (
        <section className="app-card flex flex-col gap-3 p-8">
          <h2 className="text-xl font-semibold tracking-tight">No listening assets yet</h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Add rows to the <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">audio</code> table to make matched listening available here.
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-3">
          {listeningAssets.map((asset) => (
            <ListeningAssetCard key={asset.id} asset={asset} />
          ))}
        </div>
      )}
    </main>
  );
}

function ListeningAssetCard({ asset }: { asset: ListeningAsset }) {
  return (
    <Link
      href={`/listening/${asset.id}`}
      className="app-card flex items-start justify-between gap-4 p-4 transition hover:-translate-y-0.5 hover:bg-white dark:hover:bg-zinc-900/90 sm:p-5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {asset.text ? (
            <span className="rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800">
              {asset.text.lang.toUpperCase()}
            </span>
          ) : null}
          {asset.durationSeconds ? <span>{formatDuration(asset.durationSeconds)}</span> : null}
          <span>{asset.transcript ? "Transcript" : "Audio only"}</span>
        </div>

        <h2 className="mt-3 text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-lg">
          {asset.title}
        </h2>

        {asset.text ? (
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Matched to {asset.text.title}
          </p>
        ) : null}
      </div>

      <span className="app-button-secondary shrink-0 self-center">Open</span>
    </Link>
  );
}

function formatDuration(durationSeconds: number) {
  const rounded = Math.max(1, Math.round(durationSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
