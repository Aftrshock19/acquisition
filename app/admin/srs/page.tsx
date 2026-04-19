import { BackButton } from "@/components/BackButton";
import { requireResearcher } from "@/lib/admin/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  computeWorkloadPolicy,
  P50_FALLBACK_MS,
} from "@/lib/srs/workloadPolicy";

type SrsStateRow = { srs_state: string; count: number };
type OutcomeRow = { scheduler_outcome: string | null; count: number };
type FirstTryRow = { first_try: boolean | null; count: number };
type StabilityRow = {
  bucket: string;
  count: number;
};
type RecentReviewRow = {
  word_id: string;
  lemma: string;
  srs_state: string;
  difficulty: number;
  stability_days: number;
  learned_level: number;
  consecutive_first_try_correct: number;
  next_due: string;
  last_result: string | null;
  scheduler_outcome: string | null;
  submitted_at: string | null;
};

export default async function SrsSanityPage() {
  const auth = await requireResearcher();
  if (!auth.ok) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">SRS Sanity Check</h1>
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
          <h1 className="app-title">SRS Sanity Check</h1>
          <p className="app-subtitle">SUPABASE_SERVICE_ROLE_KEY is not configured.</p>
        </section>
      </main>
    );
  }

  // 1. Distribution of user_words by srs_state
  const { data: srsStateRows } = await serviceClient.rpc("query_srs_state_distribution" as never).select("*") as { data: SrsStateRow[] | null };
  // Fallback: raw query via service client if RPC not defined
  const { data: srsStateDirect } = await serviceClient
    .from("user_words")
    .select("srs_state")
    .limit(10000) as { data: Array<{ srs_state: string }> | null };

  const srsStateCounts = countBy(srsStateDirect ?? [], (r) => r.srs_state);

  // 2. Scheduler outcome distribution (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fromDate = thirtyDaysAgo.toISOString().slice(0, 10);

  const { data: outcomeRows } = await serviceClient
    .from("review_events")
    .select("scheduler_outcome")
    .gte("session_date", fromDate)
    .limit(50000) as { data: Array<{ scheduler_outcome: string | null }> | null };

  const outcomeCounts = countBy(outcomeRows ?? [], (r) => r.scheduler_outcome ?? "(null/legacy)");

  // 3. first_try vs rescued (last 30 days)
  const { data: firstTryRows } = await serviceClient
    .from("review_events")
    .select("first_try, correct")
    .gte("session_date", fromDate)
    .eq("correct", true)
    .limit(50000) as { data: Array<{ first_try: boolean | null; correct: boolean }> | null };

  const firstTryCorrect = (firstTryRows ?? []).filter((r) => r.first_try === true).length;
  const rescuedCorrect = (firstTryRows ?? []).filter((r) => r.first_try === false).length;

  // 4. Stability distribution buckets
  const { data: stabilityRows } = await serviceClient
    .from("user_words")
    .select("stability_days")
    .limit(10000) as { data: Array<{ stability_days: number }> | null };

  const stabilityBuckets = buildStabilityBuckets(stabilityRows ?? []);

  // 5. Difficulty stats
  const diffValues = (stabilityRows ?? []).map(() => 0); // placeholder — we'll reuse the stability query
  const { data: diffRows } = await serviceClient
    .from("user_words")
    .select("difficulty, stability_days")
    .limit(10000) as { data: Array<{ difficulty: number; stability_days: number }> | null };

  const diffs = (diffRows ?? []).map((r) => r.difficulty).filter((d) => d != null);
  const stabs = (diffRows ?? []).map((r) => r.stability_days).filter((s) => s != null);
  const diffStats = numericStats(diffs);
  const stabStats = numericStats(stabs);

  // 6. Workload policy diagnostics (scoped to researcher's own account)
  const researcherUserId = auth.user.id;
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const sixtyDaysAgoIso = sixtyDaysAgo.toISOString();

  const { data: p50Rows } = await serviceClient
    .from("review_events")
    .select("ms_spent")
    .eq("user_id", researcherUserId)
    .eq("correct", true)
    .not("ms_spent", "is", null)
    .gt("ms_spent", 0)
    .lt("ms_spent", 120000)
    .gte("created_at", sixtyDaysAgoIso)
    .limit(200) as { data: Array<{ ms_spent: number }> | null };

  const p50Values = (p50Rows ?? []).map((r) => r.ms_spent).filter(Boolean).sort((a, b) => a - b);
  const p50ReviewMs = p50Values.length > 0
    ? (p50Values[Math.floor(p50Values.length / 2)] ?? null)
    : null;

  const today = new Date().toISOString().slice(0, 10);
  const { data: lastSessionRows } = await serviceClient
    .from("daily_sessions")
    .select("session_date")
    .eq("user_id", researcherUserId)
    .lt("session_date", today)
    .order("session_date", { ascending: false })
    .limit(1) as { data: Array<{ session_date: string }> | null };

  const lastSessionDate = (lastSessionRows ?? [])[0]?.session_date ?? null;
  const daysSinceLastSession = lastSessionDate
    ? Math.floor((new Date(today).getTime() - new Date(lastSessionDate).getTime()) / 86400000)
    : null;

  const { count: overdueCount } = await serviceClient
    .from("user_words")
    .select("word_id", { count: "exact", head: true })
    .eq("user_id", researcherUserId)
    .lte("next_due", new Date().toISOString())
    .not("last_review_at", "is", null);

  const workloadPolicy = computeWorkloadPolicy({
    p50ReviewMs,
    daysSinceLastSession,
    overdueCount: overdueCount ?? 0,
    scheduledNewCount: 10,
  });

  // 8. Recent reviews with state
  const { data: recentRaw } = await serviceClient
    .from("review_events")
    .select("word_id, submitted_at, scheduler_outcome, correct, first_try")
    .order("submitted_at", { ascending: false })
    .limit(20) as { data: Array<{ word_id: string; submitted_at: string | null; scheduler_outcome: string | null; correct: boolean; first_try: boolean | null }> | null };

  const wordIds = [...new Set((recentRaw ?? []).map((r) => r.word_id))];
  const { data: wordData } = wordIds.length
    ? await serviceClient
        .from("user_words")
        .select("word_id, srs_state, difficulty, stability_days, learned_level, consecutive_first_try_correct, next_due, last_result")
        .in("word_id", wordIds.slice(0, 20))
    : { data: [] };

  const { data: lemmaData } = wordIds.length
    ? await serviceClient
        .from("words")
        .select("id, lemma")
        .in("id", wordIds.slice(0, 20))
    : { data: [] };

  const wordMap = new Map((wordData ?? []).map((r) => [r.word_id, r as Record<string, unknown>]));
  const lemmaMap = new Map((lemmaData ?? []).map((r: { id: string; lemma: string }) => [r.id, r.lemma]));

  const recentReviews: RecentReviewRow[] = (recentRaw ?? []).map((ev) => {
    const uw = wordMap.get(ev.word_id) ?? {};
    return {
      word_id: ev.word_id,
      lemma: lemmaMap.get(ev.word_id) ?? ev.word_id.slice(0, 8),
      srs_state: String(uw.srs_state ?? "–"),
      difficulty: Number(uw.difficulty ?? 0),
      stability_days: Number(uw.stability_days ?? 0),
      learned_level: Number(uw.learned_level ?? 0),
      consecutive_first_try_correct: Number(uw.consecutive_first_try_correct ?? 0),
      next_due: String(uw.next_due ?? "–"),
      last_result: String(uw.last_result ?? "–"),
      scheduler_outcome: ev.scheduler_outcome,
      submitted_at: ev.submitted_at,
    };
  });

  void srsStateRows; // unused (direct query used instead)

  return (
    <main className="app-shell">
      <BackButton />
      <section className="app-hero">
        <h1 className="app-title">SRS Sanity Check</h1>
        <p className="app-subtitle" style={{ fontSize: "0.8rem", opacity: 0.6 }}>
          Research / developer view — not shown to participants
        </p>
      </section>

      <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "2rem" }}>

        {/* Workload policy */}
        <section>
          <h2 style={h2}>Workload policy (your account)</h2>
          <table style={tableStyle}>
            <thead><tr style={thRow}><th style={td}>metric</th><th style={td}>value</th></tr></thead>
            <tbody>
              <tr style={trRow}><td style={td}>p50 review speed</td><td style={td}>{p50ReviewMs != null ? `${p50ReviewMs} ms` : `${P50_FALLBACK_MS} ms (fallback)`}</td></tr>
              <tr style={trRow}><td style={td}>days since last session</td><td style={td}>{daysSinceLastSession ?? "—"}</td></tr>
              <tr style={trRow}><td style={td}>overdue reviews</td><td style={td}>{overdueCount ?? 0}</td></tr>
              <tr style={trRow}><td style={td}>isComeback</td><td style={td}>{workloadPolicy.isComeback ? "yes" : "no"}</td></tr>
              <tr style={trRow}><td style={td}>recommended reviews</td><td style={td}>{workloadPolicy.recommendedReviews}</td></tr>
              <tr style={trRow}><td style={td}>recommended new words</td><td style={td}>{workloadPolicy.recommendedNewWords}</td></tr>
              <tr style={trRow}><td style={td}>continuation review chunk</td><td style={td}>{workloadPolicy.continuationReviewChunk}</td></tr>
              <tr style={trRow}><td style={td}>continuation new chunk</td><td style={td}>{workloadPolicy.continuationNewChunk}</td></tr>
            </tbody>
          </table>
        </section>

        {/* srs_state distribution */}
        <section>
          <h2 style={h2}>Word states (all users)</h2>
          <table style={tableStyle}>
            <thead><tr style={thRow}><th style={td}>srs_state</th><th style={td}>words</th></tr></thead>
            <tbody>
              {Object.entries(srsStateCounts).sort().map(([state, n]) => (
                <tr key={state} style={trRow}><td style={td}>{state}</td><td style={td}>{n}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Difficulty + stability stats */}
        <section>
          <h2 style={h2}>Scheduler state stats (all words)</h2>
          <table style={tableStyle}>
            <thead><tr style={thRow}><th style={td}>metric</th><th style={td}>mean</th><th style={td}>median</th><th style={td}>min</th><th style={td}>max</th></tr></thead>
            <tbody>
              <tr style={trRow}>
                <td style={td}>difficulty</td>
                <td style={td}>{fmt(diffStats.mean)}</td>
                <td style={td}>{fmt(diffStats.median)}</td>
                <td style={td}>{fmt(diffStats.min)}</td>
                <td style={td}>{fmt(diffStats.max)}</td>
              </tr>
              <tr style={trRow}>
                <td style={td}>stability_days</td>
                <td style={td}>{fmt(stabStats.mean)}</td>
                <td style={td}>{fmt(stabStats.median)}</td>
                <td style={td}>{fmt(stabStats.min)}</td>
                <td style={td}>{fmt(stabStats.max)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Stability buckets */}
        <section>
          <h2 style={h2}>Stability buckets (days)</h2>
          <table style={tableStyle}>
            <thead><tr style={thRow}><th style={td}>bucket</th><th style={td}>words</th></tr></thead>
            <tbody>
              {stabilityBuckets.map(({ bucket, count }) => (
                <tr key={bucket} style={trRow}><td style={td}>{bucket}</td><td style={td}>{count}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Scheduler outcomes */}
        <section>
          <h2 style={h2}>Scheduler outcomes (last 30 days)</h2>
          <table style={tableStyle}>
            <thead><tr style={thRow}><th style={td}>outcome</th><th style={td}>events</th></tr></thead>
            <tbody>
              {Object.entries(outcomeCounts).sort().map(([outcome, n]) => (
                <tr key={outcome} style={trRow}><td style={td}>{outcome}</td><td style={td}>{n}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* First-try vs rescued */}
        <section>
          <h2 style={h2}>Correct answers: first-try vs rescued (last 30 days)</h2>
          <table style={tableStyle}>
            <thead><tr style={thRow}><th style={td}>type</th><th style={td}>count</th></tr></thead>
            <tbody>
              <tr style={trRow}><td style={td}>first_try correct</td><td style={td}>{firstTryCorrect}</td></tr>
              <tr style={trRow}><td style={td}>rescued correct</td><td style={td}>{rescuedCorrect}</td></tr>
            </tbody>
          </table>
        </section>

        {/* Recent reviews */}
        <section>
          <h2 style={h2}>Recent 20 review events</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr style={thRow}>
                  <th style={td}>word</th>
                  <th style={td}>outcome</th>
                  <th style={td}>srs_state</th>
                  <th style={td}>difficulty</th>
                  <th style={td}>stability</th>
                  <th style={td}>level</th>
                  <th style={td}>streak</th>
                  <th style={td}>next_due</th>
                  <th style={td}>submitted</th>
                </tr>
              </thead>
              <tbody>
                {recentReviews.map((r, i) => (
                  <tr key={i} style={trRow}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.lemma}</td>
                    <td style={td}>{r.scheduler_outcome ?? "–"}</td>
                    <td style={td}>{r.srs_state}</td>
                    <td style={td}>{fmt(r.difficulty)}</td>
                    <td style={td}>{fmt(r.stability_days)}d</td>
                    <td style={td}>{r.learned_level}</td>
                    <td style={td}>{r.consecutive_first_try_correct}</td>
                    <td style={td}>{r.next_due.slice(0, 10)}</td>
                    <td style={td}>{r.submitted_at ? r.submitted_at.slice(0, 16).replace("T", " ") : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countBy<T>(arr: T[], key: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of arr) {
    const k = key(item);
    result[k] = (result[k] ?? 0) + 1;
  }
  return result;
}

function buildStabilityBuckets(rows: Array<{ stability_days: number }>): StabilityRow[] {
  const buckets = [
    { label: "0", min: 0, max: 0.001 },
    { label: "< 1", min: 0.001, max: 1 },
    { label: "1–2", min: 1, max: 2 },
    { label: "2–7", min: 2, max: 7 },
    { label: "7–30", min: 7, max: 30 },
    { label: "30–90", min: 30, max: 90 },
    { label: "90–180", min: 90, max: 180 },
    { label: "180–365", min: 180, max: 365 },
    { label: "> 365", min: 365, max: Infinity },
  ];
  return buckets.map(({ label, min, max }) => ({
    bucket: label,
    count: rows.filter((r) => r.stability_days >= min && r.stability_days < max).length,
  }));
}

function numericStats(values: number[]) {
  if (values.length === 0) return { mean: null, median: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return { mean, median, min: sorted[0]!, max: sorted[sorted.length - 1]! };
}

function fmt(n: number | null | undefined) {
  if (n == null) return "–";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  fontSize: "0.8rem",
  width: "100%",
  maxWidth: "640px",
};
const h2: React.CSSProperties = {
  fontSize: "0.9rem",
  fontWeight: 600,
  marginBottom: "0.5rem",
};
const td: React.CSSProperties = {
  padding: "0.3rem 0.6rem",
  textAlign: "left",
  borderBottom: "1px solid var(--border, #333)",
};
const thRow: React.CSSProperties = {
  borderBottom: "2px solid var(--border, #555)",
  fontWeight: 700,
};
const trRow: React.CSSProperties = {};
