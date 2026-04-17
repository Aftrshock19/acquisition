import { describe, expect, it } from "vitest";
import { buildUnifiedQueue } from "@/components/srs/logic/buildUnifiedQueue";
import type { TodaySession } from "@/lib/srs/types";
import { normalizeUserSettingsInput } from "./normalizeUserSettingsInput";
import { resolveEffectiveSettings } from "./resolveEffectiveSettings";
import type { RecommendedSettings, UserSettingsRow } from "./types";

const RECOMMENDED: RecommendedSettings = {
  recommendedDailyLimit: 20,
  recommendedTypes: {
    cloze: true,
    normal: true,
    audio: false,
    mcq: false,
    sentences: false,
  },
};

describe("flashcard direction flow", () => {
  it("preserves explicit Spanish -> English selections when normalizing settings input", () => {
    const normalized = normalizeUserSettingsInput({
      flashcard_selection_mode: "manual",
      include_cloze: "true",
      include_normal: "true",
      include_audio: "false",
      include_mcq: "false",
      include_sentences: "false",
      include_cloze_en_to_es: "false",
      include_cloze_es_to_en: "true",
      include_normal_en_to_es: "false",
      include_normal_es_to_en: "true",
    });

    expect(normalized.include_cloze_en_to_es).toBe(false);
    expect(normalized.include_cloze_es_to_en).toBe(true);
    expect(normalized.include_normal_en_to_es).toBe(false);
    expect(normalized.include_normal_es_to_en).toBe(true);
  });

  it("maps manual Spanish -> English-only settings to the correct enabled modes", () => {
    const effective = resolveEffectiveSettings(
      makeSettings({
        flashcard_selection_mode: "manual",
        include_cloze: true,
        include_normal: true,
        include_cloze_en_to_es: false,
        include_cloze_es_to_en: true,
        include_normal_en_to_es: false,
        include_normal_es_to_en: true,
      }),
      RECOMMENDED,
    );

    expect(effective.enabledModes).toEqual({
      cloze_en_to_es: false,
      cloze_es_to_en: true,
      normal_en_to_es: false,
      normal_es_to_en: true,
      audio: false,
      mcq: false,
      sentences: false,
    });
  });

  it("maps manual English -> Spanish-only settings to the correct enabled modes", () => {
    const effective = resolveEffectiveSettings(
      makeSettings({
        flashcard_selection_mode: "manual",
        include_cloze: true,
        include_normal: true,
        include_cloze_en_to_es: true,
        include_cloze_es_to_en: false,
        include_normal_en_to_es: true,
        include_normal_es_to_en: false,
      }),
      RECOMMENDED,
    );

    expect(effective.enabledModes).toEqual({
      cloze_en_to_es: true,
      cloze_es_to_en: false,
      normal_en_to_es: true,
      normal_es_to_en: false,
      audio: false,
      mcq: false,
      sentences: false,
    });
  });

  it("builds only Spanish -> English normal and cloze cards when only es_to_en modes are enabled", () => {
    const queue = buildUnifiedQueue(makeSession(), {
      cloze_en_to_es: false,
      cloze_es_to_en: true,
      normal_en_to_es: false,
      normal_es_to_en: true,
      audio: false,
      mcq: false,
      sentences: false,
    }).queue;

    const directionalCards = queue.filter(
      (
        card,
      ): card is Extract<
        (typeof queue)[number],
        { cardType: "cloze" | "normal" }
      > => card.cardType === "cloze" || card.cardType === "normal",
    );

    expect(directionalCards.length).toBeGreaterThan(0);
    expect(directionalCards.every((card) => card.direction === "es_to_en")).toBe(true);
  });

  it("builds only English -> Spanish normal and cloze cards when only en_to_es modes are enabled", () => {
    const queue = buildUnifiedQueue(makeSession(), {
      cloze_en_to_es: true,
      cloze_es_to_en: false,
      normal_en_to_es: true,
      normal_es_to_en: false,
      audio: false,
      mcq: false,
      sentences: false,
    }).queue;

    const directionalCards = queue.filter(
      (
        card,
      ): card is Extract<
        (typeof queue)[number],
        { cardType: "cloze" | "normal" }
      > => card.cardType === "cloze" || card.cardType === "normal",
    );

    expect(directionalCards.length).toBeGreaterThan(0);
    expect(directionalCards.every((card) => card.direction === "en_to_es")).toBe(true);
  });

  it("normalizes the auto-advance setting as a boolean", () => {
    const normalized = normalizeUserSettingsInput({
      auto_advance_correct: "false",
    });

    expect(normalized.auto_advance_correct).toBe(false);
  });

  it("exposes auto-advance in effective settings", () => {
    const effective = resolveEffectiveSettings(
      makeSettings({
        auto_advance_correct: false,
      }),
      RECOMMENDED,
    );

    expect(effective.autoAdvanceCorrect).toBe(false);
  });

  it("defaults hide translation for sentence cards to false", () => {
    const effective = resolveEffectiveSettings(makeSettings(), RECOMMENDED);

    expect(effective.hideTranslationSentences).toBe(false);
  });

  it("normalizes hide translation for sentence cards as a boolean", () => {
    const normalized = normalizeUserSettingsInput({
      hide_translation_sentences: "true",
    });

    expect(normalized.hide_translation_sentences).toBe(true);
  });

  it("builds only single-word MCQ cards when only the single-word format is selected", () => {
    const queue = buildUnifiedQueue(
      makeSession(),
      {
        cloze_en_to_es: false,
        cloze_es_to_en: false,
        normal_en_to_es: false,
        normal_es_to_en: false,
        audio: false,
        mcq: true,
        sentences: false,
      },
      ["single_word"],
    ).queue;

    const mcqCards = queue.filter(
      (card): card is Extract<(typeof queue)[number], { cardType: "mcq" }> =>
        card.cardType === "mcq",
    );

    expect(mcqCards.length).toBeGreaterThan(0);
    expect(mcqCards.every((card) => card.questionFormat === "single_word")).toBe(true);
    expect(mcqCards.every((card) => !card.sentenceData)).toBe(true);
  });

  it("builds only sentence MCQ cards when only the sentence format is selected", () => {
    const queue = buildUnifiedQueue(
      makeSession(),
      {
        cloze_en_to_es: false,
        cloze_es_to_en: false,
        normal_en_to_es: false,
        normal_es_to_en: false,
        audio: false,
        mcq: true,
        sentences: false,
      },
      ["sentence"],
    ).queue;

    const mcqCards = queue.filter(
      (card): card is Extract<(typeof queue)[number], { cardType: "mcq" }> =>
        card.cardType === "mcq",
    );

    expect(mcqCards.length).toBeGreaterThan(0);
    expect(mcqCards.every((card) => card.questionFormat === "sentence")).toBe(true);
    expect(mcqCards.every((card) => Boolean(card.sentenceData?.sentence))).toBe(true);
  });

  it("keeps sentence cards as their own family regardless of MCQ question format selection", () => {
    const queue = buildUnifiedQueue(
      makeSession(),
      {
        cloze_en_to_es: false,
        cloze_es_to_en: false,
        normal_en_to_es: false,
        normal_es_to_en: false,
        audio: false,
        mcq: false,
        sentences: true,
      },
      ["single_word"],
    ).queue;

    expect(queue.every((card) => card.cardType === "sentences")).toBe(true);
  });
});

function makeSettings(overrides: Partial<UserSettingsRow> = {}): UserSettingsRow {
  return {
    user_id: "user-1",
    learning_lang: "es",
    daily_plan_mode: "manual",
    manual_daily_card_limit: 30,
    flashcard_selection_mode: "manual",
    include_cloze: true,
    include_normal: true,
    include_audio: false,
    include_mcq: false,
    include_sentences: false,
    include_cloze_en_to_es: true,
    include_cloze_es_to_en: false,
    include_normal_en_to_es: true,
    include_normal_es_to_en: false,
    retry_delay_seconds: 90,
    auto_advance_correct: true,
    show_pos_hint: true,
    show_definition_first: true,
    hide_translation_sentences: false,
    remove_daily_limit: false,
    scheduler_variant: "baseline",
    has_seen_intro: false,
    onboarding_completed_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

function makeSession(): TodaySession {
  return {
    dueReviews: [
      {
        id: "review-1",
        word_id: "review-1",
        language: "es",
        lemma: "hola",
        rank: 1,
        definition: "hello",
        exampleSentence: "Hola, amigo.",
        user_id: "user-1",
        status: "learning",
        pos: "interjection",
        extra: null,
      },
      {
        id: "review-2",
        word_id: "review-2",
        language: "es",
        lemma: "adios",
        rank: 2,
        definition: "goodbye",
        exampleSentence: "Adios por ahora.",
        user_id: "user-1",
        status: "learning",
        pos: "interjection",
        extra: null,
      },
    ],
    newWords: [
      {
        id: "new-1",
        language: "es",
        lemma: "gracias",
        rank: 3,
        definition: "thanks",
        exampleSentence: "Muchas gracias por venir.",
        pos: "interjection",
        extra: null,
      },
      {
        id: "new-2",
        language: "es",
        lemma: "libro",
        rank: 4,
        definition: "book",
        exampleSentence: "El libro está aquí.",
        pos: "noun",
        extra: null,
      },
    ],
  };
}
