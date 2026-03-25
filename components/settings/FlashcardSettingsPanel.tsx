"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { EffectiveFlashcardSettings, UserSettingsRow } from "@/lib/settings/types";
import { updateUserSettingsAction } from "@/app/actions/settings";

export type FlashcardSettingsPanelProps = {
  variant: "home" | "today";
  userSettings: UserSettingsRow;
  effective: EffectiveFlashcardSettings;
};

export function FlashcardSettingsPanel({
  variant,
  userSettings,
  effective,
}: FlashcardSettingsPanelProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
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
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">
          Flashcard settings
          {variant === 'home' ? ' (today)' : ''}
        </h2>
        <Link
          href="/settings"
          className="text-xs font-medium text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-200 dark:hover:text-zinc-50"
        >
          Full settings
        </Link>
      </div>

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">Daily amount:</span>
          <button
            type="submit"
            name="daily_plan_mode"
            value="recommended"
            disabled={pending}
            className={buttonClass(userSettings.daily_plan_mode === 'recommended')}
          >
            Recommended ({effective.effectiveDailyLimit})
          </button>
          <button
            type="submit"
            name="daily_plan_mode"
            value="manual"
            disabled={pending}
            className={buttonClass(userSettings.daily_plan_mode === 'manual')}
          >
            Manual
          </button>
          {userSettings.daily_plan_mode === 'manual' && (
            <input
              type="number"
              name="manual_daily_card_limit"
              min={10}
              max={200}
              defaultValue={userSettings.manual_daily_card_limit}
              className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">Types:</span>
          <button
            type="submit"
            name="flashcard_selection_mode"
            value="recommended"
            disabled={pending}
            className={buttonClass(userSettings.flashcard_selection_mode === 'recommended')}
          >
            Recommended
          </button>
          <button
            type="submit"
            name="flashcard_selection_mode"
            value="manual"
            disabled={pending}
            className={buttonClass(userSettings.flashcard_selection_mode === 'manual')}
          >
            Manual
          </button>
        </div>

        {userSettings.flashcard_selection_mode === 'manual' && (
          <div className="flex flex-wrap gap-2 text-xs">
            {renderSmallToggle('include_cloze', 'Cloze', userSettings.include_cloze)}
            {renderSmallToggle('include_normal', 'Normal', userSettings.include_normal)}
            {renderSmallToggle('include_audio', 'Audio', userSettings.include_audio)}
            {renderSmallToggle('include_mcq', 'MCQ', userSettings.include_mcq)}
            {renderSmallToggle('include_sentences', 'Sentences', userSettings.include_sentences)}
          </div>
        )}

        {variant === 'today' && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>Retry delay:</span>
            <input
              type="number"
              name="retry_delay_seconds"
              min={10}
              max={3600}
              defaultValue={effective.retryDelaySeconds}
              className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            <span>s</span>
          </div>
        )}

        <p className="text-xs text-zinc-500">
          Effective: {effective.effectiveDailyLimit} cards · {summarizeTypes(effective.effectiveTypes)}
        </p>
      </form>
    </section>
  );
}

function buttonClass(active: boolean) {
  return `rounded-full border px-3 py-1 text-xs font-medium transition ${
    active
      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
      : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800'
  }`;
}

function renderSmallToggle(name: string, label: string, checked: boolean) {
  return (
    <label className="flex items-center gap-1">
      <input type="checkbox" name={name} defaultChecked={checked} className="h-3 w-3" />
      <span>{label}</span>
    </label>
  );
}

function summarizeTypes(types: { [k: string]: boolean }) {
  const enabled = Object.entries(types)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '));
  if (enabled.length === 0) return 'none';
  return enabled.join(', ');
}
