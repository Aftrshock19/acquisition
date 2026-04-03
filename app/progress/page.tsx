import Link from "next/link";
import { BackButton } from "@/components/BackButton";
import {
  CefrLadder,
  type CefrLadderRowData,
  ProgressHeroCard,
  SecondaryMetricCard,
  StatCard,
} from "./_components";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

type CefrBand = {
  label: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  min: number;
  max: number;
};

const LEMMA_CEFR_BANDS = [
  { label: "A1", min: 0, max: 1200 },
  { label: "A2", min: 1200, max: 2000 },
  { label: "B1", min: 2000, max: 2800 },
  { label: "B2", min: 2800, max: 3600 },
  { label: "C1", min: 3600, max: 4300 },
  { label: "C2", min: 4300, max: 5000 },
] as const satisfies readonly CefrBand[];

type CountResult = {
  learned: number;
  error: { message: string } | null;
};

type CefrProgress = {
  current: CefrBand;
  next: CefrBand | null;
  displayCount: number;
  percent: number;
  completedInBand: number;
  remainingInBand: number;
  bandSize: number;
};

export default async function ProgressPage() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Progress</h1>
          <p className="app-subtitle">Your Spanish vocabulary profile</p>
        </section>

        <section className="app-card flex flex-col gap-3 p-8">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Progress is unavailable
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Supabase is not configured yet, so your Spanish vocabulary profile cannot load.
          </p>
        </section>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Progress</h1>
          <p className="app-subtitle">Your Spanish vocabulary profile</p>
        </section>

        <section className="app-card flex flex-col gap-4 p-8">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Sign in to view your profile
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            See how your lemma knowledge is growing over time once you{" "}
            <Link
              href="/login"
              className="font-medium text-zinc-900 underline dark:text-zinc-100"
            >
              sign in
            </Link>
            .
          </p>
        </section>
      </main>
    );
  }

  const [spanishEntryResult, lemmaProgressResult, verbLemmaResult] =
    await Promise.all([
      getSpanishEntryCounts(supabase, user.id),
      getLemmaProgressCounts(supabase, user.id),
      getVerbLemmaCounts(supabase, user.id),
    ]);

  const errors = [
    spanishEntryResult.error,
    lemmaProgressResult.error,
    verbLemmaResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Progress</h1>
          <p className="app-subtitle">Your Spanish vocabulary profile</p>
        </section>

        <section className="app-card-strong flex flex-col gap-3 border-red-200 bg-red-50/90 p-8 dark:border-red-900/50 dark:bg-red-950/30">
          <h2 className="text-xl font-semibold tracking-tight text-red-900 dark:text-red-100">
            Error loading progress
          </h2>
          <p className="text-sm leading-6 text-red-800 dark:text-red-200">
            {errors[0]?.message}
          </p>
        </section>
      </main>
    );
  }

  const spanishEntryCount = spanishEntryResult.learned;
  const learnedLemmaCount = lemmaProgressResult.learned;
  const learnedVerbLemmaCount = verbLemmaResult.learned;
  const lemmaProfile = getCefrProgress(learnedLemmaCount, LEMMA_CEFR_BANDS);
  const ladderRows = getCefrLadderRows(learnedLemmaCount, LEMMA_CEFR_BANDS);
  const completedBands = ladderRows.filter((row) => row.tone === "completed").length;

  return (
    <main className="app-shell">
      <BackButton />

      <section className="app-hero">
        <h1 className="app-title">Progress</h1>
        <p className="app-subtitle">Your Spanish vocabulary profile</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Vocabulary profile"
          value={`${lemmaProfile.current.label} vocabulary profile`}
          detail="Estimated from mastered Spanish lemmas."
          tone="strong"
          badge="Estimated"
        />
        <StatCard
          label="Mastered lemmas"
          value={formatNumber(learnedLemmaCount)}
          detail="Primary progress signal for your Spanish vocabulary."
        />
        <StatCard
          label="Seen forms"
          value={formatNumber(spanishEntryCount)}
          detail="Learned Spanish word entries across forms."
        />
        <StatCard
          label="Verb lemmas"
          value={formatNumber(learnedVerbLemmaCount)}
          detail="Unique learned Spanish verb lemmas."
        />
      </section>

      <ProgressHeroCard
        eyebrow="Lemma-based progress"
        badge="Estimated profile"
        title={`${lemmaProfile.current.label} vocabulary profile`}
        description="See how your lemma knowledge is growing over time. Built from the Spanish words you have actually learned in the app."
        value={`${formatNumber(learnedLemmaCount)} mastered lemmas`}
        progressLabel={getHeroProgressLabel(lemmaProfile)}
        progressPercent={lemmaProfile.percent}
        progressAriaLabel={`${lemmaProfile.current.label} vocabulary profile progress based on mastered Spanish lemmas`}
        helper="This profile is estimated from learned Spanish lemmas. It reflects vocabulary range, not exam certification."
        meta={[
          {
            label: "Current band",
            value: `${lemmaProfile.current.label} range`,
            detail: formatBandRange(lemmaProfile.current),
          },
          {
            label: "Band progress",
            value: `${Math.round(lemmaProfile.percent)}%`,
            detail: `${formatNumber(lemmaProfile.completedInBand)} of ${formatNumber(
              lemmaProfile.bandSize,
            )} lemmas in this range`,
          },
        ]}
      />

      <section className="app-card flex flex-col gap-5 p-6 md:p-8">
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
            CEFR vocabulary ladder
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Lemma profile by band
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Each band shows estimated vocabulary coverage from mastered Spanish lemmas.
          </p>
        </div>

        <CefrLadder rows={ladderRows} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
            Secondary stats
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Spanish learning detail
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Supporting counts from the Spanish entries you have learned so far.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <SecondaryMetricCard
            label="Seen forms"
            value={formatNumber(spanishEntryCount)}
            detail="Spanish word entries currently represented in your learned set."
          />
          <SecondaryMetricCard
            label="Verb lemmas"
            value={formatNumber(learnedVerbLemmaCount)}
            detail="Unique Spanish verb lemmas across your learned entries."
          />
          <SecondaryMetricCard
            label="Spanish learning entries"
            value={formatNumber(spanishEntryCount)}
            detail="Current schema tracks learned Spanish entries at the word or form level."
            emphasis="Current schema"
          />
          <SecondaryMetricCard
            label="Bands completed"
            value={`${completedBands} of ${LEMMA_CEFR_BANDS.length}`}
            detail="CEFR vocabulary bands fully covered by mastered lemmas."
            emphasis={lemmaProfile.next ? `${formatNumber(lemmaProfile.remainingInBand)} to ${lemmaProfile.next.label}` : "Top range covered"}
          />
        </div>
      </section>
    </main>
  );
}

async function getSpanishEntryCounts(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<CountResult> {
  const learnedResult = await supabase
    .from("user_words")
    .select("word_id, words!inner(lang)", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("words.lang", "es");

  return {
    learned: learnedResult.count ?? 0,
    error: learnedResult.error
      ? { message: learnedResult.error.message }
      : null,
  };
}

async function getLemmaProgressCounts(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<CountResult> {
  const learnedLemmaResult = await supabase
    .from("user_words")
    .select("words!inner(lemma, lang)")
    .eq("user_id", userId)
    .eq("words.lang", "es");

  if (learnedLemmaResult.error) {
    return {
      learned: 0,
      error: { message: learnedLemmaResult.error.message },
    };
  }

  return {
    learned: countDistinctWordField(learnedLemmaResult.data ?? [], "lemma"),
    error: null,
  };
}

async function getVerbLemmaCounts(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<CountResult> {
  const learnedVerbResult = await supabase
    .from("user_words")
    .select("words!inner(lemma, lang, pos)")
    .eq("user_id", userId)
    .eq("words.lang", "es")
    .eq("words.pos", "v");

  if (learnedVerbResult.error) {
    return {
      learned: 0,
      error: { message: learnedVerbResult.error.message },
    };
  }

  return {
    learned: countDistinctWordField(learnedVerbResult.data ?? [], "lemma"),
    error: null,
  };
}

function countDistinctWordField(
  rows: { words: { lemma?: string | null } | { lemma?: string | null }[] | null }[],
  field: "lemma",
) {
  return new Set(
    rows
      .map((row) => {
        const words = Array.isArray(row.words) ? row.words[0] : row.words;
        return words?.[field] ?? null;
      })
      .filter((value): value is string => Boolean(value)),
  ).size;
}

function getCefrProgress(learnedCount: number, bands: readonly CefrBand[]): CefrProgress {
  const finalBand = bands[bands.length - 1];
  const current =
    [...bands].reverse().find((band) => learnedCount >= band.min) ?? bands[0];
  const next = bands[bands.findIndex((band) => band.label === current.label) + 1] ?? null;
  const displayCount = Math.min(learnedCount, finalBand.max);
  const bandSize = Math.max(1, current.max - current.min);
  const completedInBand = Math.max(0, Math.min(displayCount, current.max) - current.min);
  const remainingInBand = Math.max(0, current.max - displayCount);
  const rawPercent = (completedInBand / bandSize) * 100;
  const percent =
    learnedCount >= finalBand.max ? 100 : Math.max(0, Math.min(100, rawPercent));

  return {
    current,
    next,
    displayCount,
    percent,
    completedInBand,
    remainingInBand,
    bandSize,
  };
}

function getCefrLadderRows(
  learnedCount: number,
  bands: readonly CefrBand[],
): CefrLadderRowData[] {
  const finalBand = bands[bands.length - 1];
  const cappedCount = Math.min(learnedCount, finalBand.max);

  return bands.map((band) => {
    const bandSize = Math.max(1, band.max - band.min);
    const completedInBand = Math.max(0, Math.min(cappedCount, band.max) - band.min);
    const percent = learnedCount >= band.max
      ? 100
      : Math.max(0, Math.min(100, (completedInBand / bandSize) * 100));

    if (learnedCount >= band.max) {
      return {
        label: band.label,
        range: formatBandRange(band),
        status: "Completed",
        percent,
        detail: `${formatNumber(bandSize)} of ${formatNumber(bandSize)} lemmas covered in this range.`,
        ariaLabel: `${band.label} CEFR ladder progress`,
        tone: "completed" as const,
      };
    }

    if (learnedCount >= band.min) {
      return {
        label: band.label,
        range: formatBandRange(band),
        status: "Entered",
        percent,
        detail: `${formatNumber(completedInBand)} of ${formatNumber(bandSize)} lemmas covered in this range.`,
        ariaLabel: `${band.label} CEFR ladder progress`,
        tone: "active" as const,
      };
    }

    return {
      label: band.label,
      range: formatBandRange(band),
      status: "Not yet",
      percent: 0,
      detail: `Begins at ${formatNumber(band.min)} mastered lemmas.`,
      ariaLabel: `${band.label} CEFR ladder progress`,
      tone: "pending" as const,
    };
  });
}

function getHeroProgressLabel(progress: CefrProgress) {
  if (!progress.next) {
    return `Top range covered with ${formatNumber(progress.displayCount)} tracked lemmas`;
  }

  return `${formatNumber(progress.completedInBand)} of ${formatNumber(
    progress.bandSize,
  )} lemmas through ${progress.current.label}, ${formatNumber(
    progress.remainingInBand,
  )} to ${progress.next.label}`;
}

function formatBandRange(band: CefrBand) {
  return `${formatNumber(band.min)}-${formatNumber(band.max)} lemmas`;
}

function formatNumber(value: number) {
  return value.toLocaleString();
}
