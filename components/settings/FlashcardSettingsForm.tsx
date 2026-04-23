"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  EffectiveFlashcardSettings,
  FlashcardFamily,
  RecommendedSettings,
  UserSettingsRow,
} from "@/lib/settings/types";
import type { McqQuestionFormat } from "@/lib/settings/mcqQuestionFormats";
import { updateUserSettingsAction } from "@/app/actions/settings";
import type { RawSettingsInput } from "@/lib/settings/normalizeUserSettingsInput";

type Props = {
  userSettings: UserSettingsRow;
  mcqQuestionFormats: McqQuestionFormat[];
  recommended: RecommendedSettings;
  effective: EffectiveFlashcardSettings;
  todayCompletedCount: number;
  effectiveDailyTargetMode: 'recommended' | 'manual' | null;
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
type McqQuestionFormats = Record<McqQuestionFormat, boolean>;
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
    description:
      "Reveal the answer and self-grade. Direction is configured below.",
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
  mcqQuestionFormats: initialMcqQuestionFormats,
  recommended,
  effective,
  todayCompletedCount,
  effectiveDailyTargetMode,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Client-side floor: user cannot set a target below cards already practiced
  // today. The server action in updateUserSettingsAction is authoritative; this
  // is purely a UI affordance that prevents reaching an invalid state.
  const effectiveMin = Math.max(1, todayCompletedCount);
  // Standard slider maxes out at 200. If the user has already done more than
  // 200 today, the floor would exceed the standard ceiling, so we force
  // remove_daily_limit on in the form. The toggle is disabled below so the
  // user cannot turn it back off while the floor requires the extended range.
  const forceRemoveLimit = todayCompletedCount > 200;

  // Override state: today's session has been flagged as effectively manual
  // (user completed past recommendation or extended in recommended mode) but
  // the user's stated preference is still 'recommended'. The recommended
  // radio is disabled for today only; we show the form as 'manual' so the
  // number input is usable, but we omit daily_plan_mode from submit so
  // user_settings.daily_plan_mode stays 'recommended' for tomorrow.
  const isOverridden =
    effectiveDailyTargetMode === "manual" &&
    userSettings.daily_plan_mode === "recommended";

  const [dailyPlanMode, setDailyPlanMode] = useState<"recommended" | "manual">(
    isOverridden ? "manual" : userSettings.daily_plan_mode,
  );
  const [flashcardSelectionMode, setFlashcardSelectionMode] = useState<
    "recommended" | "manual"
  >(userSettings.flashcard_selection_mode);
  const [manualDailyLimit, setManualDailyLimit] = useState<number>(
    Math.max(effectiveMin, userSettings.manual_daily_card_limit),
  );
  const [removeDailyLimit, setRemoveDailyLimit] = useState<boolean>(
    forceRemoveLimit || Boolean(userSettings.remove_daily_limit),
  );
  const [autoAdvanceCorrect, setAutoAdvanceCorrect] = useState<boolean>(
    Boolean(userSettings.auto_advance_correct),
  );
  const [hideTranslationSentences, setHideTranslationSentences] =
    useState<boolean>(Boolean(userSettings.hide_translation_sentences));
  const [mcqQuestionFormats, setMcqQuestionFormats] =
    useState<McqQuestionFormats>({
      single_word: initialMcqQuestionFormats.includes("single_word"),
      sentence: initialMcqQuestionFormats.includes("sentence"),
    });
  const initialManualTypes: ManualTypes = {
    include_cloze: Boolean(userSettings.include_cloze),
    include_normal: Boolean(userSettings.include_normal),
    include_audio: Boolean(userSettings.include_audio),
    include_mcq: Boolean(userSettings.include_mcq),
    include_sentences: Boolean(userSettings.include_sentences),
  };
  const [manualTypes, setManualTypes] =
    useState<ManualTypes>(initialManualTypes);
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
    if (
      isFamilyEnabled("mcq") &&
      !mcqQuestionFormats.single_word &&
      !mcqQuestionFormats.sentence
    ) {
      setError("Select at least one MCQ question format.");
      return;
    }
    // Final clamp: user may have typed a value below the floor without
    // triggering blur (e.g. submit via Enter). The server action validates
    // anyway, but normalize here so the formData reflects what we'll display.
    const clampedManualDailyLimit = clampLimit(
      manualDailyLimit,
      removeDailyLimit,
      effectiveMin,
    );
    if (clampedManualDailyLimit !== manualDailyLimit) {
      setManualDailyLimit(clampedManualDailyLimit);
    }
    const formData = new FormData(e.currentTarget);
    // When overridden, we display 'manual' but must NOT persist that choice
    // to user_settings.daily_plan_mode — the override is today-only, and the
    // user's preference for tomorrow stays 'recommended'. Omit the field
    // entirely so the server's upsert leaves the column untouched.
    if (isOverridden) {
      formData.delete("daily_plan_mode");
    } else {
      formData.set("daily_plan_mode", dailyPlanMode);
    }
    formData.set("manual_daily_card_limit", String(clampedManualDailyLimit));
    formData.set("remove_daily_limit", String(removeDailyLimit));
    formData.set("flashcard_selection_mode", flashcardSelectionMode);
    for (const key of MANUAL_TYPE_FIELDS) {
      formData.set(key, String(manualTypes[key]));
    }
    for (const key of DIRECTION_FIELDS) {
      formData.set(key, String(directionTypes[key]));
    }
    formData.set("auto_advance_correct", String(autoAdvanceCorrect));
    formData.set(
      "hide_translation_sentences",
      String(hideTranslationSentences),
    );
    formData.set(
      "mcq_question_formats",
      serializeSelectedMcqQuestionFormats(mcqQuestionFormats),
    );
    startTransition(() => {
      void updateUserSettingsAction(
        Object.fromEntries(formData.entries()) as RawSettingsInput & {
          mcq_question_formats: string;
        },
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

  function handleMcqQuestionFormatChange(
    key: McqQuestionFormat,
    checked: boolean,
  ) {
    if (!checked && isMcqQuestionFormatLocked(key)) {
      setError("Select at least one MCQ question format.");
      return;
    }

    setMcqQuestionFormats((prev) => ({ ...prev, [key]: checked }));
    setError((prev) =>
      prev === "Select at least one MCQ question format." ? null : prev,
    );
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
      isFamilyEnabled(family) &&
      isCurrentDirectionValue(directionTypes, key) &&
      !otherDirectionValue(directionTypes, key)
    );
  }

  function isMcqQuestionFormatLocked(key: McqQuestionFormat) {
    return (
      isFamilyEnabled("mcq") &&
      mcqQuestionFormats[key] &&
      !otherMcqQuestionFormatValue(mcqQuestionFormats, key)
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
          Daily flashcard target
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          This sets how many cards you start with each day. You can always do
          more later.
        </p>
        <div className="mt-4 grid gap-3 text-sm">
          <label
            className={`app-toggle ${
              dailyPlanMode === "recommended" ? "app-toggle-active" : ""
            } ${isOverridden ? "opacity-60" : ""}`}
          >
            <input
              type="radio"
              name="daily_plan_mode"
              value="recommended"
              checked={dailyPlanMode === "recommended"}
              disabled={isOverridden}
              onChange={() => setDailyPlanMode("recommended")}
              className="app-check app-check-round"
            />
            <span className="flex flex-col">
              <span>Recommended</span>
              <span className="text-xs text-zinc-500">
                ({recommended.recommendedDailyLimit} cards/day)
              </span>
              {isOverridden ? (
                <span className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  You&apos;ve completed more than today&apos;s recommendation.
                  Available again tomorrow.
                </span>
              ) : null}
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
              onChange={() => {
                setDailyPlanMode("manual");
                setManualDailyLimit(recommended.recommendedDailyLimit);
              }}
              className="app-check app-check-round"
            />
            <span>Choose my own target</span>
          </label>
        </div>
        {dailyPlanMode === "manual" ? (
          <div className="mt-5 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={valueToMinTick(effectiveMin, getSliderValues(removeDailyLimit))}
                max={getSliderValues(removeDailyLimit).length - 1}
                step={1}
                value={valueToTick(
                  manualDailyLimit,
                  getSliderValues(removeDailyLimit),
                )}
                onChange={(e) => {
                  const values = getSliderValues(removeDailyLimit);
                  const v = values[Number(e.currentTarget.value)] ?? effectiveMin;
                  setManualDailyLimit(clampLimit(v, removeDailyLimit, effectiveMin));
                }}
                className="app-range flex-1"
              />
              <input
                type="number"
                name="manual_daily_card_limit"
                min={effectiveMin}
                max={removeDailyLimit ? 9999 : 200}
                value={manualDailyLimit}
                onChange={(e) => {
                  const next = Number(e.currentTarget.value);
                  if (!Number.isFinite(next)) return;
                  // Upper-bound clamp only here; lower-bound enforced on blur
                  // so typing a larger number (e.g. "27" when min is 15) isn't
                  // interrupted after the first digit.
                  const max = removeDailyLimit ? 9999 : 200;
                  setManualDailyLimit(
                    Math.min(max, Math.max(1, Math.round(next))),
                  );
                }}
                onBlur={() => {
                  setManualDailyLimit((prev) =>
                    clampLimit(prev, removeDailyLimit, effectiveMin),
                  );
                }}
                className="app-input app-input-no-spinner w-20 px-2 py-1 text-sm"
              />
            </div>
            <TargetGuidance value={manualDailyLimit} />
            <div className="mt-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <label className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={removeDailyLimit}
                  disabled={forceRemoveLimit}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    setRemoveDailyLimit(checked);
                    if (!checked && manualDailyLimit > 200) {
                      setManualDailyLimit(200);
                    }
                  }}
                  className="app-check h-3.5 w-3.5"
                />
                <span>No ceiling</span>
              </label>
              <p className="mt-1 pl-6 text-xs text-zinc-400 dark:text-zinc-500">
                {forceRemoveLimit
                  ? "You've completed more than 200 cards today; the limit is automatically removed."
                  : "Allows targets above 200 for advanced practice needs."}
              </p>
            </div>
          </div>
        ) : null}
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
              These direction settings only apply when the main card family is
              enabled.
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

              <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
                <div className="flex flex-col gap-1">
                  <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                    MCQ question format
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Choose how MCQ questions are shown. Select at least one.
                  </p>
                </div>
                {!isFamilyEnabled("mcq") ? (
                  <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                    Turn on this family above to use its question format
                    settings.
                  </p>
                ) : (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="app-toggle">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="mcq_question_format_single_word"
                          checked={mcqQuestionFormats.single_word}
                          onChange={(e) =>
                            handleMcqQuestionFormatChange(
                              "single_word",
                              e.currentTarget.checked,
                            )
                          }
                          disabled={isMcqQuestionFormatLocked("single_word")}
                          className="app-check"
                        />
                        <span>Single word</span>
                      </span>
                    </label>
                    <div className="flex flex-col gap-2">
                      <label className="app-toggle">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="mcq_question_format_sentence"
                            checked={mcqQuestionFormats.sentence}
                            onChange={(e) =>
                              handleMcqQuestionFormatChange(
                                "sentence",
                                e.currentTarget.checked,
                              )
                            }
                            disabled={isMcqQuestionFormatLocked("sentence")}
                            className="app-check"
                          />
                          <span>Sentence</span>
                        </span>
                      </label>
                      {mcqQuestionFormats.sentence ? (
                        <div
                          className="ml-6 w-[calc(100%-1.5rem)] border-l-2 border-zinc-200 pl-3 dark:border-zinc-700"
                          data-testid="mcq-hide-translation-row"
                        >
                          <label className="app-toggle w-full">
                            <span className="flex w-full items-center gap-2">
                              <input
                                type="checkbox"
                                name="mcq_hide_translation"
                                checked={hideTranslationSentences}
                                onChange={(e) =>
                                  setHideTranslationSentences(
                                    e.currentTarget.checked,
                                  )
                                }
                                className="app-check"
                              />
                              <span>Hide translation</span>
                            </span>
                          </label>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
                {isFamilyEnabled("mcq") &&
                (isMcqQuestionFormatLocked("single_word") ||
                  isMcqQuestionFormatLocked("sentence")) ? (
                  <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                    At least one question format must stay on.
                  </p>
                ) : null}
              </section>

              {isFamilyEnabled("sentences") ? (
                <section
                  className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900/50"
                  data-testid="sentences-hide-translation-section"
                >
                  <div className="flex flex-col gap-1">
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                      Sentence translation
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Hide the translation on Sentence cards so the learner
                      answers from sentence context only.
                    </p>
                  </div>
                  <div className="mt-4 grid gap-3">
                    <label className="app-toggle">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="hide_translation_sentences"
                          checked={hideTranslationSentences}
                          onChange={(e) =>
                            setHideTranslationSentences(e.currentTarget.checked)
                          }
                          className="app-check"
                        />
                        <span>Hide translation</span>
                      </span>
                    </label>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </details>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold tracking-tight">
          Shared options
        </h2>
        <div className="mt-4 flex flex-col gap-4 text-sm">
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
            {summarizeDirections(
              effective.effectiveDirections,
              effective.effectiveTypes,
            )}
          </p>
          <p className="mt-1">
            MCQ question format:{" "}
            {summarizeMcqQuestionFormats(mcqQuestionFormats)}
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
        <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
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
    parts.push(
      `Cloze (${directionSummary(
        Boolean(directions.cloze_en_to_es ?? directions.include_cloze_en_to_es),
        Boolean(directions.cloze_es_to_en ?? directions.include_cloze_es_to_en),
      )})`,
    );
  }

  if (!families || families.normal) {
    parts.push(
      `Normal (${directionSummary(
        Boolean(
          directions.normal_en_to_es ?? directions.include_normal_en_to_es,
        ),
        Boolean(
          directions.normal_es_to_en ?? directions.include_normal_es_to_en,
        ),
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

function typeLabel(key: string) {
  return key.replace(/_/g, " ");
}

function clampLimit(value: number, removeDailyLimit = false, min = 1) {
  const max = removeDailyLimit ? 9999 : 200;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Explicit slider value schedule
// ---------------------------------------------------------------------------
// The slider operates on index/tick space over a fixed list of allowed values.
// The numeric input remains exact value-space — typed values are preserved
// even if they don't land on a slider stop.
// ---------------------------------------------------------------------------

function range(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let v = start; v <= end; v += step) out.push(v);
  return out;
}

const STANDARD_SLIDER_VALUES: number[] = [
  ...range(1, 20, 1), // 1–20 by 1
  ...range(25, 100, 5), // 25–100 by 5
  ...range(110, 200, 10), // 110–200 by 10
];

const EXTENDED_SLIDER_VALUES: number[] = [
  ...STANDARD_SLIDER_VALUES,
  ...range(225, 500, 25), // 225–500 by 25
  ...range(550, 1000, 50), // 550–1000 by 50
  ...range(1100, 3000, 100), // 1100–3000 by 100
  ...range(3250, 9750, 250), // 3250–9750 by 250
  9999, // exact cap
];

function getSliderValues(removeLimitEnabled: boolean): number[] {
  return removeLimitEnabled ? EXTENDED_SLIDER_VALUES : STANDARD_SLIDER_VALUES;
}

/** Return the index of the first entry in `values` that is >= `value`. */
function valueToMinTick(value: number, values: number[]): number {
  for (let i = 0; i < values.length; i++) {
    if (values[i] >= value) return i;
  }
  return values.length - 1;
}

/** Snap a value to the nearest entry in the values array, return its index. */
function valueToTick(value: number, values: number[]): number {
  let best = 0;
  let bestDist = Math.abs(value - values[0]);
  for (let i = 1; i < values.length; i++) {
    const dist = Math.abs(value - values[i]);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
    if (values[i] >= value) break; // values are sorted, no need to keep going
  }
  return best;
}

const MILESTONES_STANDARD = [1, 25, 50, 100, 200];
const MILESTONES_EXTENDED = [1, 25, 50, 100, 200, 500, 1000, 3000, 9999];

function SliderMilestones({ removeLimit }: { removeLimit: boolean }) {
  const values = getSliderValues(removeLimit);
  const milestones = removeLimit ? MILESTONES_EXTENDED : MILESTONES_STANDARD;
  const maxTick = values.length - 1;
  if (maxTick <= 0) return null;
  return (
    <div className="relative h-4 select-none" aria-hidden>
      {milestones.map((v) => {
        const t = valueToTick(v, values);
        const pct = (t / maxTick) * 100;
        return (
          <span
            key={v}
            className="absolute -translate-x-1/2 text-[10px] text-zinc-400 dark:text-zinc-500"
            style={{ left: `${pct}%` }}
          >
            {v >= 1000 ? `${v / 1000}k` : v}
          </span>
        );
      })}
    </div>
  );
}

function TargetGuidance({ value }: { value: number }) {
  if (value >= 501) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Very ambitious target. This may build up future reviews quickly.
      </p>
    );
  }
  if (value >= 251) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Ambitious target.
      </p>
    );
  }
  return null;
}

function familyForDirection(key: DirectionKey): FlashcardFamily {
  return key.startsWith("include_cloze") ? "cloze" : "normal";
}

function otherDirectionValue(
  directionTypes: DirectionTypes,
  key: DirectionKey,
) {
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

function otherMcqQuestionFormatValue(
  formats: McqQuestionFormats,
  key: McqQuestionFormat,
) {
  return key === "single_word" ? formats.sentence : formats.single_word;
}

function serializeSelectedMcqQuestionFormats(formats: McqQuestionFormats) {
  return [
    formats.single_word ? "single_word" : null,
    formats.sentence ? "sentence" : null,
  ]
    .filter(Boolean)
    .join(",");
}

function summarizeMcqQuestionFormats(formats: McqQuestionFormats) {
  const enabled = [
    formats.single_word ? "Single word" : null,
    formats.sentence ? "Sentence" : null,
  ].filter(Boolean);

  return enabled.length > 0 ? enabled.join(", ") : "Single word";
}

function isCurrentDirectionValue(
  directionTypes: DirectionTypes,
  key: DirectionKey,
) {
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
    clozeEnabled &&
    !next.include_cloze_en_to_es &&
    !next.include_cloze_es_to_en
  ) {
    next.include_cloze_en_to_es = true;
  }

  if (
    normalEnabled &&
    !next.include_normal_en_to_es &&
    !next.include_normal_es_to_en
  ) {
    next.include_normal_en_to_es = true;
  }

  return next;
}
