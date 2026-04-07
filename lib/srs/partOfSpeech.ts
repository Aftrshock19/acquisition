const PART_OF_SPEECH_LABELS: Record<string, string> = {
  art: "Article",
  det: "Determiner",
  pron: "Pronoun",
  prep: "Preposition",
  conj: "Conjunction",
  adv: "Adverb",
  verb: "Verb",
  noun: "Noun",
  adj: "Adjective",
  intj: "Interjection",
  num: "Number",
  prop: "Proper noun",
  phrase: "Phrase",
  contraction: "Contraction",
  other: "Other",
};

function toTitleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatPartOfSpeech(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;

  return PART_OF_SPEECH_LABELS[normalized] ?? toTitleCase(normalized);
}
