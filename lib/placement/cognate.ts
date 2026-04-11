/**
 * Cognate classifier.
 *
 * Deterministic, explainable orthographic similarity between a Spanish lemma
 * and its English gloss. Used by the placement diagnostic to weight lexical
 * evidence — strong cognates are cheap clues and should not drive the
 * frontier on their own.
 *
 * The classifier runs two passes:
 *   1. A raw LCS-based similarity between the normalized Spanish lemma and
 *      each English gloss segment.
 *   2. A suffix-rule pass that applies common Spanish→English derivational
 *      mappings (-ción → -tion, -dad → -ty, etc.) before comparing.
 *
 * The best similarity across all passes and gloss segments is bucketed into
 * non_cognate / weak_cognate / strong_cognate.
 */

export type CognateClass = "non_cognate" | "weak_cognate" | "strong_cognate";

export type CognateResult = {
  cognateClass: CognateClass;
  similarity: number;
  rule: string;
};

export const STRONG_COGNATE_THRESHOLD = 0.75;
export const WEAK_COGNATE_THRESHOLD = 0.55;

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(s: string): string {
  return stripAccents(s.toLowerCase()).replace(/[^a-z]/g, "");
}

function lcs(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  const n = b.length;
  let prev = new Array(n + 1).fill(0);
  let cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    for (let j = 0; j <= n; j += 1) cur[j] = 0;
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  return (2 * lcs(a, b)) / (a.length + b.length);
}

// Spanish → English derivational suffix mappings. These cover the big
// Latinate classes where a one-letter-off orthographic match hides an
// obvious cognate (posición/position, actividad/activity, rápidamente/rapidly).
const SUFFIX_RULES: Array<[RegExp, string]> = [
  [/cion$/, "tion"],
  [/sion$/, "sion"],
  [/dad$/, "ty"],
  [/tad$/, "ty"],
  [/mente$/, "ly"],
  [/ia$/, "y"],
  [/ico$/, "ic"],
  [/ica$/, "ic"],
  [/ismo$/, "ism"],
  [/ista$/, "ist"],
  [/oso$/, "ous"],
  [/osa$/, "ous"],
  [/ivo$/, "ive"],
  [/iva$/, "ive"],
  [/ar$/, "ate"],
  [/ir$/, "e"],
  [/dora$/, "er"],
  [/dor$/, "er"],
  [/tor$/, "tor"],
];

function applySuffixRules(spanish: string): string[] {
  const out = [spanish];
  for (const [pat, rep] of SUFFIX_RULES) {
    if (pat.test(spanish)) out.push(spanish.replace(pat, rep));
  }
  return out;
}

function segmentGloss(gloss: string): string[] {
  return gloss
    .split(/[;,/]/)
    .map((s) => s.replace(/^to\s+/i, "").replace(/^(the|a|an)\s+/i, "").trim())
    .map(normalize)
    .filter((s) => s.length >= 2);
}

export function classifyCognate(
  spanishLemma: string,
  englishGloss: string | null,
): CognateResult {
  const es = normalize(spanishLemma);
  const segments = englishGloss ? segmentGloss(englishGloss) : [];
  if (es.length < 2 || segments.length === 0) {
    return { cognateClass: "non_cognate", similarity: 0, rule: "empty" };
  }
  let best = 0;
  let bestRule = "lcs";
  const spanishForms = applySuffixRules(es);
  for (const seg of segments) {
    for (const form of spanishForms) {
      const sim = similarity(form, seg);
      if (sim > best) {
        best = sim;
        bestRule = form === es ? "lcs" : "suffix";
      }
    }
  }
  let cognateClass: CognateClass;
  if (best >= STRONG_COGNATE_THRESHOLD) cognateClass = "strong_cognate";
  else if (best >= WEAK_COGNATE_THRESHOLD) cognateClass = "weak_cognate";
  else cognateClass = "non_cognate";
  return { cognateClass, similarity: best, rule: bestRule };
}

export function lexicalWeightForCognate(c: CognateClass): number {
  switch (c) {
    case "non_cognate":
      return 1.0;
    case "weak_cognate":
      return 0.8;
    case "strong_cognate":
      return 0.5;
  }
}
