import frequencySeed from "@/data/spanish-frequency.json";

type CandidateWord = {
  id: string;
  lemma: string;
  translation: string | null;
  definition: string | null;
  definitionEs?: string | null;
  definitionEn?: string | null;
  exampleSentence?: string | null;
  exampleSentenceEn?: string | null;
  pos?: string | null;
  hint?: string | null;
  rank?: number;
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
  if (!target.exampleSentence) return null;
  return {
    sentence: target.exampleSentence,
    translation: target.exampleSentenceEn ?? null,
  };
}

function buildFallbackSentence(target: CandidateWord) {
  const blank = "_____";
  if (target.pos === "verb") {
    return `Cada dia necesito ${blank} para terminar esto.`;
  }
  if (target.pos === "adj") {
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
