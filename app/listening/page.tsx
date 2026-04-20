import { Home as HomeIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CefrBandAccordion, CefrBandAccordionItem } from "@/components/CefrBandAccordion";
import { ContinueListeningRow } from "@/components/ContinueListeningRow";
import { RecommendedListeningCard } from "@/components/listening/RecommendedListeningCard";
import { RightIcon } from "@/components/RightIcon";
import { buildReason, getUserStageIndex, stageIndexToCefrLabel } from "@/lib/listening/recommendation";
import { getListeningIndexData, type ListeningIndexAsset } from "@/lib/loop/listening";
import { getOrCreateDailyRecommendation } from "@/lib/recommendation/daily";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserSettingsRow } from "@/lib/settings/types";

export default async function ListeningPage() {
  const __perfPageStart = performance.now();
  const __perfAuthStart = performance.now();
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Home" className="app-icon-button shrink-0">
              <HomeIcon aria-hidden="true" className="h-5 w-5" />
            </Link>
            <h1 className="app-title">Listening</h1>
          </div>
          <p className="app-subtitle">
            Graded audio from A1 to C2, organised by stage and length.
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
  console.log(
    `[perf] /listening auth total=${Math.round(performance.now() - __perfAuthStart)}ms`,
  );

  if (error) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Home" className="app-icon-button shrink-0">
              <HomeIcon aria-hidden="true" className="h-5 w-5" />
            </Link>
            <h1 className="app-title">Listening</h1>
          </div>
          <p className="app-subtitle">
            Graded audio from A1 to C2, organised by stage and length.
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

  let assets: ListeningIndexAsset[] = [];

  const __perfAssetsStart = performance.now();
  try {
    assets = await getListeningIndexData(supabase);
    console.log(
      `[perf] /listening assets total=${Math.round(performance.now() - __perfAssetsStart)}ms rows=${assets.length}`,
    );
  } catch (loadError) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Home" className="app-icon-button shrink-0">
              <HomeIcon aria-hidden="true" className="h-5 w-5" />
            </Link>
            <h1 className="app-title">Listening</h1>
          </div>
          <p className="app-subtitle">
            Something went wrong while loading listening tracks.
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

  const __perfSettingsProgressStart = performance.now();
  const [settingsRow, progressRows] = await Promise.all([
    supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()
      .then((r) => r.data as UserSettingsRow | null),
    supabase
      .from("listening_progress")
      .select("asset_id, status, updated_at")
      .eq("user_id", user.id)
      .then((r) => r.data as { asset_id: string; status: string; updated_at: string }[] | null),
  ]);
  console.log(
    `[perf] /listening settings+progress total=${Math.round(performance.now() - __perfSettingsProgressStart)}ms`,
  );

  if (!settingsRow) {
    throw new Error("user_settings missing for authenticated user");
  }

  const progressList = progressRows ?? [];

  const assetProgressMap = new Map<string, "in_progress" | "completed">();
  for (const row of progressList) {
    assetProgressMap.set(row.asset_id, row.status as "in_progress" | "completed");
  }

  let dailyRec: Awaited<ReturnType<typeof getOrCreateDailyRecommendation>> | null = null;
  let dailyRecError = false;
  const __perfDailyRecStart = performance.now();
  try {
    dailyRec = await getOrCreateDailyRecommendation(
      supabase,
      user.id,
      "listening",
      settingsRow,
    );
  } catch (err) {
    dailyRecError = true;
    console.error("[listening] getOrCreateDailyRecommendation failed", err);
  }
  console.log(
    `[perf] /listening dailyRec total=${Math.round(performance.now() - __perfDailyRecStart)}ms`,
  );
  console.log(
    `[perf] /listening page total=${Math.round(performance.now() - __perfPageStart)}ms user=${user.id.slice(0, 8)}`,
  );

  const recommendedAsset = dailyRec
    ? assets.find((a) => a.id === dailyRec.assetId) ?? null
    : null;

  const mostRecentInProgressRow = progressList
    .filter(
      (r) =>
        r.status === "in_progress" &&
        (!dailyRec || r.asset_id !== dailyRec.assetId),
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  const continueAsset = mostRecentInProgressRow
    ? assets.find((a) => a.id === mostRecentInProgressRow.asset_id) ?? null
    : null;

  let continueRow: { title: string; href: string; meta: string } | null = null;
  if (continueAsset) {
    const metaParts: string[] = [];
    if (continueAsset.text?.displayLabel) metaParts.push(continueAsset.text.displayLabel);
    if (continueAsset.durationSeconds) {
      const d = continueAsset.durationSeconds;
      metaParts.push(d < 60 ? `${Math.round(d)}s` : `${Math.round(d / 60)}m`);
    }
    continueRow = {
      title: continueAsset.text?.title ?? continueAsset.title,
      href: `/listening/${continueAsset.id}`,
      meta: metaParts.join(" · "),
    };
  }

  const cefrBands = groupByCefr(assets);
  const stageCount = new Set(assets.map((a) => a.text?.stage).filter(Boolean)).size;
  const userBand = stageIndexToCefrLabel(getUserStageIndex(settingsRow));

  return (
    <main className="app-shell">
      <section className="app-hero">
        <div className="flex items-center gap-3">
            <Link href="/" aria-label="Home" className="app-icon-button shrink-0">
              <HomeIcon aria-hidden="true" className="h-5 w-5" />
            </Link>
            <h1 className="app-title">Listening</h1>
          </div>
        <p className="app-subtitle">
          {stageCount} stages &middot; {assets.length} tracks &middot; A1 to C2
        </p>
      </section>

      {dailyRecError ? (
        <div className="app-card flex flex-col gap-2 p-5 sm:p-6">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
            Recommendation
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Couldn&apos;t load today&apos;s recommendation. Refresh to try again.
          </p>
        </div>
      ) : dailyRec && recommendedAsset ? (
        <RecommendedListeningCard
          asset={recommendedAsset}
          status={dailyRec.status}
          reason={buildReason(recommendedAsset)}
        />
      ) : null}

      {continueRow ? (
        <ContinueListeningRow
          title={continueRow.title}
          href={continueRow.href}
          meta={continueRow.meta}
        />
      ) : null}

      {assets.length === 0 ? (
        <section className="app-card flex flex-col gap-3 p-8">
          <h2 className="text-xl font-semibold tracking-tight">No listening tracks yet</h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Run the generation script to create audio assets.
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-6">
          <CefrBandAccordion
            bandLabels={cefrBands.map((b) => b.label)}
            defaultOpenBand={userBand}
            storageKey="listening-band-expanded-state"
          >
            {cefrBands.map((band) => {
              const trackCount = band.stages.reduce(
                (sum, s) => sum + s.modes.reduce((ms, m) => ms + m.assets.length, 0),
                0,
              );
              return (
                <CefrBandAccordionItem
                  key={band.label}
                  bandLabel={band.label}
                  colorClass={CEFR_COLORS[band.label] ?? ""}
                  statsText={`${band.stages.length} ${band.stages.length === 1 ? "stage" : "stages"} · ${trackCount} tracks`}
                >
                  {band.stages.map((stage) => (
                    <StageRow key={stage.stage} stage={stage} assetProgressMap={assetProgressMap} />
                  ))}
                </CefrBandAccordionItem>
              );
            })}
          </CefrBandAccordion>
        </div>
      )}
    </main>
  );
}

// ── Types ────────────────────────────────────────────────────

type CefrBand = {
  label: string;
  stages: ListeningStageGroup[];
};

type ListeningStageGroup = {
  stage: string;
  stageIndex: number;
  displayLabel: string;
  modes: ListeningModeGroup[];
};

type ListeningModeGroup = {
  mode: string;
  assets: ListeningIndexAsset[];
};

// ── Helpers ──────────────────────────────────────────────────

const MODE_ORDER = ["short", "medium", "long", "very_long"];

function broadCefr(displayLabel: string): string {
  return displayLabel.replace(/[-+]+$/, "");
}

function groupByCefr(assets: ListeningIndexAsset[]): CefrBand[] {
  const stageMap = new Map<string, { stageIndex: number; displayLabel: string; assets: ListeningIndexAsset[] }>();

  for (const asset of assets) {
    if (!asset.text) continue;
    const stage = asset.text.stage;

    if (!stageMap.has(stage)) {
      stageMap.set(stage, {
        stageIndex: asset.text.stageIndex ?? 0,
        displayLabel: asset.text.displayLabel ?? stage,
        assets: [],
      });
    }
    stageMap.get(stage)!.assets.push(asset);
  }

  const stageGroups: ListeningStageGroup[] = Array.from(stageMap.entries())
    .sort(([, a], [, b]) => a.stageIndex - b.stageIndex)
    .map(([stage, { stageIndex, displayLabel, assets: stageAssets }]) => {
      const modeMap = new Map<string, ListeningIndexAsset[]>();
      for (const a of stageAssets) {
        const mode = a.text?.passageMode ?? "unknown";
        if (!modeMap.has(mode)) modeMap.set(mode, []);
        modeMap.get(mode)!.push(a);
      }

      const modes = MODE_ORDER.filter((m) => modeMap.has(m))
        .map((m) => ({
          mode: m,
          assets: modeMap.get(m)!.sort(
            (a, b) => (a.text?.passageNumber ?? 0) - (b.text?.passageNumber ?? 0),
          ),
        }));

      for (const [m, mAssets] of modeMap) {
        if (!MODE_ORDER.includes(m)) {
          modes.push({ mode: m, assets: mAssets });
        }
      }

      return { stage, stageIndex, displayLabel, modes };
    });

  const bands = new Map<string, CefrBand>();
  for (const stageGroup of stageGroups) {
    const label = broadCefr(stageGroup.displayLabel);
    if (!bands.has(label)) {
      bands.set(label, { label, stages: [] });
    }
    bands.get(label)!.stages.push(stageGroup);
  }

  return Array.from(bands.values());
}

const MODE_LABELS: Record<string, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
  very_long: "Very Long",
};

const MODE_PILL_LABELS: Record<string, string> = {
  short: "S",
  medium: "M",
  long: "L",
  very_long: "XL",
};

const CEFR_COLORS: Record<string, string> = {
  A1: "border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
  A2: "border-sky-200 bg-sky-50/80 text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200",
  B1: "border-amber-200 bg-amber-50/80 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
  B2: "border-rose-200 bg-rose-50/80 text-rose-800 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-200",
  C1: "border-violet-200 bg-violet-50/80 text-violet-800 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-200",
  C2: "border-fuchsia-200 bg-fuchsia-50/80 text-fuchsia-800 dark:border-fuchsia-800 dark:bg-fuchsia-950/30 dark:text-fuchsia-200",
};

// ── Progress-driven styling ─────────────────────────────────

type AssetProgressMap = Map<string, "in_progress" | "completed">;

/**
 * Returns Tailwind classes for a listening passage item based on user progress.
 */
export function getAssetStateClasses(assetId: string, progressMap: AssetProgressMap): string {
  const status = progressMap.get(assetId);
  switch (status) {
    case "completed":
      return "border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40";
    case "in_progress":
      return "border-blue-400 bg-blue-50/40 hover:bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20 dark:hover:bg-blue-900/30";
    default:
      return "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50";
  }
}

function getAssetStatusLabel(assetId: string, progressMap: AssetProgressMap): { text: string; className: string } | null {
  const status = progressMap.get(assetId);
  if (status === "completed") {
    return { text: "Done", className: "text-emerald-600 dark:text-emerald-400" };
  }
  return null;
}

// ── Components ───────────────────────────────────────────────

function StageRow({ stage, assetProgressMap }: { stage: ListeningStageGroup; assetProgressMap: AssetProgressMap }) {
  const trackCount = stage.modes.reduce(
    (sum, m) => sum + m.assets.length,
    0,
  );
  const modesLabel = stage.modes
    .map((m) => MODE_PILL_LABELS[m.mode] ?? m.mode)
    .join(" · ");

  return (
    <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm select-none hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
        <RightIcon className="h-4 w-4 text-zinc-400 transition group-open:rotate-90 dark:text-zinc-500" />
        <span className="inline-block min-w-[3.25rem] whitespace-nowrap font-medium text-zinc-900 dark:text-zinc-100">
          {stage.displayLabel}
        </span>
        <span className="whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
          {trackCount} tracks
        </span>
        <span className="ml-auto whitespace-nowrap rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {modesLabel}
        </span>
      </summary>

      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex flex-col gap-3">
          {stage.modes.map((modeGroup) => (
            <div key={modeGroup.mode} className="flex flex-col gap-1.5">
              <p className="text-xs font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                {MODE_LABELS[modeGroup.mode] ?? modeGroup.mode}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {modeGroup.assets.map((asset) => {
                  const statusLabel = getAssetStatusLabel(asset.id, assetProgressMap);
                  return (
                    <Link
                      key={asset.id}
                      href={`/listening/${asset.id}`}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition ${getAssetStateClasses(asset.id, assetProgressMap)}`}
                    >
                      <span className="truncate text-zinc-900 dark:text-zinc-100">
                        {asset.text?.title ?? asset.title}
                      </span>
                      <span className="ml-2 flex shrink-0 items-center gap-2">
                        {statusLabel ? (
                          <span className={`text-[11px] font-medium ${statusLabel.className}`}>
                            {statusLabel.text}
                          </span>
                        ) : null}
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {asset.durationSeconds != null
                            ? formatDuration(asset.durationSeconds)
                            : null}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
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
