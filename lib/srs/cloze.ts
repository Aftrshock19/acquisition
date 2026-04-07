function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function stripBracketedText(value: string) {
  return value.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ");
}

function cleanCandidate(value: string) {
  return stripBracketedText(value).replace(/\s+/g, " ").trim();
}

export function normalizeClozeText(value: string) {
  return stripDiacritics(
    cleanCandidate(value)
      .trim()
      .toLowerCase()
      .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~¿¡]/g, " ")
      .replace(/\s+/g, " ")
  );
}

export function splitDefinitionCandidates(definition: string | null) {
  if (!definition) return [];

  const parts = definition
    .split(/[;,/|]/)
    .map(cleanCandidate)
    .filter(Boolean);

  return parts.length > 0 ? parts : [definition];
}

export function formatDefinitionCandidates(candidates: string[]) {
  return candidates.filter(Boolean).join(" or ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWholeCandidate(answer: string, candidate: string) {
  const pattern = new RegExp(`(?:^| )${escapeRegExp(candidate)}(?:$| )`);
  return pattern.test(answer);
}

export function isCorrectClozeAnswer(
  userAnswer: string,
  expected: string[],
  allowContainedCandidateMatch = false,
) {
  const normalizedAnswer = normalizeClozeText(userAnswer);
  if (!normalizedAnswer) return false;

  return expected.some((candidate) => {
    const normalizedCandidate = normalizeClozeText(candidate);
    if (!normalizedCandidate) return false;

    return (
      normalizedCandidate === normalizedAnswer
      || (allowContainedCandidateMatch
        && containsWholeCandidate(normalizedAnswer, normalizedCandidate))
    );
  });
}
