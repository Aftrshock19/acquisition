import { BackButton } from "@/components/BackButton";
import { requireResearcher } from "@/lib/admin/auth";
import { getPassageCounts, getPassageIndex } from "@/lib/reading/passages";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ReadingStageGroup } from "@/lib/reading/types";

export default async function AdminReadingPage() {
  const auth = await requireResearcher();
  if (!auth.ok) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Reading Passages</h1>
          <p className="app-subtitle">{auth.error}</p>
        </section>
      </main>
    );
  }

  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Reading Passages</h1>
          <p className="app-subtitle">
            SUPABASE_SERVICE_ROLE_KEY is not configured.
          </p>
        </section>
      </main>
    );
  }

  let counts = { passages: 0, questions: 0, stages: 0 };
  let stageGroups: ReadingStageGroup[] = [];

  try {
    [counts, stageGroups] = await Promise.all([
      getPassageCounts(serviceClient),
      getPassageIndex(serviceClient),
    ]);
  } catch (err) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Reading Passages</h1>
          <p className="app-subtitle">
            Error loading data:{" "}
            {err instanceof Error ? err.message : "Unknown error"}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <BackButton />
      <section className="app-hero">
        <h1 className="app-title">Reading Passages</h1>
        <p className="app-subtitle">
          Content overview for graded reading passages and comprehension
          questions.
        </p>
      </section>

      {/* Summary stats */}
      <section className="app-card-strong flex flex-wrap gap-6 p-6">
        <Stat label="Stages" value={counts.stages} />
        <Stat label="Passages" value={counts.passages} />
        <Stat label="Questions" value={counts.questions} />
      </section>

      {/* Per-stage breakdown */}
      {stageGroups.length === 0 ? (
        <section className="app-card flex flex-col gap-3 p-8">
          <h2 className="text-xl font-semibold tracking-tight">
            No passages imported
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Run{" "}
            <code className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">
              npx tsx scripts/import_reading_passages.ts
            </code>{" "}
            to import all_passages_renamed/ into the database.
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          {stageGroups.map((group) => (
            <StageCard key={group.stage} group={group} />
          ))}
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums text-zinc-950 dark:text-zinc-50">
        {value}
      </span>
    </div>
  );
}

function StageCard({ group }: { group: ReadingStageGroup }) {
  const totalPassages = group.modes.reduce(
    (sum, m) => sum + m.passages.length,
    0,
  );

  return (
    <section className="app-card flex flex-col gap-3 p-5">
      <div className="flex items-baseline gap-3">
        <span className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs dark:border-zinc-800">
          {group.displayLabel}
        </span>
        <h2 className="text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {group.stage}
        </h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {totalPassages} passage{totalPassages !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-zinc-600 dark:text-zinc-300">
        {group.modes.map((m) => (
          <span key={m.mode} className="rounded bg-zinc-100 px-2 py-1 dark:bg-zinc-800/80">
            {m.mode.replace("_", " ")}: {m.passages.length}
          </span>
        ))}
      </div>
    </section>
  );
}
