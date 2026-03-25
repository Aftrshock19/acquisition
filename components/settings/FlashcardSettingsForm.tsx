'use client';

import { useState, useTransition } from 'react';
import type { EffectiveFlashcardSettings, RecommendedSettings, UserSettingsRow } from '@/lib/settings/types';
import { updateUserSettingsAction } from '@/app/actions/settings';

type Props = {
  userSettings: UserSettingsRow;
  recommended: RecommendedSettings;
  effective: EffectiveFlashcardSettings;
};

export function FlashcardSettingsForm({
  userSettings,
  recommended,
  effective,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => {
      void updateUserSettingsAction(
        Object.fromEntries(formData.entries()) as any,
      ).then((res) => {
        if (!res.ok) setError(res.error);
        else setError(null);
      });
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      )}

      {/* Daily amount */}
      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-base font-semibold tracking-tight">Daily card amount</h2>
        <p className="text-xs text-zinc-500">
          Recommended is the low-burden default. Manual lets you choose an exact number.
        </p>
        <div className="mt-1 flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="daily_plan_mode"
              value="recommended"
              defaultChecked={userSettings.daily_plan_mode === 'recommended'}
            />
            <span>
              Use recommended amount
              <span className="ml-1 text-xs text-zinc-500">
                ({recommended.recommendedDailyLimit} cards/day)
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="daily_plan_mode"
              value="manual"
              defaultChecked={userSettings.daily_plan_mode === 'manual'}
            />
            <span>Choose my own amount</span>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <input
            type="range"
            name="manual_daily_card_limit"
            min={10}
            max={200}
            defaultValue={userSettings.manual_daily_card_limit}
            className="flex-1"
          />
          <input
            type="number"
            min={10}
            max={200}
            defaultValue={userSettings.manual_daily_card_limit}
            onChange={(e) => {
              const slider = (e.currentTarget.form?.elements.namedItem('manual_daily_card_limit') as HTMLInputElement | null);
              if (slider) slider.value = e.currentTarget.value;
            }}
            className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-xs text-zinc-500">cards/day</span>
        </div>
      </section>

      {/* Flashcard types */}
      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-base font-semibold tracking-tight">Flashcard types</h2>
        <p className="text-xs text-zinc-500">
          Use recommended mix or choose exactly which types to include.
        </p>
        <div className="mt-1 flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="flashcard_selection_mode"
              value="recommended"
              defaultChecked={userSettings.flashcard_selection_mode === 'recommended'}
            />
            <span>
              Use recommended types
              <span className="ml-1 text-xs text-zinc-500">
                ({summarizeTypes(recommended.recommendedTypes)})
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="flashcard_selection_mode"
              value="manual"
              defaultChecked={userSettings.flashcard_selection_mode === 'manual'}
            />
            <span>Choose my own types</span>
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          {renderTypeCheckbox('include_cloze', 'Cloze', userSettings.include_cloze)}
          {renderTypeCheckbox('include_normal', 'Normal flashcard', userSettings.include_normal)}
          {renderTypeCheckbox('include_audio', 'Audio', userSettings.include_audio)}
          {renderTypeCheckbox('include_mcq', 'Multiple choice', userSettings.include_mcq)}
          {renderTypeCheckbox('include_sentences', 'Sentences', userSettings.include_sentences)}
        </div>
      </section>

      {/* Shared options */}
      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-base font-semibold tracking-tight">Shared options</h2>
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="w-40 text-zinc-700 dark:text-zinc-200">Retry delay</span>
            <input
              type="number"
              name="retry_delay_seconds"
              min={10}
              max={3600}
              defaultValue={userSettings.retry_delay_seconds}
              className="w-20 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <span className="text-xs text-zinc-500">seconds</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="show_pos_hint"
              defaultChecked={userSettings.show_pos_hint}
            />
            <span>Show part of speech hints</span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="show_definition_first"
              defaultChecked={userSettings.show_definition_first}
            />
            <span>Show definition first</span>
          </label>
        </div>
      </section>

      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          Effective today: {effective.effectiveDailyLimit} cards · {summarizeTypes(effective.effectiveTypes)}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

function renderTypeCheckbox(name: string, label: string, checked: boolean) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" name={name} defaultChecked={checked} />
      <span>{label}</span>
    </label>
  );
}

function summarizeTypes(types: { [k: string]: boolean }) {
  const enabled = Object.entries(types)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '));
  if (enabled.length === 0) return 'no types';
  return enabled.join(', ');
}
