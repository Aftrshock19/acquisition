/**
 * Morphology classifier.
 *
 * Separates a placement lemma's surface form from its citation form so the
 * adaptive engine can credit the *lemma* for lexical evidence while treating
 * unusual inflected forms as morphology probes. This prevents rare marked
 * forms of common verbs ("anduviésemos") from behaving like ultra-rare
 * lexical items.
 *
 * Rules are deterministic and explainable. For verbs we check ending classes
 * (infinitive → base; -ando/-iendo/-ado/-ido → common_inflection; preterite/
 * imperfect endings → regular_inflection; subjunctive and archaic endings →
 * irregular_or_marked_inflection). For non-verbs we treat -s endings as
 * common inflection (plural noun/adjective) and everything else as base.
 */

export type MorphologyClass =
  | "base"
  | "common_inflection"
  | "regular_inflection"
  | "irregular_or_marked_inflection";

export type MorphologyResult = {
  morphologyClass: MorphologyClass;
  isInflectedForm: boolean;
  /** Extra rank added to lemma_rank to produce effective_diagnostic_rank. */
  rankPenalty: number;
  /** Morphology weight used when scoring the floor (scales lexical weight). */
  morphologyWeight: number;
  rule: string;
};

const INFINITIVE = /(?:ar|er|ir)$/;
const GERUND_OR_PARTICIPLE = /(?:[aeiáéí]ndo|ado|ido)$/;
// Ordered most-specific first so tighter archaic endings match before
// generic present-tense endings.
const MARKED_ENDINGS = [
  /uviésemos$/,
  /uviesen$/,
  /uviéramos$/,
  /uvieran$/,
  /ábamos$/,
  /íamos$/,
  /aríamos$/,
  /eríamos$/,
  /iríamos$/,
  /áramos$/,
  /iéramos$/,
  /aremos$/,
  /eremos$/,
  /iremos$/,
  /aron$/,
  /ieron$/,
  /ases$/,
  /eses$/,
  /ieses$/,
  /ara$/,
  /iera$/,
  /ase$/,
  /iese$/,
  /uera$/,
  /uese$/,
];
const REGULAR_ENDINGS = [
  /amos$/,
  /emos$/,
  /imos$/,
  /íais$/,
  /íeis$/,
  /áis$/,
  /éis$/,
  /aste$/,
  /iste$/,
  /aba$/,
  /ía$/,
  /ó$/,
  /an$/,
  /en$/,
];

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function classifyMorphology(
  lemma: string,
  pos: string | null,
): MorphologyResult {
  const l = lemma.toLowerCase();

  if (pos !== "verb") {
    // Plural nouns/adjectives — common inflection, mild lexical softening.
    if (l.length >= 4 && /[a-záéíóúñ]s$/.test(l)) {
      return {
        morphologyClass: "common_inflection",
        isInflectedForm: true,
        rankPenalty: 200,
        morphologyWeight: 0.9,
        rule: "plural-ending",
      };
    }
    return {
      morphologyClass: "base",
      isInflectedForm: false,
      rankPenalty: 0,
      morphologyWeight: 1.0,
      rule: "base-nonverb",
    };
  }

  // Verbs.
  if (INFINITIVE.test(l) && l.length >= 3) {
    return {
      morphologyClass: "base",
      isInflectedForm: false,
      rankPenalty: 0,
      morphologyWeight: 1.0,
      rule: "infinitive",
    };
  }

  for (const pat of MARKED_ENDINGS) {
    if (pat.test(l)) {
      return {
        morphologyClass: "irregular_or_marked_inflection",
        isInflectedForm: true,
        rankPenalty: 1500,
        morphologyWeight: 0.5,
        rule: `marked:${pat.source}`,
      };
    }
  }
  if (GERUND_OR_PARTICIPLE.test(l)) {
    return {
      morphologyClass: "common_inflection",
      isInflectedForm: true,
      rankPenalty: 300,
      morphologyWeight: 0.9,
      rule: "gerund-or-participle",
    };
  }
  for (const pat of REGULAR_ENDINGS) {
    if (pat.test(l)) {
      return {
        morphologyClass: "regular_inflection",
        isInflectedForm: true,
        rankPenalty: 600,
        morphologyWeight: 0.7,
        rule: `regular:${pat.source}`,
      };
    }
  }

  // Fallback — looks verb-tagged but no recognizable ending; treat as base.
  return {
    morphologyClass: "base",
    isInflectedForm: false,
    rankPenalty: 0,
    morphologyWeight: 1.0,
    rule: "default",
  };
}

export function effectiveDiagnosticRank(
  lemmaRank: number,
  m: Pick<MorphologyResult, "rankPenalty">,
): number {
  return lemmaRank + m.rankPenalty;
}

// Silence unused-warning: keep stripAccents in surface API for symmetry with
// cognate.ts and future expansion (accent-insensitive stem matching).
void stripAccents;
