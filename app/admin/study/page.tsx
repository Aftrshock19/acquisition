import { BackButton } from "@/components/BackButton";
import { requireResearcher } from "@/lib/admin/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type Enrollment = {
  id: string;
  user_id: string;
  cohort_key: string;
  participant_id: string;
  enrolled_at: string;
};

export default async function StudyOpsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const cohortKey =
    (typeof resolvedParams.cohort === "string"
      ? resolvedParams.cohort
      : undefined) ?? "default";

  const auth = await requireResearcher();
  if (!auth.ok) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Study Operations</h1>
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
          <h1 className="app-title">Study Operations</h1>
          <p className="app-subtitle">
            SUPABASE_SERVICE_ROLE_KEY is not configured.
          </p>
        </section>
      </main>
    );
  }

  const { data: enrollments, error: fetchError } = await serviceClient
    .from("study_enrollments")
    .select("id, user_id, cohort_key, participant_id, enrolled_at")
    .eq("cohort_key", cohortKey)
    .order("enrolled_at", { ascending: true });

  if (fetchError) {
    return (
      <main className="app-shell">
        <BackButton />
        <section className="app-hero">
          <h1 className="app-title">Study Operations</h1>
          <p className="app-subtitle">
            Failed to load enrollments: {fetchError.message}
          </p>
        </section>
      </main>
    );
  }

  const rows = (enrollments ?? []) as Enrollment[];

  // Look up emails
  const enriched = await Promise.all(
    rows.map(async (row) => {
      const { data } = await serviceClient.auth.admin.getUserById(row.user_id);
      return { ...row, email: data?.user?.email ?? "unknown" };
    }),
  );

  // Count sessions per participant (last 14 days)
  const now = new Date();
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const fromDate = twoWeeksAgo.toISOString().slice(0, 10);
  const toDate = now.toISOString().slice(0, 10);

  const participantStats = await Promise.all(
    rows.map(async (row) => {
      const { count: sessionCount } = await serviceClient
        .from("daily_sessions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", row.user_id)
        .gte("session_date", fromDate)
        .lte("session_date", toDate)
        .not("started_at", "is", null);

      const { count: reviewCount } = await serviceClient
        .from("review_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", row.user_id)
        .gte("session_date", fromDate)
        .lte("session_date", toDate);

      return {
        participant_id: row.participant_id,
        sessions_14d: sessionCount ?? 0,
        reviews_14d: reviewCount ?? 0,
      };
    }),
  );

  const statsMap = new Map(
    participantStats.map((s) => [s.participant_id, s]),
  );

  return (
    <main className="app-shell">
      <BackButton />
      <section className="app-hero">
        <h1 className="app-title">Study Operations</h1>
        <p className="app-subtitle">
          Cohort: <strong>{cohortKey}</strong> &mdash; {rows.length} participant
          {rows.length !== 1 ? "s" : ""}
        </p>
      </section>

      {rows.length === 0 ? (
        <section style={{ padding: "1rem" }}>
          <p>No participants enrolled yet.</p>
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", opacity: 0.7 }}>
            Use <code>POST /api/admin/enroll</code> to enroll participants.
          </p>
        </section>
      ) : (
        <section style={{ padding: "1rem", overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.875rem",
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "2px solid var(--border, #333)",
                  textAlign: "left",
                }}
              >
                <th style={{ padding: "0.5rem" }}>ID</th>
                <th style={{ padding: "0.5rem" }}>Email</th>
                <th style={{ padding: "0.5rem" }}>Enrolled</th>
                <th style={{ padding: "0.5rem" }}>Sessions (14d)</th>
                <th style={{ padding: "0.5rem" }}>Reviews (14d)</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((row) => {
                const stats = statsMap.get(row.participant_id);
                return (
                  <tr
                    key={row.id}
                    style={{ borderBottom: "1px solid var(--border, #222)" }}
                  >
                    <td style={{ padding: "0.5rem", fontFamily: "monospace" }}>
                      {row.participant_id}
                    </td>
                    <td style={{ padding: "0.5rem" }}>{row.email}</td>
                    <td style={{ padding: "0.5rem" }}>
                      {new Date(row.enrolled_at).toLocaleDateString("en-GB")}
                    </td>
                    <td style={{ padding: "0.5rem", textAlign: "center" }}>
                      {stats?.sessions_14d ?? 0}
                    </td>
                    <td style={{ padding: "0.5rem", textAlign: "center" }}>
                      {stats?.reviews_14d ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: "1.5rem", fontSize: "0.875rem" }}>
            <h3>Export</h3>
            <p style={{ marginTop: "0.5rem" }}>
              Full JSON:{" "}
              <code>
                /api/admin/progress/export?format=json&amp;cohort={cohortKey}&amp;from={fromDate}&amp;to={toDate}
              </code>
            </p>
            <p style={{ marginTop: "0.25rem" }}>
              CSV (per dataset):{" "}
              <code>
                /api/admin/progress/export?format=csv&amp;dataset=daily_aggregates&amp;cohort={cohortKey}&amp;from={fromDate}&amp;to={toDate}
              </code>
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
