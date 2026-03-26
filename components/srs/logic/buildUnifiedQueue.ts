import { buildMcqOptions } from "@/components/srs/logic/buildMcqOptions";
import { buildSentencePrompt } from "@/components/srs/logic/buildSentencePrompt";
import type { EnabledFlashcardMode } from "@/lib/settings/types";
import type {
  ClozeDirection,
  TodaySession,
} from "@/lib/srs/types";

export const ALL_CARD_MODES: EnabledFlashcardMode[] = [
  "cloze_en_to_es",
  "cloze_es_to_en",
  "normal_en_to_es",
  "normal_es_to_en",
  "audio",
  "mcq",
  "sentences",
];

export const IMPLEMENTED_CARD_MODES = [
  "cloze_en_to_es",
  "cloze_es_to_en",
  "normal_en_to_es",
  "normal_es_to_en",
  "audio",
  "mcq",
  "sentences",
] as const;

export type ImplementedCardMode = (typeof IMPLEMENTED_CARD_MODES)[number];

export const TYPE_LABELS: Record<EnabledFlashcardMode, string> = {
  cloze_en_to_es: "Cloze English -> Spanish",
  cloze_es_to_en: "Cloze Spanish -> English",
  normal_en_to_es: "Normal English -> Spanish",
  normal_es_to_en: "Normal Spanish -> English",
  audio: "Audio",
  mcq: "MCQ",
  sentences: "Sentences",
};

export type UnifiedQueueSourceCard = {
  id: string;
  kind: "review" | "new";
  lemma: string;
  definition: string | null;
  rank?: number;
  hint?: string | null;
  extra?: Record<string, unknown> | null;
};

export type UnifiedQueueCard =
  | (UnifiedQueueSourceCard & {
      cardType: "cloze";
      direction: ClozeDirection;
    })
  | (UnifiedQueueSourceCard & {
      cardType: "normal";
      direction: "en_to_es";
    })
  | (UnifiedQueueSourceCard & {
      cardType: "normal";
      direction: "es_to_en";
    })
  | (UnifiedQueueSourceCard & {
      cardType: "audio";
      prompt: string;
      options: string[];
      correctOption: string;
      audioUrl: string | null;
      audioText: string;
    })
  | (UnifiedQueueSourceCard & {
      cardType: "mcq";
      prompt: string;
      options: string[];
      correctOption: string;
    })
  | (UnifiedQueueSourceCard & {
      cardType: "sentences";
      prompt: string;
      options: string[];
      correctOption: string;
      sentenceData: {
        instruction: string;
        sentence: string;
        translation: string | null;
      };
    });

export type UnifiedQueueResult = {
  queue: UnifiedQueueCard[];
  enabledImplementedTypes: ImplementedCardMode[];
  enabledUnimplementedTypes: EnabledFlashcardMode[];
};

export function buildUnifiedQueue(
  session: TodaySession,
  enabledModes: Record<EnabledFlashcardMode, boolean>,
): UnifiedQueueResult {
  const enabledList = ALL_CARD_MODES.filter((type) => enabledModes[type]);
  const enabledImplementedTypes = enabledList.filter(isImplementedCardMode);
  const enabledUnimplementedTypes = enabledList.filter(
    (type) => !isImplementedCardMode(type),
  );

  if (enabledImplementedTypes.length === 0) {
    return {
      queue: [],
      enabledImplementedTypes,
      enabledUnimplementedTypes,
    };
  }

  const baseCards = [
    ...session.dueReviews.map((card) => ({
      id: card.word_id,
      kind: "review" as const,
      lemma: card.lemma,
      definition: card.definition ?? null,
      rank: card.rank,
      hint: card.pos ?? null,
      extra: card.extra,
    })),
    ...session.newWords.map((card) => ({
      id: card.id,
      kind: "new" as const,
      lemma: card.lemma,
      definition: card.definition ?? null,
      rank: card.rank,
      hint: card.pos ?? null,
      extra: card.extra,
    })),
  ];

  const queue = baseCards.map((card, index) => {
    const cardMode = enabledImplementedTypes[index % enabledImplementedTypes.length];

    if (cardMode === "cloze_en_to_es") {
      return {
        ...card,
        cardType: "cloze" as const,
        direction: "en_to_es" as const,
      };
    }

    if (cardMode === "cloze_es_to_en") {
      return {
        ...card,
        cardType: "cloze" as const,
        direction: "es_to_en" as const,
      };
    }

    if (cardMode === "normal_en_to_es") {
      return {
        ...card,
        cardType: "normal" as const,
        direction: "en_to_es" as const,
      };
    }

    if (cardMode === "normal_es_to_en") {
      return {
        ...card,
        cardType: "normal" as const,
        direction: "es_to_en" as const,
      };
    }

    if (cardMode === "mcq") {
      const mcq = buildMcqOptions(card, baseCards);
      return {
        ...card,
        cardType: "mcq" as const,
        prompt: `What does "${card.lemma}" mean?`,
        options: mcq.options,
        correctOption: mcq.correctOption,
      };
    }

    if (cardMode === "audio") {
      const mcq = buildMcqOptions(card, baseCards);
      return {
        ...card,
        cardType: "audio" as const,
        prompt: "What does this audio mean?",
        options: mcq.options,
        correctOption: mcq.correctOption,
        audioUrl: getAudioUrl(card.extra),
        audioText: getAudioText(card),
      };
    }

    const sentence = buildSentencePrompt(card, baseCards);
    return {
      ...card,
      cardType: "sentences" as const,
      prompt: sentence.instruction,
      options: sentence.options,
      correctOption: sentence.answer,
      sentenceData: {
        instruction: sentence.instruction,
        sentence: sentence.sentence,
        translation: sentence.translation,
      },
    };
  });

  return {
    queue,
    enabledImplementedTypes,
    enabledUnimplementedTypes,
  };
}

function isImplementedCardMode(type: EnabledFlashcardMode): type is ImplementedCardMode {
  return IMPLEMENTED_CARD_MODES.includes(type as ImplementedCardMode);
}

function getAudioUrl(extra?: Record<string, unknown> | null) {
  if (!extra) return null;
  const direct = firstString([
    extra.audio_url,
    extra.audioUrl,
    extra.pronunciation_url,
    extra.pronunciationUrl,
  ]);
  if (direct) return direct;

  const audioValue = extra.audio;
  if (audioValue && typeof audioValue === "object") {
    return firstString([
      (audioValue as Record<string, unknown>).url,
      (audioValue as Record<string, unknown>).src,
    ]);
  }

  return null;
}

function getAudioText(card: UnifiedQueueSourceCard) {
  return (
    firstString([
      card.extra?.audio_text,
      card.extra?.audioText,
      card.extra?.transcript,
      card.extra?.surface,
    ]) ?? card.lemma
  );
}

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}
