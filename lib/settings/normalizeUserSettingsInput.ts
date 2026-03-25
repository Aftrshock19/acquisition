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
  retry_delay_seconds: string | number;
  show_pos_hint: string | boolean;
  show_definition_first: string | boolean;
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

  if (raw.retry_delay_seconds !== undefined) {
    const n = clampNumber(raw.retry_delay_seconds, 10, 3600, 90);
    out.retry_delay_seconds = n;
  }

  if (raw.include_cloze !== undefined) out.include_cloze = toBool(raw.include_cloze);
  if (raw.include_normal !== undefined) out.include_normal = toBool(raw.include_normal);
  if (raw.include_audio !== undefined) out.include_audio = toBool(raw.include_audio);
  if (raw.include_mcq !== undefined) out.include_mcq = toBool(raw.include_mcq);
  if (raw.include_sentences !== undefined) out.include_sentences = toBool(raw.include_sentences);

  if (raw.show_pos_hint !== undefined) out.show_pos_hint = toBool(raw.show_pos_hint);
  if (raw.show_definition_first !== undefined) out.show_definition_first = toBool(raw.show_definition_first);

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
