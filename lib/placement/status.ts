import { getSupabaseServerContext } from "@/lib/supabase/server";

export type PlacementBannerState = {
  show: boolean;
  hasActiveRun: boolean;
  status: string | null;
};

export async function getPlacementBannerState(): Promise<PlacementBannerState> {
  const { supabase, user } = await getSupabaseServerContext();
  if (!supabase || !user) return { show: false, hasActiveRun: false, status: null };

  const [{ data: settings }, { data: activeRuns }] = await Promise.all([
    supabase
      .from("user_settings")
      .select("placement_status, current_frontier_rank")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("baseline_test_runs")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["in_progress", "not_started"])
      .limit(1),
  ]);

  const status = (settings?.placement_status as string | null) ?? null;
  const hasFrontier = settings?.current_frontier_rank != null;
  const hasActiveRun = (activeRuns?.length ?? 0) > 0;

  return {
    show: hasActiveRun || (!hasFrontier && status !== "unknown"),
    hasActiveRun,
    status,
  };
}
