import { NextRequest, NextResponse } from "next/server";
import { requireResearcher } from "@/lib/admin/auth";
import { clampSessionDateRange, getAppSessionTimeZone } from "@/lib/analytics/date";
import {
  anonymizeUserId,
  buildJsonExport,
  getExportRows,
  logExportRun,
  toCsv,
  type ExportDataset,
} from "@/lib/analytics/export";
import { EXPORT_FORMAT_VERSION, METRIC_DEFINITIONS } from "@/lib/analytics/metricDefinitions";
import { getUserAnalyticsBundle } from "@/lib/analytics/service";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const CSV_DATASETS: Array<Exclude<ExportDataset, "all">> = [
  "daily_aggregates",
  "sessions",
  "review_events",
  "reading_events",
  "listening_events",
  "saved_words",
  "reading_question_attempts",
  "export_runs",
];

type Enrollment = {
  user_id: string;
  participant_id: string;
  enrolled_at: string;
};

export async function GET(request: NextRequest) {
  // 1. Researcher access control
  const auth = await requireResearcher();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // 2. Service role client for cross-user queries
  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not configured." },
      { status: 503 },
    );
  }

  // 3. Parse query params
  const searchParams = request.nextUrl.searchParams;
  const format = searchParams.get("format") === "csv" ? "csv" : "json";
  const dataset = parseDataset(searchParams.get("dataset"));
  const cohortKey = searchParams.get("cohort") ?? "default";
  const range = clampSessionDateRange(
    searchParams.get("from"),
    searchParams.get("to"),
    14,
  );

  // 4. Fetch enrolled participants
  const { data: enrollments, error: enrollError } = await serviceClient
    .from("study_enrollments")
    .select("user_id, participant_id, enrolled_at")
    .eq("cohort_key", cohortKey)
    .order("enrolled_at", { ascending: true });

  if (enrollError) {
    return NextResponse.json(
      { error: `Failed to fetch enrollments: ${enrollError.message}` },
      { status: 500 },
    );
  }

  if (!enrollments || enrollments.length === 0) {
    return NextResponse.json(
      { error: `No participants enrolled in cohort "${cohortKey}".` },
      { status: 404 },
    );
  }

  // 5. Build per-participant analytics bundles
  const participants = enrollments as Enrollment[];
  const participantBundles = await Promise.all(
    participants.map(async (enrollment) => {
      const bundle = await getUserAnalyticsBundle(
        serviceClient,
        enrollment.user_id,
        range,
      );
      return {
        participant_id: enrollment.participant_id,
        user_id: enrollment.user_id,
        bundle,
      };
    }),
  );

  // 6. Log the export run (under the researcher's own user)
  const researcherAnonId = anonymizeUserId(auth.user.id);
  await logExportRun(serviceClient, auth.user.id, {
    anonymousUserId: researcherAnonId,
    format,
    dataset,
    dateFrom: range.from,
    dateTo: range.to,
  });

  // 7. Build response
  if (format === "csv") {
    if (dataset === "all") {
      return NextResponse.json(
        { error: "CSV export requires a specific dataset. Use JSON for the full export bundle." },
        { status: 400 },
      );
    }

    const allRows: Record<string, unknown>[] = [];
    for (const { participant_id, bundle } of participantBundles) {
      const rows = getExportRows(dataset, bundle, participant_id);
      allRows.push(...rows);
    }

    const csv = toCsv(dataset, allRows);
    const filename = `cohort-${cohortKey}-${dataset}-${range.from}-to-${range.to}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // JSON format: full cohort bundle
  if (dataset === "all") {
    const payload = {
      format_version: EXPORT_FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      app_session_time_zone: getAppSessionTimeZone(),
      cohort_key: cohortKey,
      range,
      participant_count: participants.length,
      metric_definitions: METRIC_DEFINITIONS,
      participants: participantBundles.map(({ participant_id, bundle }) => ({
        ...buildJsonExport(bundle, participant_id),
        anonymous_user_id: participant_id,
      })),
    };

    const filename = `cohort-${cohortKey}-metrics-${range.from}-to-${range.to}.json`;
    return NextResponse.json(payload, {
      status: 200,
      headers: { "content-disposition": `attachment; filename="${filename}"` },
    });
  }

  // JSON format: specific dataset
  const allRows: Record<string, unknown>[] = [];
  for (const { participant_id, bundle } of participantBundles) {
    const rows = getExportRows(dataset, bundle, participant_id);
    allRows.push(...rows);
  }

  const filename = `cohort-${cohortKey}-${dataset}-${range.from}-to-${range.to}.json`;
  return NextResponse.json(
    {
      format_version: EXPORT_FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      app_session_time_zone: getAppSessionTimeZone(),
      cohort_key: cohortKey,
      range,
      participant_count: participants.length,
      dataset,
      rows: allRows,
    },
    {
      status: 200,
      headers: { "content-disposition": `attachment; filename="${filename}"` },
    },
  );
}

function parseDataset(value: string | null): ExportDataset {
  if (value === "all" || value === null) {
    return "all";
  }
  if (CSV_DATASETS.includes(value as Exclude<ExportDataset, "all">)) {
    return value as Exclude<ExportDataset, "all">;
  }
  return "all";
}
