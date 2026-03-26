import frequencySeed from "@/data/spanish-frequency.json";

type CandidateWord = {
  id: string;
  lemma: string;
  definition: string | null;
  hint?: string | null;
  rank?: number;
  extra?: Record<string, unknown> | null;
};

type SentencePromptData = {
  instruction: string;
  sentence: string;
  translation: string | null;
  answer: string;
  options: string[];
};

type SeedWord = {
  rank: number;
  word: string;
  meaning: string;
};

const seedWords = frequencySeed as SeedWord[];

export function buildSentencePrompt(
  target: CandidateWord,
  pool: CandidateWord[],
): SentencePromptData {
  const extracted = extractSentence(target);
  const sentence = extracted
    ? maskLemma(extracted.sentence, target.lemma)
    : buildFallbackSentence(target);
  const options = buildSentenceOptions(target, pool);

  return {
    instruction: "Choose the word that best completes the sentence.",
    sentence,
    translation: extracted?.translation ?? null,
    answer: target.lemma,
    options,
  };
}

function buildSentenceOptions(target: CandidateWord, pool: CandidateWord[]) {
  const candidates = pool
    .filter((candidate) => candidate.id !== target.id && candidate.lemma !== target.lemma)
    .map((candidate) => ({
      lemma: candidate.lemma,
      samePos: candidate.hint && target.hint ? candidate.hint === target.hint : false,
      rankDistance:
        typeof candidate.rank === "number" && typeof target.rank === "number"
          ? Math.abs(candidate.rank - target.rank)
          : Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => {
      if (left.samePos !== right.samePos) return left.samePos ? -1 : 1;
      if (left.rankDistance !== right.rankDistance) {
        return left.rankDistance - right.rankDistance;
      }
      return left.lemma.localeCompare(right.lemma);
    });

  const distractors = uniqueStrings(candidates.map((candidate) => candidate.lemma)).slice(0, 3);

  if (distractors.length < 3) {
    for (const seed of seedWords) {
      const candidate = seed.word.trim();
      if (!candidate || candidate === target.lemma || distractors.includes(candidate)) {
        continue;
      }
      distractors.push(candidate);
      if (distractors.length === 3) break;
    }
  }

  const options = distractors.slice(0, 3);
  const insertAt = hashString(target.id) % (options.length + 1);
  options.splice(insertAt, 0, target.lemma);
  return options;
}

function extractSentence(target: CandidateWord) {
  const extra = target.extra;
  if (!extra || typeof extra !== "object") return null;

  const directSentence = firstString([
    extra.example_sentence,
    extra.exampleSentence,
    extra.sentence,
    extra.context_sentence,
    extra.example,
  ]);

  if (directSentence) {
    return {
      sentence: directSentence,
      translation: firstString([
        extra.example_translation,
        extra.exampleTranslation,
        extra.translation,
      ]),
    };
  }

  const sentencesValue = extra.sentences;
  if (Array.isArray(sentencesValue) && sentencesValue.length > 0) {
    const first = sentencesValue[0];
    if (typeof first === "string") {
      return { sentence: first, translation: null };
    }
    if (first && typeof first === "object") {
      const sentence = firstString([
        (first as Record<string, unknown>).sentence,
        (first as Record<string, unknown>).text,
        (first as Record<string, unknown>).es,
        (first as Record<string, unknown>).spanish,
      ]);
      if (sentence) {
        return {
          sentence,
          translation: firstString([
            (first as Record<string, unknown>).translation,
            (first as Record<string, unknown>).en,
            (first as Record<string, unknown>).english,
          ]),
        };
      }
    }
  }

  return null;
}

function buildFallbackSentence(target: CandidateWord) {
  const blank = "_____";
  if (target.hint?.includes("verb")) {
    return `Cada dia necesito ${blank} para terminar esto.`;
  }
  if (target.hint?.includes("adj")) {
    return `La idea parece ${blank} en este contexto.`;
  }
  return `Hoy veo ${blank} en esta situacion.`;
}

function maskLemma(sentence: string, lemma: string) {
  const escaped = lemma.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\b${escaped}\\b`, "i");
  if (regex.test(sentence)) {
    return sentence.replace(regex, "_____");
  }
  return `${sentence} (_____)`;
}

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
