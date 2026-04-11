// Shared text normalization used for recall scoring and accepted-answer matching.

export function normalizeAnswer(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(to |a |an |the )/, "")
    .replace(/[^a-z0-9\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isRecallCorrect(
  userInput: string,
  correctAnswer: string,
  acceptedAnswers: readonly string[] | null,
): boolean {
  const normalized = normalizeAnswer(userInput);
  if (normalized.length === 0) return false;
  const candidates = new Set<string>();
  candidates.add(normalizeAnswer(correctAnswer));
  for (const a of acceptedAnswers ?? []) {
    candidates.add(normalizeAnswer(a));
  }
  return candidates.has(normalized);
}
