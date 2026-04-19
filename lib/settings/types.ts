export type FlashcardFamily = "cloze" | "normal" | "audio" | "mcq" | "sentences";

export type EnabledFlashcardMode =
  | "cloze_en_to_es"
  | "cloze_es_to_en"
  | "normal_en_to_es"
  | "normal_es_to_en"
  | "audio"
  | "mcq"
  | "sentences";

export type DirectionSettings = {
  cloze_en_to_es: boolean;
  cloze_es_to_en: boolean;
  normal_en_to_es: boolean;
  normal_es_to_en: boolean;
};

export type FamilySettings = {
  cloze: boolean;
  normal: boolean;
  audio: boolean;
  mcq: boolean;
  sentences: boolean;
};

export type UserSettingsRow = {
  user_id: string;
  learning_lang: string;
  daily_plan_mode: "recommended" | "manual";
  manual_daily_card_limit: number;
  flashcard_selection_mode: "recommended" | "manual";
  include_cloze: boolean;
  include_normal: boolean;
  include_audio: boolean;
  include_mcq: boolean;
  include_sentences: boolean;
  include_cloze_en_to_es: boolean;
  include_cloze_es_to_en: boolean;
  include_normal_en_to_es: boolean;
  include_normal_es_to_en: boolean;
  retry_delay_seconds: number;
  auto_advance_correct: boolean;
  show_pos_hint: boolean;
  show_definition_first: boolean;
  hide_translation_sentences: boolean;
  remove_daily_limit: boolean;
  scheduler_variant: "baseline" | "adaptive";
  has_seen_intro: boolean;
  onboarding_completed_at: string | null;
  onboarding_entry_mode?: "beginner_default" | "baseline" | "self_certified" | null;
  self_certified_cefr_level?: "A1" | "A2" | "B1" | "B2" | "C1" | null;
  placement_status?: string | null;
  current_frontier_rank?: number | null;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type RecommendedTypes = FamilySettings;

export type RecommendedSettings = {
  recommendedDailyLimit: number;
  recommendedTypes: RecommendedTypes;
};

export type EffectiveFlashcardSettings = {
  effectiveDailyLimit: number;
  effectiveTypes: FamilySettings;
  effectiveDirections: DirectionSettings;
  enabledModes: Record<EnabledFlashcardMode, boolean>;
  autoAdvanceCorrect: boolean;
  showPosHint: boolean;
  showDefinitionFirst: boolean;
  hideTranslationSentences: boolean;
};
