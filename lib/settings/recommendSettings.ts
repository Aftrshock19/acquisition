import { getSupabaseServerContext } from "@/lib/supabase/server";
import type { RecommendedSettings, RecommendedTypes } from "./types";

export async function recommendSettings(): Promise<RecommendedSettings> {
  let recommendedDailyLimit = 30;
  let types: RecommendedTypes = {
    cloze: true,
    normal: true,
    audio: false,
    mcq: false,
    sentences: false,
  };

  const { supabase, user } = await getSupabaseServerContext();
  if (!supabase || !user) {
    return { recommendedDailyLimit, recommendedTypes: types };
  }

  const [{ count: dueCount }, { data: recentEvents, error: eventsError }] = await Promise.all([
    supabase
      .from("user_words")
      .select("word_id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .lte("due_at", new Date().toISOString()),
    supabase
      .from("review_events")
      .select("correct")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (eventsError) {
    console.warn("[recommendSettings] review_events query failed", eventsError);
  }

  const backlog = dueCount ?? 0;
  const events = (recentEvents ?? []) as { correct: boolean }[];

  let accuracy = 0.9;
  if (events.length > 0) {
    const correctCount = events.filter((e) => e.correct).length;
    accuracy = correctCount / events.length;
  }

  if (backlog > 200 || accuracy < 0.7) {
    recommendedDailyLimit = 20;
  } else if (backlog > 100 || accuracy < 0.8) {
    recommendedDailyLimit = 25;
  } else if (backlog < 50 && accuracy > 0.9) {
    recommendedDailyLimit = 40;
  }

  recommendedDailyLimit = Math.min(200, Math.max(1, recommendedDailyLimit));

  const totalReviews = events.length;
  if (totalReviews < 50) {
    types = { cloze: true, normal: true, audio: false, mcq: true, sentences: false };
  } else if (totalReviews < 200) {
    types = { cloze: true, normal: true, audio: false, mcq: true, sentences: false };
  } else {
    types = { cloze: true, normal: true, audio: false, mcq: true, sentences: true };
  }

  return { recommendedDailyLimit, recommendedTypes: types };
}
