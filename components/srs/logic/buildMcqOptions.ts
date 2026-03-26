import frequencySeed from "@/data/spanish-frequency.json";

type CandidateWord = {
  id: string;
  lemma: string;
  definition: string | null;
  hint?: string | null;
  rank?: number;
};

type SeedWord = {
  rank: number;
  word: string;
  meaning: string;
};

const seedWords = frequencySeed as SeedWord[];

export function buildMcqOptions(
  target: CandidateWord,
  pool: CandidateWord[],
): {
  options: string[];
  correctOption: string;
} {
  const correctOption = sanitizeMeaning(target.definition) || target.lemma;
  const candidateMeanings = pool
    .filter((candidate) => candidate.id !== target.id)
    .map((candidate) => ({
      value: sanitizeMeaning(candidate.definition),
      samePos: candidate.hint && target.hint ? candidate.hint === target.hint : false,
      rankDistance:
        typeof candidate.rank === "number" && typeof target.rank === "number"
          ? Math.abs(candidate.rank - target.rank)
          : Number.MAX_SAFE_INTEGER,
    }))
    .filter((candidate) => candidate.value && candidate.value !== correctOption)
    .sort((left, right) => {
      if (left.samePos !== right.samePos) return left.samePos ? -1 : 1;
      if (left.rankDistance !== right.rankDistance) {
        return left.rankDistance - right.rankDistance;
      }
      return left.value.localeCompare(right.value);
    });

  const distractors = uniqueStrings(
    candidateMeanings.map((candidate) => candidate.value),
  ).slice(0, 3);

  if (distractors.length < 3) {
    for (const seed of seedWords) {
      const candidate = sanitizeMeaning(seed.meaning);
      if (!candidate || candidate === correctOption || distractors.includes(candidate)) {
        continue;
      }
      distractors.push(candidate);
      if (distractors.length === 3) break;
    }
  }

  const options = insertCorrectOptionDeterministically(
    distractors.slice(0, 3),
    correctOption,
    target.id,
  );

  return {
    options,
    correctOption,
  };
}

function sanitizeMeaning(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function insertCorrectOptionDeterministically(
  distractors: string[],
  correctOption: string,
  seed: string,
) {
  const options = distractors.slice(0, 3);
  const insertAt = hashString(seed) % (options.length + 1);
  options.splice(insertAt, 0, correctOption);
  return options;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
