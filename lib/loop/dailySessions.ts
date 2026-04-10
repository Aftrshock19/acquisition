import { getAppSessionDate } from "@/lib/analytics/date";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DailySessionRow } from "@/lib/srs/types";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

export function getTodaySessionDate() {
  return getAppSessionDate();
}

export async function getTodayDailySessionRow(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<DailySessionRow | null> {
  const { data, error } = await supabase
    .from("daily_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("session_date", getTodaySessionDate())
    .maybeSingle();

  if (error) {
    return null;
  }

  return data as DailySessionRow | null;
}
