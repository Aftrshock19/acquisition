import { NextRequest, NextResponse } from "next/server";
import { clampSessionDateRange } from "@/lib/analytics/date";
import {
  anonymizeUserId,
  buildJsonExport,
  getExportRows,
  logExportRun,
  toCsv,
  type ExportDataset,
} from "@/lib/analytics/export";
import { getUserAnalyticsBundle } from "@/lib/analytics/service";
import { getSupabaseUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  const { user, error: authError } = await getSupabaseUser(supabase);
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const format = searchParams.get("format") === "csv" ? "csv" : "json";
  const dataset = parseDataset(searchParams.get("dataset"));
  const range = clampSessionDateRange(
    searchParams.get("from"),
    searchParams.get("to"),
    14,
  );
  const anonymousUserId = anonymizeUserId(user.id);

  await logExportRun(supabase, user.id, {
    anonymousUserId,
    format,
    dataset,
    dateFrom: range.from,
    dateTo: range.to,
  });
  const bundle = await getUserAnalyticsBundle(supabase, user.id, range);

  if (format === "csv") {
    if (dataset === "all") {
      return NextResponse.json(
        {
          error: "CSV export requires a specific dataset. Use JSON for the full export bundle.",
        },
        { status: 400 },
      );
    }

    const rows = getExportRows(dataset, bundle, anonymousUserId);
    const csv = toCsv(dataset, rows);
    const filename = `acquisition-${dataset}-${range.from}-to-${range.to}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const payload = buildJsonExport(bundle, anonymousUserId);
  const filename =
    dataset === "all"
      ? `acquisition-metrics-${range.from}-to-${range.to}.json`
      : `acquisition-${dataset}-${range.from}-to-${range.to}.json`;

  if (dataset === "all") {
    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json(
    {
      format_version: payload.format_version,
      exported_at: payload.exported_at,
      app_session_time_zone: payload.app_session_time_zone,
      anonymous_user_id: payload.anonymous_user_id,
      range: payload.range,
      dataset,
      rows: getExportRows(dataset, bundle, anonymousUserId),
    },
    {
      status: 200,
      headers: {
        "content-disposition": `attachment; filename="${filename}"`,
      },
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
