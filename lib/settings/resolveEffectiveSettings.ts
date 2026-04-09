import type {
  DirectionSettings,
  EffectiveFlashcardSettings,
  FamilySettings,
  RecommendedSettings,
  UserSettingsRow,
} from "./types";

export function resolveEffectiveSettings(
  user: UserSettingsRow,
  recommended: RecommendedSettings,
): EffectiveFlashcardSettings {
  const { recommendedDailyLimit, recommendedTypes } = recommended;

  const effectiveDailyLimit =
    user.daily_plan_mode === "recommended"
      ? recommendedDailyLimit
      : clamp(user.manual_daily_card_limit, 10, 200);

  const manualTypes: FamilySettings = {
    cloze: user.include_cloze,
    normal: user.include_normal,
    audio: user.include_audio,
    mcq: user.include_mcq,
    sentences: user.include_sentences,
  };

  const hasAnyManual = Object.values(manualTypes).some(Boolean);

  const effectiveTypes =
    user.flashcard_selection_mode === "recommended"
      ? recommendedTypes
      : hasAnyManual
        ? manualTypes
        : recommendedTypes;

  const effectiveDirections: DirectionSettings = {
    cloze_en_to_es: user.include_cloze_en_to_es,
    cloze_es_to_en: user.include_cloze_es_to_en,
    normal_en_to_es: user.include_normal_en_to_es,
    normal_es_to_en: user.include_normal_es_to_en,
  };

  const enabledModes = {
    cloze_en_to_es: effectiveTypes.cloze && effectiveDirections.cloze_en_to_es,
    cloze_es_to_en: effectiveTypes.cloze && effectiveDirections.cloze_es_to_en,
    normal_en_to_es: effectiveTypes.normal && effectiveDirections.normal_en_to_es,
    normal_es_to_en: effectiveTypes.normal && effectiveDirections.normal_es_to_en,
    audio: effectiveTypes.audio,
    mcq: effectiveTypes.mcq,
    sentences: effectiveTypes.sentences,
  };

  debugEffectiveSettings({
    selectionMode: user.flashcard_selection_mode,
    manualTypes,
    effectiveTypes,
    effectiveDirections,
    enabledModes,
  });

  return {
    effectiveDailyLimit,
    effectiveTypes,
    effectiveDirections,
    enabledModes,
    retryDelaySeconds: clamp(user.retry_delay_seconds, 10, 3600),
    autoAdvanceCorrect: user.auto_advance_correct,
    showPosHint: user.show_pos_hint,
    showDefinitionFirst: user.show_definition_first,
    hideTranslationSentences: user.hide_translation_sentences,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const SETTINGS_DEBUG_LOGS_ENABLED = process.env.SETTINGS_DEBUG_LOGS === "1";

function debugEffectiveSettings(value: {
  selectionMode: UserSettingsRow["flashcard_selection_mode"];
  manualTypes: FamilySettings;
  effectiveTypes: FamilySettings;
  effectiveDirections: DirectionSettings;
  enabledModes: EffectiveFlashcardSettings["enabledModes"];
}) {
  if (!SETTINGS_DEBUG_LOGS_ENABLED) return;
  console.log("[settings:effective]", value);
}
