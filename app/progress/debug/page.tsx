import Link from "next/link";
import { BackButton } from "@/components/BackButton";
import { clampSessionDateRange, formatSessionDateLabel } from "@/lib/analytics/date";
import { getConsistencyIssues } from "@/lib/analytics/consistency";
import { getUserAnalyticsBundle } from "@/lib/analytics/service";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ProgressDebugPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const range = clampSessionDateRange(
    getSearchParamValue(resolvedSearchParams.from),
    getSearchParamValue(resolvedSearchParams.to),
    14,
  );
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Consistency checks</h1>
          <p className="app-subtitle">Supabase is not configured.</p>
        </section>
      </main>
    );
  }

  const { user, error } = await getSupabaseUser(supabase);
  if (error) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Consistency checks</h1>
          <p className="app-subtitle">{error}</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Consistency checks</h1>
          <p className="app-subtitle">Sign in to inspect the current export range.</p>
        </section>
      </main>
    );
  }

  const bundle = await getUserAnalyticsBundle(supabase, user.id, range);
  const issues = getConsistencyIssues(bundle, user.id);

  return (
    <main className="app-shell">
      <BackButton href={`/progress?from=${range.from}&to=${range.to}`} />

      <section className="app-hero">
        <h1 className="app-title">Consistency checks</h1>
        <p className="app-subtitle">
          {formatSessionDateLabel(range.from)} to {formatSessionDateLabel(range.to)}
        </p>
      </section>

      <section className="app-card flex flex-col gap-4 p-5 sm:p-6">
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          These checks run on the same analytics bundle used by the progress page and export route.
        </p>
        <Link
          href={`/api/progress/export?dataset=all&format=json&from=${range.from}&to=${range.to}`}
          className="app-button self-start"
        >
          Download matching JSON bundle
        </Link>
      </section>

      {issues.length === 0 ? (
        <section className="app-card-strong flex flex-col gap-3 p-8">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            No issues detected
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            The current user data passed the implemented consistency checks for this range.
          </p>
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          {issues.map((issue) => (
            <section
              key={issue.id}
              className={`app-card flex flex-col gap-4 p-5 sm:p-6 ${
                issue.severity === "error"
                  ? "border-red-200 bg-red-50/80 dark:border-red-900/50 dark:bg-red-950/20"
                  : "border-amber-200 bg-amber-50/80 dark:border-amber-900/50 dark:bg-amber-950/20"
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-white dark:bg-zinc-100 dark:text-zinc-900">
                  {issue.severity}
                </span>
                <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                  {issue.message}
                </h2>
              </div>
              <ul className="list-disc pl-5 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
                {issue.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function getSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
