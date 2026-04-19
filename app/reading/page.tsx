import { Home as HomeIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CefrBandAccordion, CefrBandAccordionItem } from "@/components/CefrBandAccordion";
import { RecommendedReadingCard } from "@/components/reading/RecommendedReadingCard";
import { getUserStageIndex, stageIndexToCefrLabel } from "@/lib/listening/recommendation";
import { getPassageIndex } from "@/lib/reading/passages";
import { getReadingRecommendation } from "@/lib/reading/recommendation";
import type { ReadingPassageSummary, ReadingStageGroup } from "@/lib/reading/types";
import type { UserSettingsRow } from "@/lib/settings/types";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ReadingPage() {
  const supabase = await createSupabaseServerClient();

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

  const { user, error } = await getSupabaseUser(supabase);

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

  // ── Recommendation data ──────────────────────────────────
  const allPassages: ReadingPassageSummary[] = stages.flatMap((s) =>
    s.modes.flatMap((m) => m.passages),
  );

  // Fetch user settings + reading_progress in parallel
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

  const progressList = progressRows ?? [];
  const excludedTextIds = new Set(progressList.map((r) => r.text_id));

  // Find the most recently updated in-progress passage
  const inProgressRows = progressList
    .filter((r) => r.status === "in_progress")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const inProgressPassage = inProgressRows.length > 0
    ? allPassages.find((p) => p.id === inProgressRows[0]!.text_id) ?? null
    : null;

  const DEFAULT_SETTINGS: UserSettingsRow = {
    user_id: user.id,
    learning_lang: "es",
    daily_plan_mode: "recommended",
    manual_daily_card_limit: 200,
    flashcard_selection_mode: "recommended",
    include_cloze: true,
    include_normal: true,
    include_audio: false,
    include_mcq: false,
    include_sentences: false,
    include_cloze_en_to_es: true,
    include_cloze_es_to_en: false,
    include_normal_en_to_es: true,
    include_normal_es_to_en: false,
    retry_delay_seconds: 90,
    auto_advance_correct: true,
    show_pos_hint: true,
    show_definition_first: true,
    hide_translation_sentences: false,
    remove_daily_limit: false,
    scheduler_variant: "baseline",
    has_seen_intro: false,
    onboarding_completed_at: null,
    placement_status: "unknown",
    current_frontier_rank: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };

  const recommendation = getReadingRecommendation(
    inProgressPassage,
    allPassages,
    settingsRow ?? DEFAULT_SETTINGS,
    excludedTextIds,
  );

  // Group stages by broad CEFR band (A1, A2, B1, B2, C1, C2)
  const cefrBands = groupByCefr(stages);
  const totalPassages = stages.reduce(
    (sum, s) => sum + s.modes.reduce((ms, m) => ms + m.passages.length, 0),
    0,
  );
  const userBand = stageIndexToCefrLabel(
    getUserStageIndex(settingsRow ?? DEFAULT_SETTINGS),
  );

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
          {recommendation ? (
            <RecommendedReadingCard recommendation={recommendation} />
          ) : null}
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
                    <StageRow key={stage.stage} stage={stage} />
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

// ── Components ───────────────────────────────────────────────

function StageRow({ stage }: { stage: ReadingStageGroup }) {
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
        <span className="text-zinc-400 transition group-open:rotate-90 dark:text-zinc-500">
          &#9654;
        </span>
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
                {modeGroup.passages.map((passage) => (
                  <Link
                    key={passage.id}
                    href={`/reader/${passage.id}`}
                    className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                  >
                    <span className="truncate text-zinc-900 dark:text-zinc-100">
                      {passage.title}
                    </span>
                    <span className="ml-2 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                      {passage.wordCount != null
                        ? `${passage.wordCount} w`
                        : null}
                      {passage.estimatedMinutes != null
                        ? ` · ${passage.estimatedMinutes}m`
                        : null}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
