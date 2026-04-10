import type { UserSettingsRow } from './types';

export type RawSettingsInput = Partial<{
  daily_plan_mode: string;
  manual_daily_card_limit: string | number;
  flashcard_selection_mode: string;
  include_cloze: string | boolean;
  include_normal: string | boolean;
  include_audio: string | boolean;
  include_mcq: string | boolean;
  include_sentences: string | boolean;
  include_cloze_en_to_es: string | boolean;
  include_cloze_es_to_en: string | boolean;
  include_normal_en_to_es: string | boolean;
  include_normal_es_to_en: string | boolean;
  auto_advance_correct: string | boolean;
  show_pos_hint: string | boolean;
  show_definition_first: string | boolean;
  hide_translation_sentences: string | boolean;
}>;

export function normalizeUserSettingsInput(raw: RawSettingsInput): Partial<UserSettingsRow> {
  const out: Partial<UserSettingsRow> = {};

  if (raw.daily_plan_mode === 'recommended' || raw.daily_plan_mode === 'manual') {
    out.daily_plan_mode = raw.daily_plan_mode;
  }

  if (raw.flashcard_selection_mode === 'recommended' || raw.flashcard_selection_mode === 'manual') {
    out.flashcard_selection_mode = raw.flashcard_selection_mode;
  }

  if (raw.manual_daily_card_limit !== undefined) {
    const n = clampNumber(raw.manual_daily_card_limit, 10, 200, 30);
    out.manual_daily_card_limit = n;
  }

  if (raw.auto_advance_correct !== undefined) {
    out.auto_advance_correct = toBool(raw.auto_advance_correct);
  }

  if (raw.include_cloze !== undefined) out.include_cloze = toBool(raw.include_cloze);
  if (raw.include_normal !== undefined) out.include_normal = toBool(raw.include_normal);
  if (raw.include_audio !== undefined) out.include_audio = toBool(raw.include_audio);
  if (raw.include_mcq !== undefined) out.include_mcq = toBool(raw.include_mcq);
  if (raw.include_sentences !== undefined) out.include_sentences = toBool(raw.include_sentences);
  if (raw.include_cloze_en_to_es !== undefined) {
    out.include_cloze_en_to_es = toBool(raw.include_cloze_en_to_es);
  }
  if (raw.include_cloze_es_to_en !== undefined) {
    out.include_cloze_es_to_en = toBool(raw.include_cloze_es_to_en);
  }
  if (raw.include_normal_en_to_es !== undefined) {
    out.include_normal_en_to_es = toBool(raw.include_normal_en_to_es);
  }
  if (raw.include_normal_es_to_en !== undefined) {
    out.include_normal_es_to_en = toBool(raw.include_normal_es_to_en);
  }

  if (raw.show_pos_hint !== undefined) out.show_pos_hint = toBool(raw.show_pos_hint);
  if (raw.show_definition_first !== undefined) out.show_definition_first = toBool(raw.show_definition_first);
  if (raw.hide_translation_sentences !== undefined) {
    out.hide_translation_sentences = toBool(raw.hide_translation_sentences);
  }

  // If manual mode is requested, enforce at least one type enabled.
  if (out.flashcard_selection_mode === 'manual') {
    const any = (out.include_cloze ?? false)
      || (out.include_normal ?? false)
      || (out.include_audio ?? false)
      || (out.include_mcq ?? false)
      || (out.include_sentences ?? false);
    if (!any) {
      throw new Error('At least one flashcard type must be selected in manual mode');
    }
  }

  if (
    raw.include_cloze !== undefined
    && raw.include_cloze_en_to_es !== undefined
    && raw.include_cloze_es_to_en !== undefined
    && (out.include_cloze ?? false)
    && !(out.include_cloze_en_to_es ?? false)
    && !(out.include_cloze_es_to_en ?? false)
  ) {
    throw new Error('Select at least one direction for Cloze');
  }

  if (
    raw.include_normal !== undefined
    && raw.include_normal_en_to_es !== undefined
    && raw.include_normal_es_to_en !== undefined
    && (out.include_normal ?? false)
    && !(out.include_normal_en_to_es ?? false)
    && !(out.include_normal_es_to_en ?? false)
  ) {
    throw new Error('Select at least one direction for Normal');
  }

  return out;
}

function toBool(v: string | boolean): boolean {
  if (typeof v === 'boolean') return v;
  return v === 'on' || v === 'true' || v === '1';
}

function clampNumber(
  value: string | number,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
