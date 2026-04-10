import Link from "next/link";
import { redirect } from "next/navigation";
import { ListeningPlayer } from "@/components/listening/ListeningPlayer";
import { getTodayDailySessionRow } from "@/lib/loop/dailySessions";
import { getListeningAssetById } from "@/lib/loop/listening";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ListeningAssetPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Listening</h1>
          <p className="app-subtitle">
            Open a matched audio track and listen with as little friction as possible.
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
            Open a matched audio track and listen with as little friction as possible.
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

  let asset = null;

  try {
    asset = await getListeningAssetById(supabase, assetId);
  } catch (loadError) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Listening</h1>
          <p className="app-subtitle">
            Something went wrong while loading this audio track.
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

  if (!asset) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <h1 className="app-title">Listening</h1>
          <p className="app-subtitle">
            This listening asset could not be found.
          </p>
        </section>

        <section className="app-card flex flex-col gap-3 p-8">
          <h2 className="text-xl font-semibold tracking-tight">Listening unavailable</h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            No listening asset matched <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">{assetId}</code>.
          </p>
        </section>
      </main>
    );
  }

  const dailySession = await getTodayDailySessionRow(supabase, user.id);
  const completedForToday = Boolean(
    dailySession?.listening_done &&
      dailySession.listening_asset_id === asset.id,
  );

  return (
    <main className="app-shell">
      <section className="flex items-start justify-between gap-4">
        <div className="app-hero">
          <h1 className="app-title">{asset.title}</h1>
          <p className="app-subtitle">
            Listen once or twice. Open the transcript if you need it.
          </p>
        </div>

        {asset.text ? (
          <Link
            href={`/reader/${asset.text.id}`}
            className="app-button-secondary shrink-0"
          >
            Reader
          </Link>
        ) : null}
      </section>

      <section className="app-card-muted flex flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {asset.text ? (
            <span className="rounded-full border border-zinc-200 px-2.5 py-1 dark:border-zinc-800">
              {asset.text.lang.toUpperCase()}
            </span>
          ) : null}
          {asset.durationSeconds ? (
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-800/80">
              {formatDurationLabel(asset.durationSeconds)}
            </span>
          ) : null}
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-800/80">
            {asset.transcript ? "Transcript available" : "Audio only"}
          </span>
        </div>

        {asset.text ? (
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Matched to <span className="font-medium text-zinc-900 dark:text-zinc-100">{asset.text.title}</span>.
          </p>
        ) : null}

        {completedForToday ? (
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            This listening step is already logged for today.
          </p>
        ) : null}
      </section>

      <ListeningPlayer
        asset={asset}
        initialCompletion={{
          completed: completedForToday,
          maxPositionSeconds:
            dailySession?.listening_asset_id === asset.id
              ? dailySession?.listening_max_position_seconds ?? null
              : null,
          transcriptOpened:
            dailySession?.listening_asset_id === asset.id
              ? dailySession?.listening_transcript_opened ?? false
              : false,
          playbackRate:
            dailySession?.listening_asset_id === asset.id
              ? dailySession?.listening_playback_rate ?? null
              : null,
        }}
      />
    </main>
  );
}

function formatDurationLabel(durationSeconds: number) {
  const rounded = Math.max(1, Math.round(durationSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;

  if (minutes === 0) {
    return `${seconds}s audio`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")} audio`;
}
