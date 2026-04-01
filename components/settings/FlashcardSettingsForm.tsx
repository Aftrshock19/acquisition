"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  EffectiveFlashcardSettings,
  FlashcardFamily,
  RecommendedSettings,
  UserSettingsRow,
} from "@/lib/settings/types";
import { updateUserSettingsAction } from "@/app/actions/settings";
import type { RawSettingsInput } from "@/lib/settings/normalizeUserSettingsInput";

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

type DirectionKey =
  | "include_cloze_en_to_es"
  | "include_cloze_es_to_en"
  | "include_normal_en_to_es"
  | "include_normal_es_to_en";

type ManualTypes = Record<ManualTypeKey, boolean>;
type DirectionTypes = Record<DirectionKey, boolean>;
type RecommendedTypeKey = keyof RecommendedSettings["recommendedTypes"];

const MANUAL_TYPE_FIELDS: ManualTypeKey[] = [
  "include_cloze",
  "include_normal",
  "include_audio",
  "include_mcq",
  "include_sentences",
];

const DIRECTION_FIELDS: DirectionKey[] = [
  "include_cloze_en_to_es",
  "include_cloze_es_to_en",
  "include_normal_en_to_es",
  "include_normal_es_to_en",
];

const FLASHCARD_TYPE_OPTIONS: Array<{
  manualKey: ManualTypeKey;
  recommendedKey: RecommendedTypeKey;
  label: string;
  description: string;
}> = [
  {
    manualKey: "include_cloze",
    recommendedKey: "cloze",
    label: "Cloze",
    description: "Type the answer yourself. Direction is configured below.",
  },
  {
    manualKey: "include_normal",
    recommendedKey: "normal",
    label: "Normal",
    description: "Reveal the answer and self-grade. Direction is configured below.",
  },
  {
    manualKey: "include_mcq",
    recommendedKey: "mcq",
    label: "MCQ",
    description: "Choose the best meaning from plausible options.",
  },
  {
    manualKey: "include_sentences",
    recommendedKey: "sentences",
    label: "Sentences",
    description: "Reinforce words in short sentence context.",
  },
  {
    manualKey: "include_audio",
    recommendedKey: "audio",
    label: "Audio",
    description: "Hear Spanish audio and identify the meaning.",
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
  const [autoAdvanceCorrect, setAutoAdvanceCorrect] = useState<boolean>(
    Boolean(userSettings.auto_advance_correct),
  );
  const initialManualTypes: ManualTypes = {
    include_cloze: Boolean(userSettings.include_cloze),
    include_normal: Boolean(userSettings.include_normal),
    include_audio: Boolean(userSettings.include_audio),
    include_mcq: Boolean(userSettings.include_mcq),
    include_sentences: Boolean(userSettings.include_sentences),
  };
  const [manualTypes, setManualTypes] = useState<ManualTypes>(initialManualTypes);
  const [directionTypes, setDirectionTypes] = useState<DirectionTypes>(() =>
    ensureDirectionsForActiveFamilies({
      directionTypes: {
        include_cloze_en_to_es: Boolean(userSettings.include_cloze_en_to_es),
        include_cloze_es_to_en: Boolean(userSettings.include_cloze_es_to_en),
        include_normal_en_to_es: Boolean(userSettings.include_normal_en_to_es),
        include_normal_es_to_en: Boolean(userSettings.include_normal_es_to_en),
      },
      selectionMode: userSettings.flashcard_selection_mode,
      manualTypes: initialManualTypes,
      recommendedTypes: recommended.recommendedTypes,
    }),
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("daily_plan_mode", dailyPlanMode);
    formData.set("manual_daily_card_limit", String(manualDailyLimit));
    formData.set("flashcard_selection_mode", flashcardSelectionMode);
    for (const key of MANUAL_TYPE_FIELDS) {
      formData.set(key, String(manualTypes[key]));
    }
    for (const key of DIRECTION_FIELDS) {
      formData.set(key, String(directionTypes[key]));
    }
    formData.set("auto_advance_correct", String(autoAdvanceCorrect));
    startTransition(() => {
      void updateUserSettingsAction(
        Object.fromEntries(formData.entries()) as RawSettingsInput,
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
        setError("At least one flashcard family must stay enabled.");
        return;
      }
    }

    setManualTypes((prev) => ({ ...prev, [key]: checked }));
    if (checked && key === "include_cloze") {
      setDirectionTypes((prev) =>
        prev.include_cloze_en_to_es || prev.include_cloze_es_to_en
          ? prev
          : { ...prev, include_cloze_en_to_es: true },
      );
    }
    if (checked && key === "include_normal") {
      setDirectionTypes((prev) =>
        prev.include_normal_en_to_es || prev.include_normal_es_to_en
          ? prev
          : { ...prev, include_normal_en_to_es: true },
      );
    }
    setError((prev) =>
      prev === "At least one flashcard family must stay enabled." ? null : prev,
    );
  }

  function handleDirectionChange(key: DirectionKey, checked: boolean) {
    if (!checked && isLockedDirection(key)) {
      return;
    }
    setDirectionTypes((prev) => ({ ...prev, [key]: checked }));
  }

  function isFamilyEnabled(family: FlashcardFamily) {
    if (flashcardSelectionMode === "recommended") {
      return recommended.recommendedTypes[family];
    }

    return manualTypes[`include_${family}` as ManualTypeKey];
  }

  function isLockedDirection(key: DirectionKey) {
    const family = familyForDirection(key);
    return (
      isFamilyEnabled(family)
      && isCurrentDirectionValue(directionTypes, key)
      && !otherDirectionValue(directionTypes, key)
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      ) : null}

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
          Choose the main card families here. Direction control for Cloze and
          Normal lives in Advanced.
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
              onChange={() => {
                setFlashcardSelectionMode("recommended");
                setDirectionTypes((prev) =>
                  ensureDirectionsForActiveFamilies({
                    directionTypes: prev,
                    selectionMode: "recommended",
                    manualTypes,
                    recommendedTypes: recommended.recommendedTypes,
                  }),
                );
              }}
              className="app-check app-check-round"
            />
            <span className="flex flex-col">
              <span>Use recommended types</span>
              <span className="text-xs text-zinc-500">
                ({summarizeFamilies(recommended.recommendedTypes)})
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
              onChange={() => {
                setFlashcardSelectionMode("manual");
                setDirectionTypes((prev) =>
                  ensureDirectionsForActiveFamilies({
                    directionTypes: prev,
                    selectionMode: "manual",
                    manualTypes,
                    recommendedTypes: recommended.recommendedTypes,
                  }),
                );
              }}
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
              option.description,
              manualTypes[option.manualKey],
              (checked) => handleManualTypeChange(option.manualKey, checked),
            ),
          )}
        </div>

        <details className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/40">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            Advanced
          </summary>
          <div className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-700">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              These direction settings only apply when the main card family is enabled.
            </p>

            <div className="mt-4 grid gap-4">
              <DirectionGroup
                title="Cloze directions"
                description="Typed recall cards."
                enabled={isFamilyEnabled("cloze")}
                lockEnToEs={isLockedDirection("include_cloze_en_to_es")}
                lockEsToEn={isLockedDirection("include_cloze_es_to_en")}
                values={{
                  en_to_es: directionTypes.include_cloze_en_to_es,
                  es_to_en: directionTypes.include_cloze_es_to_en,
                }}
                onChange={(direction, checked) =>
                  handleDirectionChange(
                    direction === "en_to_es"
                      ? "include_cloze_en_to_es"
                      : "include_cloze_es_to_en",
                    checked,
                  )
                }
              />

              <DirectionGroup
                title="Normal directions"
                description="Reveal and self-grade cards."
                enabled={isFamilyEnabled("normal")}
                lockEnToEs={isLockedDirection("include_normal_en_to_es")}
                lockEsToEn={isLockedDirection("include_normal_es_to_en")}
                values={{
                  en_to_es: directionTypes.include_normal_en_to_es,
                  es_to_en: directionTypes.include_normal_es_to_en,
                }}
                onChange={(direction, checked) =>
                  handleDirectionChange(
                    direction === "en_to_es"
                      ? "include_normal_en_to_es"
                      : "include_normal_es_to_en",
                    checked,
                  )
                }
              />
            </div>
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
              name="auto_advance_correct"
              checked={autoAdvanceCorrect}
              onChange={(e) => setAutoAdvanceCorrect(e.currentTarget.checked)}
              className="app-check"
            />
            <span>Auto-next after correct answers</span>
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
        <div className="text-sm text-zinc-500">
          <p>
            Effective today: {effective.effectiveDailyLimit} cards ·{" "}
            {summarizeFamilies(effective.effectiveTypes)}
          </p>
          <p className="mt-1">
            Effective directions:{" "}
            {summarizeDirections(effective.effectiveDirections, effective.effectiveTypes)}
          </p>
        </div>
        <button type="submit" disabled={pending} className="app-button">
          {pending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}

function DirectionGroup({
  title,
  description,
  enabled,
  lockEnToEs,
  lockEsToEn,
  values,
  onChange,
}: {
  title: string;
  description: string;
  enabled: boolean;
  lockEnToEs: boolean;
  lockEsToEn: boolean;
  values: { en_to_es: boolean; es_to_en: boolean };
  onChange: (direction: "en_to_es" | "es_to_en", checked: boolean) => void;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-zinc-900 dark:text-zinc-100">{title}</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>

      {!enabled ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Turn on this family above to use its direction settings.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="app-toggle">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                name={`${title}-en-to-es`}
                checked={values.en_to_es}
                onChange={(e) => onChange("en_to_es", e.currentTarget.checked)}
                disabled={lockEnToEs}
                className="app-check"
              />
              <span>English -&gt; Spanish</span>
            </span>
          </label>
          <label className="app-toggle">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                name={`${title}-es-to-en`}
                checked={values.es_to_en}
                onChange={(e) => onChange("es_to_en", e.currentTarget.checked)}
                disabled={lockEsToEn}
                className="app-check"
              />
              <span>Spanish -&gt; English</span>
            </span>
          </label>
        </div>
      )}

      {enabled && (lockEnToEs || lockEsToEn) ? (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          At least one direction must stay on.
        </p>
      ) : null}
    </section>
  );
}

function renderTypeCheckbox(
  name: string,
  label: string,
  description: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
) {
  return (
    <label key={name} className="app-toggle">
      <span className="flex items-start gap-2">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={(e) => onChange(e.currentTarget.checked)}
          className="app-check h-4 w-4 shrink-0 rounded-sm"
        />
        <span className="flex flex-col">
          <span>{label}</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {description}
          </span>
        </span>
      </span>
    </label>
  );
}

function summarizeFamilies(types: { [k: string]: boolean }) {
  const enabled = Object.entries(types)
    .filter(([, v]) => v)
    .map(([k]) => typeLabel(k));
  if (enabled.length === 0) return "no types";
  return enabled.join(", ");
}

function summarizeDirections(
  directions: Record<string, boolean | undefined>,
  families?: Partial<Record<FlashcardFamily, boolean>>,
) {
  const parts: string[] = [];

  if (!families || families.cloze) {
    parts.push(`Cloze (${directionSummary(
      Boolean(directions.cloze_en_to_es ?? directions.include_cloze_en_to_es),
      Boolean(directions.cloze_es_to_en ?? directions.include_cloze_es_to_en),
    )})`);
  }

  if (!families || families.normal) {
    parts.push(`Normal (${directionSummary(
      Boolean(directions.normal_en_to_es ?? directions.include_normal_en_to_es),
      Boolean(directions.normal_es_to_en ?? directions.include_normal_es_to_en),
    )})`);
  }

  return parts.length > 0 ? parts.join(" · ") : "none";
}

function directionSummary(enToEs: boolean, esToEn: boolean) {
  if (enToEs && esToEn) return "both";
  if (enToEs) return "English -> Spanish";
  if (esToEn) return "Spanish -> English";
  return "off";
}

function typeLabel(key: string) {
  return key.replace(/_/g, " ");
}

function clampLimit(value: number) {
  return Math.min(200, Math.max(10, Math.round(value)));
}

function familyForDirection(key: DirectionKey): FlashcardFamily {
  return key.startsWith("include_cloze") ? "cloze" : "normal";
}

function otherDirectionValue(directionTypes: DirectionTypes, key: DirectionKey) {
  switch (key) {
    case "include_cloze_en_to_es":
      return directionTypes.include_cloze_es_to_en;
    case "include_cloze_es_to_en":
      return directionTypes.include_cloze_en_to_es;
    case "include_normal_en_to_es":
      return directionTypes.include_normal_es_to_en;
    case "include_normal_es_to_en":
      return directionTypes.include_normal_en_to_es;
  }
}

function isCurrentDirectionValue(directionTypes: DirectionTypes, key: DirectionKey) {
  return directionTypes[key];
}

function ensureDirectionsForActiveFamilies(args: {
  directionTypes: DirectionTypes;
  selectionMode: "recommended" | "manual";
  manualTypes: ManualTypes;
  recommendedTypes: RecommendedSettings["recommendedTypes"];
}) {
  const { directionTypes, selectionMode, manualTypes, recommendedTypes } = args;
  const next = { ...directionTypes };
  const clozeEnabled =
    selectionMode === "recommended"
      ? recommendedTypes.cloze
      : manualTypes.include_cloze;
  const normalEnabled =
    selectionMode === "recommended"
      ? recommendedTypes.normal
      : manualTypes.include_normal;

  if (
    clozeEnabled
    && !next.include_cloze_en_to_es
    && !next.include_cloze_es_to_en
  ) {
    next.include_cloze_en_to_es = true;
  }

  if (
    normalEnabled
    && !next.include_normal_en_to_es
    && !next.include_normal_es_to_en
  ) {
    next.include_normal_en_to_es = true;
  }

  return next;
}
