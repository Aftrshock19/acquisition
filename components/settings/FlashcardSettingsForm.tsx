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
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold tracking-tight">Daily card amount</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Recommended is the low-burden default. Manual lets you choose an exact number.
        </p>
        <div className="mt-4 grid gap-3 text-sm">
          <label
            className={`app-toggle ${
              userSettings.daily_plan_mode === 'recommended' ? 'app-toggle-active' : ''
            }`}
          >
            <input
              type="radio"
              name="daily_plan_mode"
              value="recommended"
              defaultChecked={userSettings.daily_plan_mode === 'recommended'}
              className="app-check app-check-round"
            />
            <span className="flex flex-col">
              <span>Use recommended amount</span>
              <span className="text-xs text-zinc-500">
                ({recommended.recommendedDailyLimit} cards/day)
              </span>
            </span>
          </label>
          <label
            className={`app-toggle ${
              userSettings.daily_plan_mode === 'manual' ? 'app-toggle-active' : ''
            }`}
          >
            <input
              type="radio"
              name="daily_plan_mode"
              value="manual"
              defaultChecked={userSettings.daily_plan_mode === 'manual'}
              className="app-check app-check-round"
            />
            <span>Choose my own amount</span>
          </label>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <input
            type="range"
            name="manual_daily_card_limit"
            min={10}
            max={200}
            defaultValue={userSettings.manual_daily_card_limit}
            className="app-range flex-1"
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
            className="app-input w-16 px-2 py-1 text-sm"
          />
          <span className="text-xs text-zinc-500">cards/day</span>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold tracking-tight">Flashcard types</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Use recommended mix or choose exactly which types to include.
        </p>
        <div className="mt-4 grid gap-3 text-sm">
          <label
            className={`app-toggle ${
              userSettings.flashcard_selection_mode === 'recommended' ? 'app-toggle-active' : ''
            }`}
          >
            <input
              type="radio"
              name="flashcard_selection_mode"
              value="recommended"
              defaultChecked={userSettings.flashcard_selection_mode === 'recommended'}
              className="app-check app-check-round"
            />
            <span className="flex flex-col">
              <span>Use recommended types</span>
              <span className="text-xs text-zinc-500">
                ({summarizeTypes(recommended.recommendedTypes)})
              </span>
            </span>
          </label>
          <label
            className={`app-toggle ${
              userSettings.flashcard_selection_mode === 'manual' ? 'app-toggle-active' : ''
            }`}
          >
            <input
              type="radio"
              name="flashcard_selection_mode"
              value="manual"
              defaultChecked={userSettings.flashcard_selection_mode === 'manual'}
              className="app-check app-check-round"
            />
            <span>Choose my own types</span>
          </label>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {renderTypeCheckbox('include_cloze', 'Cloze', userSettings.include_cloze)}
          {renderTypeCheckbox('include_normal', 'Normal flashcard', userSettings.include_normal)}
          {renderTypeCheckbox('include_audio', 'Audio', userSettings.include_audio)}
          {renderTypeCheckbox('include_mcq', 'Multiple choice', userSettings.include_mcq)}
          {renderTypeCheckbox('include_sentences', 'Sentences', userSettings.include_sentences)}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold tracking-tight">Shared options</h2>
        <div className="mt-4 flex flex-col gap-4 text-sm">
          <label className="flex items-center gap-3">
            <span className="w-40 text-zinc-700 dark:text-zinc-200">Retry delay</span>
            <input
              type="number"
              name="retry_delay_seconds"
              min={10}
              max={3600}
              defaultValue={userSettings.retry_delay_seconds}
              className="app-input w-20 px-2 py-1 text-sm"
            />
            <span className="text-xs text-zinc-500">seconds</span>
          </label>

          <label className="app-toggle">
            <input
              type="checkbox"
              name="show_pos_hint"
              defaultChecked={userSettings.show_pos_hint}
              className="app-check"
            />
            <span>Show part of speech hints</span>
          </label>

          <label className="app-toggle">
            <input
              type="checkbox"
              name="show_definition_first"
              defaultChecked={userSettings.show_definition_first}
              className="app-check"
            />
            <span>Show definition first</span>
          </label>
        </div>
      </section>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-zinc-500">
          Effective today: {effective.effectiveDailyLimit} cards · {summarizeTypes(effective.effectiveTypes)}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="app-button"
        >
          {pending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

function renderTypeCheckbox(name: string, label: string, checked: boolean) {
  return (
    <label className="app-toggle">
      <span className="flex items-center gap-2">
        <input type="checkbox" name={name} defaultChecked={checked} className="app-check" />
        <span>{label}</span>
      </span>
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
