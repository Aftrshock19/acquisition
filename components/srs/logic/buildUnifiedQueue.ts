import { buildMcqOptions } from "@/components/srs/logic/buildMcqOptions";
import {
  buildSentenceMcqOptions,
  buildSentencePrompt,
} from "@/components/srs/logic/buildSentencePrompt";
import type { McqQuestionFormat } from "@/lib/settings/mcqQuestionFormats";
import type { EnabledFlashcardMode } from "@/lib/settings/types";
import { formatPartOfSpeech } from "@/lib/srs/partOfSpeech";
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
  translation?: string | null;
  definition: string | null;
  definitionEs?: string | null;
  definitionEn?: string | null;
  exampleSentence?: string | null;
  exampleSentenceEn?: string | null;
  rank?: number;
  pos?: string | null;
  hint?: string | null;
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
      questionFormat: McqQuestionFormat;
      prompt: string;
      options: string[];
      correctOption: string;
      sentenceData?: {
        sentence: string;
      };
    })
  | (UnifiedQueueSourceCard & {
      cardType: "sentences";
      prompt: string;
      correctOption: string;
      sentenceData: {
        instruction: string;
        sentence: string;
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
  mcqQuestionFormats: readonly McqQuestionFormat[] = ["single_word"],
): UnifiedQueueResult {
  debugQueueBuild("input", {
    enabledModes,
    dueReviews: session.dueReviews.length,
    newWords: session.newWords.length,
  });

  const enabledList = ALL_CARD_MODES.filter((type) => enabledModes[type]);
  const enabledImplementedTypes = enabledList.filter(isImplementedCardMode);
  const enabledUnimplementedTypes = enabledList.filter(
    (type) => !isImplementedCardMode(type),
  );

  if (enabledImplementedTypes.length === 0) {
    debugQueueBuild("output", {
      enabledImplementedTypes,
      enabledUnimplementedTypes,
      normalDirections: [],
      clozeDirections: [],
    });
    return {
      queue: [],
      enabledImplementedTypes,
      enabledUnimplementedTypes,
    };
  }

  // Reviews come first so they win on duplicate word_id collision
  const rawCards = [
    ...session.dueReviews.map((card) => ({
      id: card.word_id,
      kind: "review" as const,
      lemma: card.lemma,
      translation: card.translation ?? null,
      definition: card.definition ?? null,
      definitionEs: card.definitionEs ?? null,
      definitionEn: card.definitionEn ?? null,
      exampleSentence: card.exampleSentence ?? null,
      exampleSentenceEn: card.exampleSentenceEn ?? null,
      rank: card.rank,
      pos: card.pos ?? null,
      hint: formatPartOfSpeech(card.pos),
    })),
    ...session.newWords.map((card) => ({
      id: card.id,
      kind: "new" as const,
      lemma: card.lemma,
      translation: card.translation ?? null,
      definition: card.definition ?? null,
      definitionEs: card.definitionEs ?? null,
      definitionEn: card.definitionEn ?? null,
      exampleSentence: card.exampleSentence ?? null,
      exampleSentenceEn: card.exampleSentenceEn ?? null,
      rank: card.rank,
      pos: card.pos ?? null,
      hint: formatPartOfSpeech(card.pos),
    })),
  ];

  // Deduplicate by word ID — first occurrence wins (reviews before new words)
  const seenIds = new Set<string>();
  const baseCards = rawCards.filter((card) => {
    if (seenIds.has(card.id)) return false;
    seenIds.add(card.id);
    return true;
  });

  let mcqIndex = 0;
  const queue: UnifiedQueueCard[] = baseCards.map((card, index) => {
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
      const questionFormat =
        mcqQuestionFormats[mcqIndex % mcqQuestionFormats.length] ?? "single_word";
      mcqIndex += 1;

      if (questionFormat === "sentence") {
        const sentencePrompt = buildSentencePrompt(card);
        const mcq = buildSentenceMcqOptions(card, baseCards);
        return {
          ...card,
          cardType: "mcq" as const,
          questionFormat,
          prompt: "Which word completes the sentence?",
          options: mcq.options,
          correctOption: mcq.correctOption,
          sentenceData: {
            sentence: sentencePrompt.sentence,
          },
        };
      }

      const mcq = buildMcqOptions(card, baseCards);
      return {
        ...card,
        cardType: "mcq" as const,
        questionFormat,
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
        audioUrl: null,
        audioText: getAudioText(card),
      };
    }

    const sentence = buildSentencePrompt(card);
    return {
      ...card,
      cardType: "sentences" as const,
      prompt: sentence.instruction,
      correctOption: sentence.answer,
      sentenceData: {
        instruction: sentence.instruction,
        sentence: sentence.sentence,
      },
    };
  });

  debugQueueBuild("output", {
    enabledImplementedTypes,
    enabledUnimplementedTypes,
    normalDirections: queue
      .filter((card): card is Extract<UnifiedQueueCard, { cardType: "normal" }> => card.cardType === "normal")
      .map((card) => ({ id: card.id, direction: card.direction })),
    clozeDirections: queue
      .filter((card): card is Extract<UnifiedQueueCard, { cardType: "cloze" }> => card.cardType === "cloze")
      .map((card) => ({ id: card.id, direction: card.direction })),
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

function getAudioText(card: UnifiedQueueSourceCard) {
  return card.exampleSentence ?? card.lemma;
}

const SRS_QUEUE_DEBUG_LOGS_ENABLED = process.env.NEXT_PUBLIC_SRS_QUEUE_DEBUG === "1";

function debugQueueBuild(
  stage: "input" | "output",
  value: Record<string, unknown>,
) {
  if (!SRS_QUEUE_DEBUG_LOGS_ENABLED) return;
  console.log(`[srs:queue] ${stage}`, value);
}
