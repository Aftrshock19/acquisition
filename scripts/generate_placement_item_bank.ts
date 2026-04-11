/**
 * Generate baseline_item_bank items from the existing words + definitions tables.
 *
 * Strategy:
 *   - Pull the top N ranked words for a given language.
 *   - For each eligible word, build one recognition item (4 English-gloss options + IDK
 *     handled in UI) and one recall item (translate target word → English).
 *   - Distractors are sampled from same-POS words in nearby frequency bands so they
 *     are plausible but not synonymous.
 *   - Filters: skip proper nouns, function words with ambiguous glosses, empty glosses.
 *   - Idempotent: uses ON CONFLICT via (language, lemma, item_type, prompt_stem).
 *
 * Usage:
 *   npx tsx scripts/generate_placement_item_bank.ts [--lang es] [--max 5000]
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as path from "path";

import { bandForRank, MAX_TRACKED_RANK } from "../lib/placement/bands";
import { CHECKPOINTS } from "../lib/placement/checkpoints";
import { classifyCognate } from "../lib/placement/cognate";
import {
  classifyMorphology,
  effectiveDiagnosticRank,
} from "../lib/placement/morphology";

config({ path: path.resolve(__dirname, "..", ".env.local") });
config({ path: path.resolve(__dirname, "..", ".env") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── CLI args ───────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let lang = "es";
  let max = MAX_TRACKED_RANK;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--lang" && args[i + 1]) lang = args[++i];
    else if (args[i] === "--max" && args[i + 1]) max = Number(args[++i]);
  }
  return { lang, max };
}

type WordRow = {
  id: string;
  rank: number;
  lemma: string;
  pos: string | null;
  translation: string | null;
  example_sentence: string | null;
  example_sentence_en: string | null;
};

// ── Filters & helpers ──────────────────────────────────────

const BLOCKED_POS = new Set(["prop", "other", "contraction"]);
const AMBIGUOUS_TRANSLATION = /^(to be|to do|to have|to get|to make|thing|stuff|it|one|some|any|that|this)$/i;
// Translations with parenthetical inflection markers are inflected forms of a
// canonical lemma — dictionary lookups should target the lemma instead.
const INFLECTED_FORM_MARKER =
  /\((?:feminine|masculine|plural|singular|diminutive|augmentative|past participle|gerund|imperative|subjunctive|conditional|preterite|imperfect|present participle)[^)]*\)/i;

// Lemmas that look like Spanish verb conjugations are dangerous when tagged
// as nouns/adjectives — they're almost always homographs with a verb form
// (e.g. "hayas" = beech trees vs. subjunctive of haber).
const VERB_FORM_LIKE = /(?:[aeiáéí]ndo|aste|iste|aron|ieron|ábamos|íamos|aremos|eremos|iremos|aríamos|eríamos|iríamos|áramos|iéramos|ases|eses|ieses|ara|iera|ase|iese|emos|amos|imos|áis|éis|ís|an|en|as|es)$/;

function looksLikeVerbForm(lemma: string): boolean {
  const l = lemma.toLowerCase();
  if (l.length < 3) return false;
  // Canonical infinitives end in -ar/-er/-ir and are fine.
  if (/(?:ar|er|ir)$/.test(l)) return false;
  return VERB_FORM_LIKE.test(l);
}

function splitGlossSegments(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function cleanGloss(raw: string | null): string | null {
  // Preserve the full multi-meaning translation so MCQ options show every
  // sense, e.g. "he does; she does; it does" instead of just "he does".
  // Individual segments longer than 40 chars are skipped as noise. The final
  // joined string is capped to keep MCQ cards readable.
  const usable = splitGlossSegments(raw).filter((s) => s.length <= 40);
  if (usable.length === 0) return null;
  const joined = usable.join("; ");
  if (joined.length > 80) {
    // Fall back to the first usable segment when the full list would blow
    // up the card layout.
    return usable[0];
  }
  return joined;
}

function isEligibleWord(word: WordRow): boolean {
  if (word.pos && BLOCKED_POS.has(word.pos)) return false;
  if (word.translation && INFLECTED_FORM_MARKER.test(word.translation)) return false;
  const gloss = cleanGloss(word.translation);
  if (!gloss) return false;
  if (AMBIGUOUS_TRANSLATION.test(gloss)) return false;
  // Drop noun/adjective lemmas that collide with a likely verb conjugation.
  if (word.pos !== "verb" && looksLikeVerbForm(word.lemma)) return false;
  // Canonical noun lemmas should be singular; plural-looking nouns are
  // usually inflected forms erroneously ranked separately.
  if (
    word.pos !== "verb" &&
    /[a-záéíóúñ]s$/.test(word.lemma.toLowerCase()) &&
    word.lemma.length >= 4
  ) {
    return false;
  }
  return true;
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const copy = [...arr];
  let s = seed;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickDistractors(
  target: WordRow,
  gloss: string,
  pool: Array<{ word: WordRow; gloss: string }>,
  count: number,
): string[] {
  // Prefer same-POS items in nearby frequency bands; avoid identical glosses.
  const sameBand = bandForRank(target.rank);
  const candidates = pool.filter((c) => {
    if (c.word.id === target.id) return false;
    if (c.gloss.toLowerCase() === gloss.toLowerCase()) return false;
    if (target.pos && c.word.pos && c.word.pos !== target.pos) return false;
    const band = bandForRank(c.word.rank);
    return Math.abs(band.index - sameBand.index) <= 1;
  });
  const shuffled = shuffle(candidates, target.rank * 7919);
  const picked: string[] = [];
  const seen = new Set<string>([gloss.toLowerCase()]);
  for (const c of shuffled) {
    const key = c.gloss.toLowerCase();
    if (seen.has(key)) continue;
    picked.push(c.gloss);
    seen.add(key);
    if (picked.length === count) break;
  }
  // Fallback: loosen POS constraint if not enough.
  if (picked.length < count) {
    for (const c of shuffle(pool, target.rank * 104729)) {
      if (c.word.id === target.id) continue;
      const key = c.gloss.toLowerCase();
      if (seen.has(key)) continue;
      picked.push(c.gloss);
      seen.add(key);
      if (picked.length === count) break;
    }
  }
  return picked;
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  const { lang, max } = parseArgs();
  console.log(`[placement] generating item bank for lang=${lang}, max rank=${max}`);

  // Supabase caps a single select at 1000 rows by default. Page through explicitly.
  const PAGE = 1000;
  const words: WordRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    const { data: page, error: wordsErr } = await supabase
      .from("words")
      .select("id, rank, lemma, pos, translation, example_sentence, example_sentence_en")
      .lte("rank", max)
      .order("rank", { ascending: true })
      .range(from, to);
    if (wordsErr) throw wordsErr;
    if (!page || page.length === 0) break;
    words.push(...(page as WordRow[]));
    if (page.length < PAGE) break;
  }
  if (words.length === 0) {
    console.warn("[placement] no words returned — nothing to seed");
    return;
  }
  console.log(`[placement] fetched ${words.length} words`);

  const eligible: Array<{ word: WordRow; gloss: string }> = [];
  for (const w of words as WordRow[]) {
    if (!isEligibleWord(w)) continue;
    const gloss = cleanGloss(w.translation)!;
    eligible.push({ word: w, gloss });
  }
  console.log(`[placement] eligible words: ${eligible.length}`);

  const rows: Array<Record<string, unknown>> = [];
  for (const { word, gloss } of eligible) {
    const distractors = pickDistractors(word, gloss, eligible, 3);
    if (distractors.length < 3) continue; // skip items we couldn't cleanly build
    const options = shuffle([gloss, ...distractors], word.rank * 2654435761);
    // Store the actual rank in band_start/band_end so the adaptive engine can
    // recover the right checkpoint per response. Legacy 1–5000 banding is no
    // longer load-bearing now that the placement engine routes by checkpoint.
    const bandStart = word.rank;
    const bandEnd = word.rank;
    const sentence = extractSentence(word.example_sentence);

    const cognate = classifyCognate(word.lemma, gloss);
    const morphology = classifyMorphology(word.lemma, word.pos);
    const lemmaRank = word.rank; // source words table already ranks by lemma.
    const effRank = effectiveDiagnosticRank(lemmaRank, morphology);

    const fairnessFields = {
      cognate_class: cognate.cognateClass,
      cognate_similarity: Number(cognate.similarity.toFixed(3)),
      morphology_class: morphology.morphologyClass,
      is_inflected_form: morphology.isInflectedForm,
      lemma_rank: lemmaRank,
      effective_diagnostic_rank: effRank,
    };

    // Recognition item
    rows.push({
      language: lang,
      word_id: word.id,
      lemma: word.lemma,
      frequency_rank: word.rank,
      pos: word.pos,
      item_type: "recognition",
      prompt_sentence: sentence,
      prompt_stem: `What does "${word.lemma}" mean?`,
      correct_answer: gloss,
      accepted_answers: null,
      options: options,
      distractor_word_ids: null,
      band_start: bandStart,
      band_end: bandEnd,
      ambiguity_flag: false,
      quality_status: "approved",
      source: "auto_from_words",
      ...fairnessFields,
    });

    // Recall item (simple meaning recall)
    rows.push({
      language: lang,
      word_id: word.id,
      lemma: word.lemma,
      frequency_rank: word.rank,
      pos: word.pos,
      item_type: "recall",
      prompt_sentence: sentence,
      prompt_stem: `Type the English meaning of "${word.lemma}".`,
      correct_answer: gloss,
      accepted_answers: buildAcceptedAnswers(gloss, word.translation),
      options: null,
      distractor_word_ids: null,
      band_start: bandStart,
      band_end: bandEnd,
      ambiguity_flag: false,
      quality_status: "approved",
      source: "auto_from_words",
      ...fairnessFields,
    });
  }

  console.log(`[placement] generated ${rows.length} candidate item rows`);

  // Composition report: how many strong/weak/non-cognate and how many
  // base/marked items per checkpoint. The diagnostic needs non-cognate base
  // forms available across the full range; this report flags bare spots.
  const compositionByCp = new Map<
    number,
    {
      total: number;
      strong: number;
      weak: number;
      non: number;
      base: number;
      marked: number;
    }
  >();
  for (const r of rows) {
    const rank = r.frequency_rank as number;
    const cpIdx = nearestCpIndex(rank);
    const entry = compositionByCp.get(cpIdx) ?? {
      total: 0,
      strong: 0,
      weak: 0,
      non: 0,
      base: 0,
      marked: 0,
    };
    entry.total += 1;
    const c = r.cognate_class as string;
    if (c === "strong_cognate") entry.strong += 1;
    else if (c === "weak_cognate") entry.weak += 1;
    else entry.non += 1;
    const m = r.morphology_class as string;
    if (m === "irregular_or_marked_inflection") entry.marked += 1;
    else if (m === "base") entry.base += 1;
    compositionByCp.set(cpIdx, entry);
  }
  for (const cp of CHECKPOINTS) {
    const e = compositionByCp.get(cp.index);
    if (!e) continue;
    const pct = (n: number) => `${Math.round((n / e.total) * 100)}%`;
    console.log(
      `[placement] cp ${cp.index} (~${cp.center}): ${e.total} rows ` +
        `| non ${pct(e.non)} weak ${pct(e.weak)} strong ${pct(e.strong)} ` +
        `| base ${pct(e.base)} marked ${pct(e.marked)}`,
    );
  }

  const chunks = chunk(rows, 500);
  let inserted = 0;
  for (const c of chunks) {
    const { error, count } = await supabase
      .from("baseline_item_bank")
      .upsert(c, { onConflict: "language,lemma,item_type,prompt_stem", count: "exact" });
    if (error) {
      console.error("[placement] upsert error", error);
      throw error;
    }
    inserted += count ?? c.length;
    process.stdout.write(`\r[placement] upserted ${inserted}/${rows.length}`);
  }
  process.stdout.write("\n");

  // Coverage summary by adaptive checkpoint window.
  for (const cp of CHECKPOINTS) {
    const { count } = await supabase
      .from("baseline_item_bank")
      .select("*", { count: "exact", head: true })
      .eq("language", lang)
      .eq("quality_status", "approved")
      .gte("frequency_rank", cp.windowLow)
      .lte("frequency_rank", cp.windowHigh);
    console.log(
      `[placement] checkpoint ${cp.index} (~${cp.center.toLocaleString()}): ${count ?? 0} items`,
    );
  }
}


function extractSentence(sentence: string | null): string | null {
  if (typeof sentence !== "string") return null;
  const trimmed = sentence.trim();
  if (trimmed.length === 0 || trimmed.length > 160) return null;
  return trimmed;
}

function buildAcceptedAnswers(gloss: string, rawTranslation: string | null): string[] {
  const variants = new Set<string>();
  // Start with every semicolon/comma/slash-separated segment from the raw
  // translation — each one is a valid English meaning the user might type.
  const segments = splitGlossSegments(rawTranslation);
  if (segments.length === 0) segments.push(gloss.trim());
  for (const seg of segments) {
    const base = seg.trim();
    if (!base) continue;
    variants.add(base);
    // Add "to X" ↔ "X" variants for verbs.
    if (base.startsWith("to ")) variants.add(base.slice(3));
    else variants.add(`to ${base}`);
    // Add singular/plural hint loosely.
    if (base.endsWith("s")) variants.add(base.slice(0, -1));
    else variants.add(`${base}s`);
  }
  return Array.from(variants);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function nearestCpIndex(rank: number): number {
  if (rank <= CHECKPOINTS[0].center) return 0;
  const top = CHECKPOINTS[CHECKPOINTS.length - 1];
  if (rank >= top.center) return top.index;
  const t = Math.log(rank);
  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const c of CHECKPOINTS) {
    const d = Math.abs(Math.log(c.center) - t);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = c.index;
    }
  }
  return bestIdx;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
