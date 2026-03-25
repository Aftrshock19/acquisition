"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  EffectiveFlashcardSettings,
  RecommendedSettings,
  UserSettingsRow,
} from "@/lib/settings/types";
import { updateUserSettingsAction } from "@/app/actions/settings";

type Props = {
  userSettings: UserSettingsRow;
  recommended: RecommendedSettings;
  effective: EffectiveFlashcardSettings;
};

type ManualTypeKey =
  | "include_cloze"
  | "include_normal"
  | "include_audio"
  | "include_mcq"
  | "include_sentences";

type ManualTypes = Record<ManualTypeKey, boolean>;
type RecommendedTypeKey = keyof RecommendedSettings["recommendedTypes"];

const MANUAL_TYPE_FIELDS: ManualTypeKey[] = [
  "include_cloze",
  "include_normal",
  "include_audio",
  "include_mcq",
  "include_sentences",
];

const FLASHCARD_TYPE_OPTIONS: Array<{
  manualKey: ManualTypeKey;
  recommendedKey: RecommendedTypeKey;
  label: string;
}> = [
  { manualKey: "include_cloze", recommendedKey: "cloze", label: "Cloze" },
  {
    manualKey: "include_normal",
    recommendedKey: "normal",
    label: "Normal flashcard",
  },
  { manualKey: "include_audio", recommendedKey: "audio", label: "Audio" },
  { manualKey: "include_mcq", recommendedKey: "mcq", label: "Multiple choice" },
  {
    manualKey: "include_sentences",
    recommendedKey: "sentences",
    label: "Sentences",
  },
];

export function FlashcardSettingsForm({
  userSettings,
  recommended,
  effective,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dailyPlanMode, setDailyPlanMode] = useState<"recommended" | "manual">(
    userSettings.daily_plan_mode,
  );
  const [flashcardSelectionMode, setFlashcardSelectionMode] = useState<
    "recommended" | "manual"
  >(userSettings.flashcard_selection_mode);
  const [manualDailyLimit, setManualDailyLimit] = useState<number>(
    userSettings.manual_daily_card_limit,
  );
  const [manualTypes, setManualTypes] = useState<ManualTypes>({
    include_cloze: userSettings.include_cloze,
    include_normal: userSettings.include_normal,
    include_audio: userSettings.include_audio,
    include_mcq: userSettings.include_mcq,
    include_sentences: userSettings.include_sentences,
  });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("daily_plan_mode", dailyPlanMode);
    formData.set("manual_daily_card_limit", String(manualDailyLimit));
    formData.set("flashcard_selection_mode", flashcardSelectionMode);
    for (const key of MANUAL_TYPE_FIELDS) {
      formData.set(key, String(manualTypes[key]));
    }
    startTransition(() => {
      void updateUserSettingsAction(
        Object.fromEntries(formData.entries()) as any,
      ).then((res) => {
        if (!res.ok) setError(res.error);
        else {
          setError(null);
          router.refresh();
        }
      });
    });
  }

  function handleManualTypeChange(key: ManualTypeKey, checked: boolean) {
    if (!checked) {
      const enabledCount = MANUAL_TYPE_FIELDS.filter(
        (field) => manualTypes[field],
      ).length;
      if (enabledCount <= 1) {
        setError("At least one flashcard type must stay enabled.");
        return;
      }
    }

    setManualTypes((prev) => ({ ...prev, [key]: checked }));
    setError((prev) =>
      prev === "At least one flashcard type must stay enabled." ? null : prev,
    );
  }

  const selectedFlashcardLabels = FLASHCARD_TYPE_OPTIONS.filter((option) =>
    flashcardSelectionMode === "manual"
      ? manualTypes[option.manualKey]
      : recommended.recommendedTypes[option.recommendedKey],
  ).map((option) => option.label);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold tracking-tight">
          Daily card amount
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Recommended is the low-burden default. Manual lets you choose an exact
          number.
        </p>
        <div className="mt-4 grid gap-3 text-sm">
          <label
            className={`app-toggle ${
              dailyPlanMode === "recommended" ? "app-toggle-active" : ""
            }`}
          >
            <input
              type="radio"
              name="daily_plan_mode"
              value="recommended"
              checked={dailyPlanMode === "recommended"}
              onChange={() => setDailyPlanMode("recommended")}
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
              dailyPlanMode === "manual" ? "app-toggle-active" : ""
            }`}
          >
            <input
              type="radio"
              name="daily_plan_mode"
              value="manual"
              checked={dailyPlanMode === "manual"}
              onChange={() => setDailyPlanMode("manual")}
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
            step={10}
            value={manualDailyLimit}
            onChange={(e) =>
              setManualDailyLimit(clampLimit(Number(e.currentTarget.value)))
            }
            disabled={dailyPlanMode !== "manual"}
            className="app-range flex-1"
          />
          <input
            type="number"
            min={10}
            max={200}
            value={manualDailyLimit}
            onChange={(e) => {
              const next = Number(e.currentTarget.value);
              if (!Number.isFinite(next)) return;
              setManualDailyLimit(clampLimit(next));
            }}
            disabled={dailyPlanMode !== "manual"}
            className="app-input app-input-no-spinner w-16 px-2 py-1 text-sm"
          />
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold tracking-tight">
          Flashcard types
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Use recommended mix or choose exactly which types to include.
        </p>
        <div className="mt-4 grid gap-3 text-sm">
          <label
            className={`app-toggle ${
              flashcardSelectionMode === "recommended"
                ? "app-toggle-active"
                : ""
            }`}
          >
            <input
              type="radio"
              name="flashcard_selection_mode"
              value="recommended"
              checked={flashcardSelectionMode === "recommended"}
              onChange={() => setFlashcardSelectionMode("recommended")}
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
              flashcardSelectionMode === "manual" ? "app-toggle-active" : ""
            }`}
          >
            <input
              type="radio"
              name="flashcard_selection_mode"
              value="manual"
              checked={flashcardSelectionMode === "manual"}
              onChange={() => setFlashcardSelectionMode("manual")}
              className="app-check app-check-round"
            />
            <span>Choose my own types</span>
          </label>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {FLASHCARD_TYPE_OPTIONS.map((option) =>
            renderTypeCheckbox(
              option.manualKey,
              option.label,
              manualTypes[option.manualKey],
              (checked) => handleManualTypeChange(option.manualKey, checked),
            ),
          )}
        </div>
        <details className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/40">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            Advanced
          </summary>
          <div className="border-t border-zinc-200 px-4 py-3 text-sm dark:border-zinc-700">
            <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
              Showing{" "}
              {flashcardSelectionMode === "manual"
                ? "manual selection"
                : "recommended selection"}
              .
            </p>
            {selectedFlashcardLabels.length > 0 ? (
              <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {selectedFlashcardLabels.map((label) => (
                  <li key={label} className="text-zinc-700 dark:text-zinc-200">
                    • {label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-zinc-600 dark:text-zinc-300">
                No flashcards selected.
              </p>
            )}
          </div>
        </details>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold tracking-tight">
          Shared options
        </h2>
        <div className="mt-4 flex flex-col gap-4 text-sm">
          <label className="flex items-center gap-3">
            <span className="w-40 text-zinc-700 dark:text-zinc-200">
              Retry delay
            </span>
            <input
              type="number"
              name="retry_delay_seconds"
              min={10}
              max={3600}
              defaultValue={userSettings.retry_delay_seconds}
              className="app-input app-input-no-spinner w-20 px-2 py-1 text-sm"
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
          Effective today: {effective.effectiveDailyLimit} cards ·{" "}
          {summarizeTypes(effective.effectiveTypes)}
        </p>
        <button type="submit" disabled={pending} className="app-button">
          {pending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}

function renderTypeCheckbox(
  name: string,
  label: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
) {
  return (
    <label key={name} className="app-toggle">
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={(e) => onChange(e.currentTarget.checked)}
          className="app-check"
        />
        <span>{label}</span>
      </span>
    </label>
  );
}

function summarizeTypes(types: { [k: string]: boolean }) {
  const enabled = Object.entries(types)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, " "));
  if (enabled.length === 0) return "no types";
  return enabled.join(", ");
}

function clampLimit(value: number) {
  return Math.min(200, Math.max(10, Math.round(value)));
}
