/**
 * Re-import reading_comprehension_questions for all reading texts.
 *
 * Assumes texts table is already populated (from import_reading_passages).
 * Wipes reading_questions, then inserts fresh from JSON source.
 *
 * Usage:
 *   npx tsx scripts/reimport_reading_questions.ts <passages_dir>
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

config({ path: path.resolve(__dirname, "..", ".env.local") });
config({ path: path.resolve(__dirname, "..", ".env") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Question = {
  id: number;
  type: string;
  question_en: string;
  options_en: string[];
  correct_option_index: number;
};

type Passage = {
  stage: string;
  mode: string;
  reading_comprehension_questions: Question[];
};

const DIR = process.argv[2];
if (!DIR) {
  console.error("Usage: reimport_reading_questions.ts <passages_dir>");
  process.exit(1);
}

function passageNumberFromFilename(file: string): number {
  const base = path.basename(file, ".json");
  const last = base.lastIndexOf("_");
  return parseInt(base.slice(last + 1), 10);
}

async function main() {
  // ── Step a: count questions in source JSONs
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(DIR, f))
    .sort();
  console.log(`Source files: ${files.length}`);

  type Parsed = {
    stage: string;
    mode: string;
    passageNumber: number;
    questions: Question[];
  };

  const parsed: Parsed[] = [];
  let totalQuestions = 0;
  for (const f of files) {
    const j: Passage = JSON.parse(fs.readFileSync(f, "utf-8"));
    const pNum = passageNumberFromFilename(f);
    parsed.push({
      stage: j.stage,
      mode: j.mode,
      passageNumber: pNum,
      questions: j.reading_comprehension_questions ?? [],
    });
    totalQuestions += (j.reading_comprehension_questions ?? []).length;
  }
  console.log(`Total questions in source: ${totalQuestions}`);

  if (totalQuestions < 2900 || totalQuestions > 3700) {
    console.error(
      `HALT: source question count ${totalQuestions} outside [2900, 3700].`,
    );
    process.exit(1);
  }

  // ── Look up text_id for every (stage, mode, passageNumber)
  console.log("Fetching text_id mapping from DB...");
  const { data: texts, error: tErr } = await supabase
    .from("texts")
    .select("id, stage, passage_mode, passage_number")
    .not("stage", "is", null)
    .not("stage", "ilike", "listening_%");
  if (tErr) {
    console.error("Failed to fetch texts:", tErr);
    process.exit(1);
  }
  const textMap = new Map<string, string>();
  for (const t of texts ?? []) {
    textMap.set(`${t.stage}|${t.passage_mode}|${t.passage_number}`, t.id);
  }
  console.log(`Mapped ${textMap.size} reading texts.`);

  // ── Step: Delete existing reading_questions
  const { count: preCount } = await supabase
    .from("reading_questions")
    .select("id", { count: "exact", head: true });
  console.log(`Pre-delete reading_questions count: ${preCount}`);

  const { error: delErr, count: deletedCount } = await supabase
    .from("reading_questions")
    .delete({ count: "exact" })
    .not("id", "is", null);
  if (delErr) {
    console.error("Failed to delete reading_questions:", delErr);
    process.exit(1);
  }
  console.log(`Deleted ${deletedCount} reading_questions rows.`);

  // ── Build insert rows and insert in batches
  type Row = {
    text_id: string;
    question_index: number;
    question_type: string;
    question_en: string;
    options_en: string[];
    correct_option_index: number;
  };

  const rows: Row[] = [];
  const missingTexts: string[] = [];
  for (const p of parsed) {
    const key = `${p.stage}|${p.mode}|${p.passageNumber}`;
    const textId = textMap.get(key);
    if (!textId) {
      missingTexts.push(key);
      continue;
    }
    for (const q of p.questions) {
      rows.push({
        text_id: textId,
        question_index: q.id,
        question_type: q.type,
        question_en: q.question_en,
        options_en: q.options_en,
        correct_option_index: q.correct_option_index,
      });
    }
  }
  if (missingTexts.length > 0) {
    console.error(
      `HALT: ${missingTexts.length} passages have no matching text in DB. First 5: ${missingTexts.slice(0, 5).join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`Rows ready to insert: ${rows.length}`);

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("reading_questions").insert(batch);
    if (error) {
      console.error(
        `HALT: insert failed at batch ${i / BATCH} (rows ${i}–${i + batch.length - 1}):`,
        error,
      );
      process.exit(1);
    }
    inserted += batch.length;
    process.stdout.write(`\r  Inserted ${inserted}/${rows.length}`);
  }
  console.log();

  // ── Final count + invariant checks
  const { count: finalCount } = await supabase
    .from("reading_questions")
    .select("id", { count: "exact", head: true });
  console.log(`Final reading_questions count in DB: ${finalCount}`);

  if (finalCount !== totalQuestions) {
    console.error(
      `HALT: DB count ${finalCount} !== source count ${totalQuestions}.`,
    );
    process.exit(1);
  }

  console.log("SUCCESS: all questions inserted.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
