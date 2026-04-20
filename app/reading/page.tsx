import { Home as HomeIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CefrBandAccordion, CefrBandAccordionItem } from "@/components/CefrBandAccordion";
import { EmptyRecommendationCard } from "@/components/EmptyRecommendationCard";
import { RecommendedReadingCard } from "@/components/reading/RecommendedReadingCard";
import { RightIcon } from "@/components/RightIcon";
import { StartedList, type StartedItem } from "@/components/StartedList";
import { getUserStageIndex, stageIndexToCefrLabel } from "@/lib/listening/recommendation";
import { getPassageIndex } from "@/lib/reading/passages";
import { buildReason } from "@/lib/reading/recommendation";
import type { ReadingPassageSummary, ReadingStageGroup } from "@/lib/reading/types";
import { getOrCreateDailyRecommendation } from "@/lib/recommendation/daily";
import type { UserSettingsRow } from "@/lib/settings/types";
import { getSupabaseServerContextFast } from "@/lib/supabase/server";

export default async function ReadingPage() {
  const { supabase, user, error } = await getSupabaseServerContextFast();

  if (!supabase) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Home" className="app-icon-button shrink-0">
              <HomeIcon aria-hidden="true" className="h-5 w-5" />
            </Link>
            <h1 className="app-title">Reading</h1>
          </div>
          <p className="app-subtitle">
            Graded texts from A1 to C2, organised by stage and length.
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

  if (error) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Home" className="app-icon-button shrink-0">
              <HomeIcon aria-hidden="true" className="h-5 w-5" />
            </Link>
            <h1 className="app-title">Reading</h1>
          </div>
          <p className="app-subtitle">
            Graded texts from A1 to C2, organised by stage and length.
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

  let stages: ReadingStageGroup[] = [];

  try {
    stages = await getPassageIndex(supabase);
  } catch (loadError) {
    return (
      <main className="app-shell">
        <section className="app-hero">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="Home" className="app-icon-button shrink-0">
              <HomeIcon aria-hidden="true" className="h-5 w-5" />
            </Link>
            <h1 className="app-title">Reading</h1>
          </div>
          <p className="app-subtitle">
            Something went wrong while loading reading texts.
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

  const allPassages: ReadingPassageSummary[] = stages.flatMap((s) =>
    s.modes.flatMap((m) => m.passages),
  );

  const [settingsRow, progressRows] = await Promise.all([
    supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()
      .then((r) => r.data as UserSettingsRow | null),
    supabase
      .from("reading_progress")
      .select("text_id, status, updated_at")
      .eq("user_id", user.id)
      .then((r) => r.data as { text_id: string; status: string; updated_at: string }[] | null),
  ]);

  if (!settingsRow) {
    throw new Error("user_settings missing for authenticated user");
  }

  const progressList = progressRows ?? [];

  const passageProgressMap = new Map<string, "in_progress" | "completed">();
  for (const row of progressList) {
    passageProgressMap.set(row.text_id, row.status as "in_progress" | "completed");
  }

  const dailyRec = await getOrCreateDailyRecommendation(
    supabase,
    user.id,
    "reading",
    settingsRow,
  );

  const recommendedPassage = dailyRec
    ? allPassages.find((p) => p.id === dailyRec.assetId) ?? null
    : null;

  const startedPassages: StartedItem[] = progressList
    .filter((r) => r.status === "in_progress")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((r) => {
      const passage = allPassages.find((p) => p.id === r.text_id);
      if (!passage) return null;
      const metaParts: string[] = [passage.displayLabel];
      if (passage.estimatedMinutes) metaParts.push(`${passage.estimatedMinutes}m`);
      return {
        id: passage.id,
        title: passage.title,
        href: `/reader/${passage.id}`,
        meta: metaParts.join(" · "),
      } satisfies StartedItem;
    })
    .filter((item): item is StartedItem => item !== null);

  const cefrBands = groupByCefr(stages);
  const totalPassages = stages.reduce(
    (sum, s) => sum + s.modes.reduce((ms, m) => ms + m.passages.length, 0),
    0,
  );
  const userBand = stageIndexToCefrLabel(getUserStageIndex(settingsRow));

  return (
    <main className="app-shell">
      <section className="app-hero">
        <div className="flex items-center gap-3">
            <Link href="/" aria-label="Home" className="app-icon-button shrink-0">
              <HomeIcon aria-hidden="true" className="h-5 w-5" />
            </Link>
            <h1 className="app-title">Reading</h1>
          </div>
        <p className="app-subtitle">
          {stages.length} stages &middot; {totalPassages} texts &middot; A1 to C2
        </p>
      </section>

      {stages.length === 0 ? (
        <section className="app-card flex flex-col gap-3 p-8">
          <h2 className="text-xl font-semibold tracking-tight">No texts yet</h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Run the import script to load reading texts.
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-6">
          {dailyRec === null ? (
            <EmptyRecommendationCard kind="reading" />
          ) : recommendedPassage ? (
            <RecommendedReadingCard
              passage={recommendedPassage}
              status={dailyRec.status}
              reason={buildReason(recommendedPassage)}
            />
          ) : null}

          <StartedList kind="reading" items={startedPassages} />

          <CefrBandAccordion
            bandLabels={cefrBands.map((b) => b.label)}
            defaultOpenBand={userBand}
            storageKey="reading-band-expanded-state"
          >
            {cefrBands.map((band) => {
              const passageCount = band.stages.reduce(
                (sum, s) => sum + s.modes.reduce((ms, m) => ms + m.passages.length, 0),
                0,
              );
              return (
                <CefrBandAccordionItem
                  key={band.label}
                  bandLabel={band.label}
                  colorClass={CEFR_COLORS[band.label] ?? ""}
                  statsText={`${band.stages.length} ${band.stages.length === 1 ? "stage" : "stages"} · ${passageCount} texts`}
                >
                  {band.stages.map((stage) => (
                    <StageRow
                      key={stage.stage}
                      stage={stage}
                      passageProgressMap={passageProgressMap}
                    />
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
  stages: ReadingStageGroup[];
};

// ── Helpers ──────────────────────────────────────────────────

function broadCefr(displayLabel: string): string {
  return displayLabel.replace(/[-+]+$/, "");
}

function groupByCefr(stages: ReadingStageGroup[]): CefrBand[] {
  const bands = new Map<string, CefrBand>();

  for (const stage of stages) {
    const label = broadCefr(stage.displayLabel);
    const existing = bands.get(label);
    if (existing) {
      existing.stages.push(stage);
    } else {
      bands.set(label, { label, stages: [stage] });
    }
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

type PassageProgressMap = Map<string, "in_progress" | "completed">;

/**
 * Returns Tailwind classes for a reading passage item based on user progress.
 */
export function getPassageStateClasses(textId: string, progressMap: PassageProgressMap): string {
  const status = progressMap.get(textId);
  switch (status) {
    case "completed":
      return "border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40";
    case "in_progress":
      return "border-blue-400 bg-blue-50/40 hover:bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20 dark:hover:bg-blue-900/30";
    default:
      return "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50";
  }
}

function getPassageStatusLabel(textId: string, progressMap: PassageProgressMap): { text: string; className: string } | null {
  const status = progressMap.get(textId);
  if (status === "completed") {
    return { text: "Done", className: "text-emerald-600 dark:text-emerald-400" };
  }
  return null;
}

// ── Components ───────────────────────────────────────────────

function StageRow({
  stage,
  passageProgressMap,
}: {
  stage: ReadingStageGroup;
  passageProgressMap: PassageProgressMap;
}) {
  const passageCount = stage.modes.reduce(
    (sum, m) => sum + m.passages.length,
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
          {passageCount} texts
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
                {modeGroup.passages.map((passage) => {
                  const statusLabel = getPassageStatusLabel(passage.id, passageProgressMap);
                  return (
                    <Link
                      key={passage.id}
                      href={`/reader/${passage.id}`}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition ${getPassageStateClasses(passage.id, passageProgressMap)}`}
                    >
                      <span className="truncate text-zinc-900 dark:text-zinc-100">
                        {passage.title}
                      </span>
                      <span className="ml-2 flex shrink-0 items-center gap-2">
                        {statusLabel ? (
                          <span className={`text-[11px] font-medium ${statusLabel.className}`}>
                            {statusLabel.text}
                          </span>
                        ) : null}
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {passage.wordCount != null
                            ? `${passage.wordCount} w`
                            : null}
                          {passage.estimatedMinutes != null
                            ? ` · ${passage.estimatedMinutes}m`
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
