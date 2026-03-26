'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { normalizeUserSettingsInput, type RawSettingsInput } from '@/lib/settings/normalizeUserSettingsInput';
import type { UserSettingsRow } from '@/lib/settings/types';
import { revalidatePath } from 'next/cache';

export type UpdateUserSettingsResult = { ok: true } | { ok: false; error: string };

export async function updateUserSettingsAction(
  input: RawSettingsInput,
): Promise<UpdateUserSettingsResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Not authenticated' };
  }

  let payload: Partial<UserSettingsRow>;
  try {
    payload = normalizeUserSettingsInput(input);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Invalid settings';
    return { ok: false, error: message };
  }

  // Always ensure user_id is set for upsert
  const row: Partial<UserSettingsRow> = {
    user_id: user.id,
    learning_lang: 'es',
    ...payload,
  };

  let { error } = await supabase
    .from('user_settings')
    .upsert(row, { onConflict: 'user_id' });

  if (isMissingDirectionColumnError(error?.message)) {
    ({ error } = await supabase
      .from('user_settings')
      .upsert(stripDirectionFields(row), { onConflict: 'user_id' }));
  }

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath('/');
  revalidatePath('/settings');
  revalidatePath('/today');

  return { ok: true };
}

function isMissingDirectionColumnError(message?: string) {
  if (!message) return false;
  return (
    message.includes("include_cloze_en_to_es")
    || message.includes("include_cloze_es_to_en")
    || message.includes("include_normal_en_to_es")
    || message.includes("include_normal_es_to_en")
  );
}

function stripDirectionFields(
  row: Partial<UserSettingsRow>,
): Partial<UserSettingsRow> {
  const next = { ...row };
  delete next.include_cloze_en_to_es;
  delete next.include_cloze_es_to_en;
  delete next.include_normal_en_to_es;
  delete next.include_normal_es_to_en;
  return next;
}
