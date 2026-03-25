import type { EffectiveFlashcardSettings, RecommendedSettings, UserSettingsRow } from './types';

export function resolveEffectiveSettings(
  user: UserSettingsRow,
  recommended: RecommendedSettings,
): EffectiveFlashcardSettings {
  const { recommendedDailyLimit, recommendedTypes } = recommended;

  const effectiveDailyLimit = user.daily_plan_mode === 'recommended'
    ? recommendedDailyLimit
    : clamp(user.manual_daily_card_limit, 10, 200);

  const manualTypes = {
    cloze: user.include_cloze,
    normal: user.include_normal,
    audio: user.include_audio,
    mcq: user.include_mcq,
    sentences: user.include_sentences,
  };

  const hasAnyManual = Object.values(manualTypes).some(Boolean);

  const effectiveTypes = user.flashcard_selection_mode === 'recommended'
    ? recommendedTypes
    : hasAnyManual
      ? manualTypes
      : recommendedTypes;

  return {
    effectiveDailyLimit,
    effectiveTypes,
    retryDelaySeconds: clamp(user.retry_delay_seconds, 10, 3600),
    showPosHint: user.show_pos_hint,
    showDefinitionFirst: user.show_definition_first,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
