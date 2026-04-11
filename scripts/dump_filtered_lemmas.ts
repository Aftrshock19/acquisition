/**
 * Dump every word that the placement seed script would *reject* into
 * placement_filtered_lemmas, with the reason it failed eligibility.
 *
 * Usage: npx tsx scripts/dump_filtered_lemmas.ts [--lang es] [--max 5000]
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as path from "path";

import { MAX_TRACKED_RANK } from "../lib/placement/bands";

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

const BLOCKED_POS = new Set(["prop", "other", "contraction"]);
const AMBIGUOUS_TRANSLATION =
  /^(to be|to do|to have|to get|to make|thing|stuff|it|one|some|any|that|this)$/i;
const VERB_FORM_LIKE =
  /(?:[aeiáéí]ndo|aste|iste|aron|ieron|ábamos|íamos|aremos|eremos|iremos|aríamos|eríamos|iríamos|áramos|iéramos|ases|eses|ieses|ara|iera|ase|iese|emos|amos|imos|áis|éis|ís|an|en|as|es)$/;
const INFLECTED_FORM_MARKER =
  /\((?:feminine|masculine|plural|singular|diminutive|augmentative|past participle|gerund|imperative|subjunctive|conditional|preterite|imperfect|present participle)[^)]*\)/i;

function looksLikeVerbForm(lemma: string): boolean {
  const l = lemma.toLowerCase();
  if (l.length < 3) return false;
  if (/(?:ar|er|ir)$/.test(l)) return false;
  return VERB_FORM_LIKE.test(l);
}

function cleanGloss(raw: string | null): string | null {
  if (!raw) return null;
  const first = raw.split(/[,;/]/)[0].trim();
  if (!first) return null;
  if (first.length > 40) return null;
  return first;
}

type WordRow = {
  id: string;
  rank: number;
  lemma: string;
  pos: string | null;
  translation: string | null;
};

function rejectionReason(w: WordRow): string | null {
  if (w.pos && BLOCKED_POS.has(w.pos)) return `blocked_pos:${w.pos}`;
  const raw = w.translation?.trim() ?? "";
  if (!raw) return "no_translation";
  if (INFLECTED_FORM_MARKER.test(raw)) return "inflected_form_marker";
  const gloss = cleanGloss(w.translation);
  if (!gloss) return "gloss_too_long_or_empty";
  if (AMBIGUOUS_TRANSLATION.test(gloss)) return "ambiguous_gloss";
  if (w.pos !== "verb" && looksLikeVerbForm(w.lemma)) return "verb_form_homograph";
  if (
    w.pos !== "verb" &&
    /[a-záéíóúñ]s$/.test(w.lemma.toLowerCase()) &&
    w.lemma.length >= 4
  ) {
    return "plural_noun_lemma";
  }
  return null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let max = MAX_TRACKED_RANK;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--max" && args[i + 1]) max = Number(args[++i]);
  }
  return { max };
}

async function main() {
  const { max } = parseArgs();

  const PAGE = 1000;
  const words: WordRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("words")
      .select("id, rank, lemma, pos, translation")
      .lte("rank", max)
      .order("rank", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    words.push(...(data as WordRow[]));
    if (data.length < PAGE) break;
  }
  console.log(`fetched ${words.length} words`);

  const rejected = words
    .map((w) => ({ w, reason: rejectionReason(w) }))
    .filter((r): r is { w: WordRow; reason: string } => r.reason !== null);
  console.log(`rejected ${rejected.length} words`);

  // Wipe and refill so the table reflects the current ruleset.
  const { error: delErr } = await supabase
    .from("placement_filtered_lemmas")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (delErr) throw delErr;

  const rows = rejected.map(({ w, reason }) => ({
    word_id: w.id,
    lemma: w.lemma,
    rank: w.rank,
    pos: w.pos,
    translation: w.translation,
    reason,
  }));

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("placement_filtered_lemmas").insert(slice);
    if (error) throw error;
    inserted += slice.length;
    process.stdout.write(`\rinserted ${inserted}/${rows.length}`);
  }
  process.stdout.write("\n");

  const counts = new Map<string, number>();
  for (const r of rejected) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  console.log("by reason:");
  for (const [reason, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
