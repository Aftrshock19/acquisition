"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { EffectiveFlashcardSettings, UserSettingsRow } from "@/lib/settings/types";
import type { RawSettingsInput } from "@/lib/settings/normalizeUserSettingsInput";
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
      const input = Object.fromEntries(formData.entries()) as RawSettingsInput & {
        mcq_question_formats?: string;
      };

      void updateUserSettingsAction(
        input,
      ).then((res) => {
        if (!res.ok) setError(res.error);
        else setError(null);
      });
    });
  }

  return (
    <section className="app-card-muted flex flex-col gap-4 p-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">
          Flashcard target
          {variant === "home" ? " (today)" : ""}
        </h2>
        <Link
          href="/settings"
          className="text-xs font-medium text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-200 dark:hover:text-zinc-50"
        >
          Full settings
        </Link>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">Daily target:</span>
          <button
            type="submit"
            name="daily_plan_mode"
            value="recommended"
            disabled={pending}
            className={buttonClass(userSettings.daily_plan_mode === "recommended")}
          >
            Recommended ({effective.effectiveDailyLimit})
          </button>
          <button
            type="submit"
            name="daily_plan_mode"
            value="manual"
            disabled={pending}
            className={buttonClass(userSettings.daily_plan_mode === "manual")}
          >
            Custom
          </button>
          {userSettings.daily_plan_mode === "manual" ? (
            <input
              type="number"
              name="manual_daily_card_limit"
              min={1}
              max={userSettings.remove_daily_limit ? 9999 : 200}
              defaultValue={userSettings.manual_daily_card_limit}
              className="app-input app-input-no-spinner w-16 px-2 py-1 text-xs"
            />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">Families:</span>
          <button
            type="submit"
            name="flashcard_selection_mode"
            value="recommended"
            disabled={pending}
            className={buttonClass(userSettings.flashcard_selection_mode === "recommended")}
          >
            Recommended
          </button>
          <button
            type="submit"
            name="flashcard_selection_mode"
            value="manual"
            disabled={pending}
            className={buttonClass(userSettings.flashcard_selection_mode === "manual")}
          >
            Manual
          </button>
        </div>

        {userSettings.flashcard_selection_mode === "manual" ? (
          <div className="flex flex-wrap gap-2 text-xs">
            {renderSmallToggle("include_cloze", "Cloze", Boolean(userSettings.include_cloze))}
            {renderSmallToggle("include_normal", "Normal", Boolean(userSettings.include_normal))}
            {renderSmallToggle("include_mcq", "MCQ", Boolean(userSettings.include_mcq))}
            {renderSmallToggle("include_sentences", "Sentences", Boolean(userSettings.include_sentences))}
            {renderSmallToggle("include_audio", "Audio", Boolean(userSettings.include_audio))}
          </div>
        ) : null}

        <p className="text-xs text-zinc-500">
          Effective families: {summarizeFamilies(effective.effectiveTypes)}
        </p>
        <p className="text-xs text-zinc-500">
          Directions: {summarizeDirections(effective)}
        </p>
        <p className="text-[11px] text-zinc-500">
          Direction settings for Cloze and Normal are available in full settings.
        </p>
      </form>
    </section>
  );
}

function buttonClass(active: boolean) {
  return `rounded-full border px-3 py-1.5 text-xs font-medium transition ${
    active
      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
      : "border-zinc-300 bg-white/80 text-zinc-700 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
  }`;
}

function renderSmallToggle(name: string, label: string, checked: boolean) {
  return (
    <label className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/70">
      <span className="flex items-center gap-2">
        <input type="hidden" name={name} value="false" />
        <input
          type="checkbox"
          name={name}
          value="true"
          defaultChecked={checked}
          className="app-check h-3.5 w-3.5"
        />
        <span>{label}</span>
      </span>
    </label>
  );
}

function summarizeFamilies(types: { [k: string]: boolean }) {
  const enabled = Object.entries(types)
    .filter(([, value]) => value)
    .map(([key]) => key.replace(/_/g, " "));
  return enabled.length > 0 ? enabled.join(", ") : "none";
}

function summarizeDirections(effective: EffectiveFlashcardSettings) {
  const parts: string[] = [];

  if (effective.effectiveTypes.cloze) {
    parts.push(
      `Cloze (${directionSummary(
        effective.effectiveDirections.cloze_en_to_es,
        effective.effectiveDirections.cloze_es_to_en,
      )})`,
    );
  }

  if (effective.effectiveTypes.normal) {
    parts.push(
      `Normal (${directionSummary(
        effective.effectiveDirections.normal_en_to_es,
        effective.effectiveDirections.normal_es_to_en,
      )})`,
    );
  }

  return parts.length > 0 ? parts.join(" · ") : "none";
}

function directionSummary(enToEs: boolean, esToEn: boolean) {
  if (enToEs && esToEn) return "both";
  if (enToEs) return "English -> Spanish";
  if (esToEn) return "Spanish -> English";
  return "off";
}
