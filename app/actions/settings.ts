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
import { recommendSettings } from '@/lib/settings/recommendSettings';
import { getTodaySessionDate } from '@/lib/loop/dailySessions';
import type { UserSettingsRow } from '@/lib/settings/types';
import { revalidatePath } from 'next/cache';

export type UpdateUserSettingsResult = { ok: true } | { ok: false; error: string };
type UpdateUserSettingsInput = RawSettingsInput & {
  mcq_question_formats?: string;
  today_session_target?: string;
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
  'remove_daily_limit',
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
  const { mcq_question_formats, today_session_target, ...settingsInput } = input;
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

  // Detect target-changing saves so today's in-progress session can follow the
  // user's new target. We care if the incoming save touches the mode, the
  // stored manual limit, or sends a today-only target (override flow).
  // Card-type toggles and other changes skip this block.
  let pendingTargetUpdate:
    | { sessionDate: string; newTarget: number; completedCount: number }
    | null = null;
  const incomingTodaySessionTarget = parseTodaySessionTarget(today_session_target);
  const mightChangeTarget =
    payload.daily_plan_mode !== undefined ||
    payload.manual_daily_card_limit !== undefined ||
    incomingTodaySessionTarget !== null;

  if (mightChangeTarget) {
    const { data: currentSettings, error: currentSettingsError } = await supabase
      .from('user_settings')
      .select('daily_plan_mode, manual_daily_card_limit')
      .eq('user_id', user.id)
      .maybeSingle();

    if (currentSettingsError) {
      console.warn(
        '[settings:update] current user_settings lookup failed; skipping in-session target adjustment',
        currentSettingsError,
      );
    } else if (currentSettings) {
      const sessionDate = getTodaySessionDate();
      const { data: todayRow, error: todayRowError } = await supabase
        .from('daily_sessions')
        .select(
          'flashcard_completed_count, recommended_target_at_creation, session_date, assigned_flashcard_count, effective_daily_target_mode',
        )
        .eq('user_id', user.id)
        .eq('session_date', sessionDate)
        .maybeSingle();

      if (todayRowError) {
        // Non-critical side effect: skip the in-session target update but
        // still persist user_settings. Next /today load will freeze fresh.
        console.warn(
          '[settings:update] daily_sessions lookup failed; proceeding without target adjustment',
          todayRowError,
        );
      } else if (todayRow) {
        const incomingMode = payload.daily_plan_mode;
        const incomingLimit = payload.manual_daily_card_limit;
        const currentMode = (currentSettings as { daily_plan_mode: 'recommended' | 'manual' | null })
          .daily_plan_mode;
        const currentLimit = (currentSettings as { manual_daily_card_limit: number | null })
          .manual_daily_card_limit;

        const completedCount = (todayRow as { flashcard_completed_count: number | null })
          .flashcard_completed_count ?? 0;
        const snapshotted = (todayRow as { recommended_target_at_creation: number | null })
          .recommended_target_at_creation;
        const assignedCount = (todayRow as { assigned_flashcard_count: number | null })
          .assigned_flashcard_count ?? 0;
        const isOverride = (todayRow as {
          effective_daily_target_mode: 'recommended' | 'manual' | null;
        }).effective_daily_target_mode === 'manual';

        // Mutually exclusive by construction:
        //   A: both manual, limit differs
        //   B: manual → recommended
        //   C: recommended → manual (with an incoming limit)
        //   D: recommended preference + override active + override-form sent
        //      a today_session_target that differs from today's assigned count.
        //      Policy Y: only daily_sessions is touched; user_settings stays
        //      out of override decisions (extension follows the same rule).
        type Case = 'A' | 'B' | 'C' | 'D' | null;
        let caseKind: Case = null;
        let newTarget: number | null = null;

        if (
          currentMode === 'manual' &&
          incomingMode === 'manual' &&
          typeof incomingLimit === 'number' &&
          incomingLimit !== currentLimit
        ) {
          caseKind = 'A';
          newTarget = incomingLimit;
        } else if (currentMode === 'manual' && incomingMode === 'recommended') {
          caseKind = 'B';
          if (typeof snapshotted === 'number' && snapshotted > 0) {
            newTarget = snapshotted;
          } else {
            const recommended = await recommendSettings();
            newTarget = recommended.recommendedDailyLimit;
          }
        } else if (
          currentMode === 'recommended' &&
          incomingMode === 'manual' &&
          typeof incomingLimit === 'number'
        ) {
          caseKind = 'C';
          newTarget = incomingLimit;
        } else if (
          currentMode === 'recommended' &&
          incomingMode === undefined &&
          isOverride &&
          incomingTodaySessionTarget !== null &&
          incomingTodaySessionTarget !== assignedCount
        ) {
          caseKind = 'D';
          newTarget = incomingTodaySessionTarget;
        }

        if (caseKind !== null && newTarget !== null) {
          if (newTarget < completedCount) {
            return {
              ok: false,
              error: `Can't set target below cards already practiced today (${completedCount}). Finish your session or choose ${completedCount} or higher.`,
            };
          }

          pendingTargetUpdate = { sessionDate, newTarget, completedCount };
        }
      }
    }
  }

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

  if (pendingTargetUpdate) {
    // Targeted single-column update: must not use .upsert or include any
    // snapshot field, or we would overwrite frozen session-start columns.
    const updatePayload: Record<string, unknown> = {
      assigned_flashcard_count: pendingTargetUpdate.newTarget,
    };

    // Raising the target above current completed count re-opens the flashcard
    // phase. Without resetting stage and flashcards_completed_at, the page
    // continues to render the 'Reading is next' gate using the stale stage
    // column and the user cannot resume flashcards.
    const willReopenFlashcards =
      pendingTargetUpdate.newTarget > pendingTargetUpdate.completedCount;
    if (willReopenFlashcards) {
      updatePayload.stage = 'flashcards';
      updatePayload.flashcards_completed_at = null;
      updatePayload.completed = false;
      updatePayload.completed_at = null;
    }

    const { error: targetUpdateError } = await supabase
      .from('daily_sessions')
      .update(updatePayload)
      .eq('user_id', user.id)
      .eq('session_date', pendingTargetUpdate.sessionDate);

    if (targetUpdateError) {
      return { ok: false, error: formatSettingsSaveError(targetUpdateError.message) };
    }
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

function parseTodaySessionTarget(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 9999) return null;
  return rounded;
}

function pickDebugSettings(settings: Partial<UserSettingsRow> | null | undefined) {
  if (!settings) return null;

  return Object.fromEntries(
    DEBUG_SETTINGS_KEYS
      .filter((key) => key in settings)
      .map((key) => [key, settings[key]]),
  );
}

export type UpdateTimezoneResult = { ok: true } | { ok: false; error: string };

const TIMEZONE_PATTERN = /^[A-Za-z]+(?:\/[A-Za-z_+\-]+){1,2}$|^UTC$/;

export async function updateUserTimezoneIfChangedAction(
  tz: string,
): Promise<UpdateTimezoneResult> {
  if (typeof tz !== 'string' || tz.length === 0 || !TIMEZONE_PATTERN.test(tz)) {
    return { ok: false, error: 'invalid_timezone' };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: true };

  const { user, error: authError } = await getSupabaseUser(supabase);
  if (authError || !user) return { ok: true };

  const { error } = await supabase
    .from('user_settings')
    .update({ timezone: tz, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .neq('timezone', tz);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
