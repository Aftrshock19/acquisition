export type UserSettingsRow = {
  user_id: string;
  learning_lang: string;
  daily_plan_mode: 'recommended' | 'manual';
  manual_daily_card_limit: number;
  flashcard_selection_mode: 'recommended' | 'manual';
  include_cloze: boolean;
  include_normal: boolean;
  include_audio: boolean;
  include_mcq: boolean;
  include_sentences: boolean;
  retry_delay_seconds: number;
  show_pos_hint: boolean;
  show_definition_first: boolean;
  created_at: string;
  updated_at: string;
};

export type RecommendedTypes = {
  cloze: boolean;
  normal: boolean;
  audio: boolean;
  mcq: boolean;
  sentences: boolean;
};

export type RecommendedSettings = {
  recommendedDailyLimit: number;
  recommendedTypes: RecommendedTypes;
};

export type EffectiveTypes = RecommendedTypes;

export type EffectiveFlashcardSettings = {
  effectiveDailyLimit: number;
  effectiveTypes: EffectiveTypes;
  retryDelaySeconds: number;
  showPosHint: boolean;
  showDefinitionFirst: boolean;
};
