'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseUser } from '@/lib/supabase/auth';
import { rerollDailyRecommendation, type RecommendationKind } from '@/lib/recommendation/daily';
import type { UserSettingsRow } from '@/lib/settings/types';

export type RerollResult =
  | { ok: true; assetId: string }
  | { ok: false; error: string };

export async function rerollDailyRecommendationAction(
  kind: RecommendationKind,
): Promise<RerollResult> {
  if (kind !== 'reading' && kind !== 'listening') {
    return { ok: false, error: 'invalid_kind' };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, error: 'supabase_unavailable' };

  const { user, error: authError } = await getSupabaseUser(supabase);
  if (authError) return { ok: false, error: authError };
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: settingsData, error: settingsError } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (settingsError) return { ok: false, error: settingsError.message };
  if (!settingsData) return { ok: false, error: 'settings_missing' };

  const settings = settingsData as UserSettingsRow;

  try {
    const result = await rerollDailyRecommendation(supabase, user.id, kind, settings);
    if (!result) return { ok: false, error: 'no_candidates' };
    return { ok: true, assetId: result.assetId };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown_error';
    return { ok: false, error: message };
  }
}
