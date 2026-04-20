import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserSettingsRow } from "@/lib/settings/types";
import { getPassageIndex } from "@/lib/reading/passages";
import { getListeningIndexData } from "@/lib/loop/listening";
import { getReadingRecommendation } from "@/lib/reading/recommendation";
import { getListeningRecommendation } from "@/lib/listening/recommendation";

export type RecommendationKind = "reading" | "listening";

export type ProgressStatus = "in_progress" | "completed";

export type DailyRecommendationResult = {
  assetId: string;
  status: ProgressStatus | null;
};

type Supabase = SupabaseClient;

/**
 * Returns YYYY-MM-DD for the given IANA timezone. Falls back to UTC on
 * invalid zone names (Intl throws RangeError for those).
 */
export function getLocalDate(tz: string | null | undefined): string {
  const zone = tz && tz.length > 0 ? tz : "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
  }
}

const PROGRESS_TABLE: Record<RecommendationKind, { table: string; idColumn: string }> = {
  reading: { table: "reading_progress", idColumn: "text_id" },
  listening: { table: "listening_progress", idColumn: "asset_id" },
};

async function fetchExcludedIds(
  supabase: Supabase,
  userId: string,
  kind: RecommendationKind,
): Promise<Set<string>> {
  const { table, idColumn } = PROGRESS_TABLE[kind];
  const { data, error } = await supabase
    .from(table)
    .select(idColumn)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Record<string, string>[];
  return new Set(rows.map((r) => r[idColumn]!));
}

async function fetchProgressStatus(
  supabase: Supabase,
  userId: string,
  kind: RecommendationKind,
  assetId: string,
): Promise<ProgressStatus | null> {
  const { table, idColumn } = PROGRESS_TABLE[kind];
  const { data, error } = await supabase
    .from(table)
    .select("status")
    .eq("user_id", userId)
    .eq(idColumn, assetId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { status: string } | null;
  if (!row) return null;
  if (row.status === "in_progress" || row.status === "completed") return row.status;
  return null;
}

async function pickRecommendation(
  supabase: Supabase,
  kind: RecommendationKind,
  settings: UserSettingsRow,
  excluded: Set<string>,
): Promise<string | null> {
  if (kind === "reading") {
    const stages = await getPassageIndex(supabase);
    const passages = stages.flatMap((s) => s.modes.flatMap((m) => m.passages));
    const rec = getReadingRecommendation(passages, settings, excluded);
    return rec?.passage.id ?? null;
  }
  const assets = await getListeningIndexData(supabase);
  const rec = getListeningRecommendation(assets, settings, excluded);
  return rec?.asset.id ?? null;
}

async function selectDailyRow(
  supabase: Supabase,
  userId: string,
  kind: RecommendationKind,
  localDate: string,
): Promise<{ asset_id: string } | null> {
  const { data, error } = await supabase
    .from("daily_recommendation")
    .select("asset_id")
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("local_date", localDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { asset_id: string } | null) ?? null;
}

export async function getOrCreateDailyRecommendation(
  supabase: Supabase,
  userId: string,
  kind: RecommendationKind,
  settings: UserSettingsRow,
): Promise<DailyRecommendationResult> {
  const localDate = getLocalDate(settings.timezone);
  const userTag = userId.slice(0, 8);

  const existing = await selectDailyRow(supabase, userId, kind, localDate);
  if (existing) {
    console.log(`[daily-rec] user=${userTag} kind=${kind} branch=hot`);
    const status = await fetchProgressStatus(supabase, userId, kind, existing.asset_id);
    return { assetId: existing.asset_id, status };
  }

  const excluded = await fetchExcludedIds(supabase, userId, kind);
  const pickedId = await pickRecommendation(supabase, kind, settings, excluded);
  if (!pickedId) {
    throw new Error(
      `No eligible ${kind} content for user=${userId} at stage=${String(
        settings.current_frontier_rank ?? settings.self_certified_cefr_level ?? "?",
      )}. Pool size check needed.`,
    );
  }

  console.log(
    `[daily-rec] user=${userTag} kind=${kind} branch=cold pickedId=${pickedId.slice(0, 8)}`,
  );

  const { error: insertError } = await supabase
    .from("daily_recommendation")
    .insert({
      user_id: userId,
      kind,
      local_date: localDate,
      asset_id: pickedId,
    });

  // Ignore unique-constraint violations (race where another request inserted first).
  // Postgres error code 23505 = unique_violation.
  if (insertError && (insertError as { code?: string }).code !== "23505") {
    throw new Error(insertError.message);
  }

  let row = await selectDailyRow(supabase, userId, kind, localDate);
  if (!row) {
    console.log(
      `[daily-rec] user=${userTag} kind=${kind} post-insert row=null, retrying once`,
    );
    row = await selectDailyRow(supabase, userId, kind, localDate);
  }
  if (!row) {
    throw new Error(
      `daily_recommendation insert succeeded but re-select returned null for user=${userId} kind=${kind}. Possible transient stall.`,
    );
  }

  const status = await fetchProgressStatus(supabase, userId, kind, row.asset_id);
  return { assetId: row.asset_id, status };
}

export async function rerollDailyRecommendation(
  supabase: Supabase,
  userId: string,
  kind: RecommendationKind,
  settings: UserSettingsRow,
): Promise<{ assetId: string } | null> {
  const localDate = getLocalDate(settings.timezone);

  const existing = await selectDailyRow(supabase, userId, kind, localDate);
  if (!existing) return null;

  const status = await fetchProgressStatus(supabase, userId, kind, existing.asset_id);
  if (status !== "completed") {
    throw new Error("Daily recommendation can only be rerolled when completed");
  }

  const excluded = await fetchExcludedIds(supabase, userId, kind);
  const pickedId = await pickRecommendation(supabase, kind, settings, excluded);
  if (!pickedId) return null;

  const { error } = await supabase
    .from("daily_recommendation")
    .update({ asset_id: pickedId, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("kind", kind)
    .eq("local_date", localDate);
  if (error) throw new Error(error.message);

  return { assetId: pickedId };
}
