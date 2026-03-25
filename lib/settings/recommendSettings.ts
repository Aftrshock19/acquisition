import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { RecommendedSettings, RecommendedTypes } from './types';

export async function recommendSettings(): Promise<RecommendedSettings> {
  const supabase = await createSupabaseServerClient();

  // Start from simple defaults
  let recommendedDailyLimit = 30;
  let types: RecommendedTypes = {
    cloze: true,
    normal: true,
    audio: false,
    mcq: false,
    sentences: false,
  };

  if (!supabase) {
    return { recommendedDailyLimit, recommendedTypes: types };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { recommendedDailyLimit, recommendedTypes: types };
  }

  // Cheap heuristics: backlog size and recent accuracy
  const [{ count: dueCount }, { data: recentEvents }] = await Promise.all([
    supabase
      .from('user_words')
      .select('word_id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .lte('due_at', new Date().toISOString()),
    supabase
      .from('review_events')
      .select('correct')
      .eq('user_id', user.id)
      .order('happened_at', { ascending: false })
      .limit(100),
  ]);

  const backlog = dueCount ?? 0;
  const events = (recentEvents ?? []) as { correct: boolean }[];

  let accuracy = 0.9;
  if (events.length > 0) {
    const correctCount = events.filter((e) => e.correct).length;
    accuracy = correctCount / events.length;
  }

  // Adjust daily limit based on backlog and accuracy
  if (backlog > 200 || accuracy < 0.7) {
    recommendedDailyLimit = 20;
  } else if (backlog > 100 || accuracy < 0.8) {
    recommendedDailyLimit = 25;
  } else if (backlog < 50 && accuracy > 0.9) {
    recommendedDailyLimit = 40;
  }

  // Clamp
  recommendedDailyLimit = Math.min(200, Math.max(10, recommendedDailyLimit));

  // Very simple type rules based on rough "experience" proxy
  const totalReviews = events.length;
  if (totalReviews < 50) {
    types = { cloze: false, normal: true, audio: false, mcq: true, sentences: false };
  } else if (totalReviews < 200) {
    types = { cloze: true, normal: true, audio: false, mcq: true, sentences: false };
  } else {
    types = { cloze: true, normal: true, audio: false, mcq: true, sentences: true };
  }

  return { recommendedDailyLimit, recommendedTypes: types };
}
