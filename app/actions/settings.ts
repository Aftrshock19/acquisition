'use server';

import { cookies } from 'next/headers';
import { getSupabaseUser } from '@/lib/supabase/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { normalizeUserSettingsInput, type RawSettingsInput } from '@/lib/settings/normalizeUserSettingsInput';
import {
  MCQ_QUESTION_FORMATS_COOKIE,
  parseMcqQuestionFormats,
  readRequestedMcqQuestionFormats,
  serializeMcqQuestionFormats,
} from '@/lib/settings/mcqQuestionFormats';
import type { UserSettingsRow } from '@/lib/settings/types';
import { revalidatePath } from 'next/cache';

export type UpdateUserSettingsResult = { ok: true } | { ok: false; error: string };
type UpdateUserSettingsInput = RawSettingsInput & {
  mcq_question_formats?: string;
};

const DEBUG_SETTINGS_KEYS = [
  'daily_plan_mode',
  'manual_daily_card_limit',
  'flashcard_selection_mode',
  'include_cloze',
  'include_normal',
  'include_audio',
  'include_mcq',
  'include_sentences',
  'include_cloze_en_to_es',
  'include_cloze_es_to_en',
  'include_normal_en_to_es',
  'include_normal_es_to_en',
  'retry_delay_seconds',
  'auto_advance_correct',
  'show_pos_hint',
  'show_definition_first',
  'hide_translation_sentences',
] as const;

export async function updateUserSettingsAction(
  input: UpdateUserSettingsInput,
): Promise<UpdateUserSettingsResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const { user, error: authError } = await getSupabaseUser(supabase);
  if (authError) {
    return { ok: false, error: authError };
  }

  if (!user) {
    return { ok: false, error: 'Not authenticated' };
  }

  let payload: Partial<UserSettingsRow>;
  const { mcq_question_formats, ...settingsInput } = input;
  try {
    payload = normalizeUserSettingsInput(settingsInput);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Invalid settings';
    return { ok: false, error: message };
  }

  const requestedMcqQuestionFormats = readRequestedMcqQuestionFormats(mcq_question_formats);
  if (settingsInput.include_mcq === 'true' && requestedMcqQuestionFormats.length === 0) {
    return { ok: false, error: 'Select at least one MCQ question format.' };
  }
  const parsedMcqQuestionFormats = parseMcqQuestionFormats(mcq_question_formats);

  // Always ensure user_id is set for upsert
  const row: Partial<UserSettingsRow> = {
    user_id: user.id,
    learning_lang: 'es',
    ...payload,
  };

  debugSettings('requested', row);

  const { error } = await supabase
    .from('user_settings')
    .upsert(row, { onConflict: 'user_id' });

  if (error) {
    return { ok: false, error: formatSettingsSaveError(error.message) };
  }

  const { data: savedSettings, error: savedSettingsError } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (savedSettingsError) {
    return { ok: false, error: savedSettingsError.message };
  }

  debugSettings('saved', savedSettings as Partial<UserSettingsRow> | null);

  if (!savedSettings) {
    return {
      ok: false,
      error: 'Settings saved but could not be reloaded for verification.',
    };
  }

  if (!didPersistRequestedSettings(payload, savedSettings as Partial<UserSettingsRow>)) {
    console.warn('[settings:update] persisted settings mismatch', {
      requested: pickDebugSettings(payload),
      saved: pickDebugSettings(savedSettings as Partial<UserSettingsRow>),
    });
    return {
      ok: false,
      error:
        'Settings did not persist correctly. Apply the latest database migration for flashcard direction settings and try again.',
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(
    MCQ_QUESTION_FORMATS_COOKIE,
    serializeMcqQuestionFormats(parsedMcqQuestionFormats),
    {
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
      sameSite: 'lax',
    },
  );

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

function isMissingAutoAdvanceColumnError(message?: string) {
  return Boolean(message?.includes("auto_advance_correct"));
}

function isMissingSentenceTranslationVisibilityColumnError(message?: string) {
  return Boolean(message?.includes("hide_translation_sentences"));
}

function formatSettingsSaveError(message?: string) {
  if (isMissingDirectionColumnError(message)) {
    return 'Flashcard direction settings could not be saved because the database is missing the latest direction columns. Run the newest Supabase migration and try again.';
  }

  if (isMissingAutoAdvanceColumnError(message)) {
    return 'Auto-next settings could not be saved because the database is missing the latest settings column. Run the newest Supabase migration and try again.';
  }

  if (isMissingSentenceTranslationVisibilityColumnError(message)) {
    return 'Sentence translation visibility settings could not be saved because the database is missing the latest settings column. Run the newest Supabase migration and try again.';
  }

  return message ?? 'Failed to save settings';
}

function didPersistRequestedSettings(
  payload: Partial<UserSettingsRow>,
  savedSettings: Partial<UserSettingsRow>,
) {
  return Object.entries(payload).every(([key, value]) => savedSettings[key as keyof UserSettingsRow] === value);
}

function debugSettings(
  stage: 'requested' | 'saved',
  settings: Partial<UserSettingsRow> | null,
) {
  if (process.env.NODE_ENV === 'test') return;
  console.log(`[settings:update] ${stage}`, pickDebugSettings(settings));
}

function pickDebugSettings(settings: Partial<UserSettingsRow> | null | undefined) {
  if (!settings) return null;

  return Object.fromEntries(
    DEBUG_SETTINGS_KEYS
      .filter((key) => key in settings)
      .map((key) => [key, settings[key]]),
  );
}
