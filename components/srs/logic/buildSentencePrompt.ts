import frequencySeed from "@/data/spanish-frequency.json";

export const SENTENCE_CLOZE_BLANK_TOKEN = "__FLASHCARD_SENTENCE_BLANK__";

type CandidateWord = {
  id?: string;
  lemma: string;
  definition?: string | null;
  exampleSentence?: string | null;
  exampleSentenceEn?: string | null;
  pos?: string | null;
  hint?: string | null;
  rank?: number;
};

export type SentencePromptData = {
  instruction: string;
  sentence: string;
  translation: string | null;
  answer: string;
};

type SeedWord = {
  rank: number;
  word: string;
  meaning: string;
};

const seedWords = frequencySeed as SeedWord[];

export function buildSentencePrompt(target: CandidateWord): SentencePromptData {
  const extracted = extractSentence(target);
  const sentence = extracted?.sentence ?? buildFallbackSentence(target);

  return {
    instruction: "Write the missing word.",
    sentence: maskLemma(sentence, target.lemma),
    translation: extracted?.translation ?? null,
    answer: target.lemma,
  };
}

export function buildSentenceMcqOptions(
  target: CandidateWord,
  pool: CandidateWord[],
) {
  const distractors = pool
    .filter((candidate) => {
      return (
        candidate.id !== target.id &&
        candidate.lemma !== target.lemma &&
        candidate.lemma
      );
    })
    .map((candidate) => ({
      lemma: candidate.lemma.trim(),
      samePos: candidate.pos && target.pos ? candidate.pos === target.pos : false,
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

  const options = uniqueStrings(distractors.map((candidate) => candidate.lemma)).slice(
    0,
    3,
  );

  if (options.length < 3) {
    for (const seed of seedWords) {
      const candidate = seed.word.trim();
      if (!candidate || candidate === target.lemma || options.includes(candidate)) {
        continue;
      }
      options.push(candidate);
      if (options.length === 3) break;
    }
  }

  const insertAt = hashString(target.id ?? target.lemma) % (options.length + 1);
  options.splice(insertAt, 0, target.lemma);

  return {
    options,
    correctOption: target.lemma,
  };
}

function extractSentence(target: CandidateWord) {
  if (!target.exampleSentence) return null;
  return {
    sentence: target.exampleSentence,
    translation: target.exampleSentenceEn ?? null,
  };
}

function buildFallbackSentence(target: CandidateWord) {
  const blank = SENTENCE_CLOZE_BLANK_TOKEN;

  if (target.pos === "verb") {
    return `Cada dia necesito ${blank} para terminar esto.`;
  }

  if (target.pos === "adj") {
    return `La idea parece ${blank} en este contexto.`;
  }

  return `Hoy veo ${blank} en esta situacion.`;
}

function maskLemma(sentence: string, lemma: string) {
  if (sentence.includes(SENTENCE_CLOZE_BLANK_TOKEN)) {
    return sentence;
  }

  const escapedLemma = lemma.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = "[^\\p{L}\\p{N}_]";
  const matcher = new RegExp(
    `(^|${boundary})(${escapedLemma})(?=$|${boundary})`,
    "iu",
  );

  if (matcher.test(sentence)) {
    return sentence.replace(
      matcher,
      (_, prefix: string) => `${prefix}${SENTENCE_CLOZE_BLANK_TOKEN}`,
    );
  }

  return `${sentence} (${SENTENCE_CLOZE_BLANK_TOKEN})`;
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
