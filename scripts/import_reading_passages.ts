/**
 * Import reading passages from all_passages_renamed/ JSON files into Supabase.
 *
 * Passages are stored in the canonical `texts` table, grouped by
 * `text_collections` (one per stage). Comprehension questions are
 * stored in `reading_questions` linked to `texts.id`.
 *
 * Usage:
 *   npx tsx scripts/import_reading_passages.ts [passages_dir]
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Idempotent: deletes existing reading passages then inserts fresh from source.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Load .env.local (Next.js convention), fall back to .env
config({ path: path.resolve(__dirname, "..", ".env.local") });
config({ path: path.resolve(__dirname, "..", ".env") });

// ── Supabase client ────────────────────────────────────────

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Types matching the JSON shape ──────────────────────────

type PassageQuestion = {
  id: number;
  type: string;
  question_en: string;
  options_en: string[];
  correct_option_index: number;
};

type PassageJson = {
  stage: string;
  display_label: string;
  mode: string;
  scenario_seed?: string;
  title: string;
  topic?: string;
  passage_text: string;
  word_count_estimate?: number;
  focus_words_used?: string[];
  stretch_words_used?: string[];
  extra_words_not_in_sample?: string[];
  reading_comprehension_questions: PassageQuestion[];
  notes?: string;
};

// ── Constants ──────────────────────────────────────────────

const MODE_RANK: Record<string, number> = {
  short: 0,
  medium: 1,
  long: 2,
  very_long: 3,
};

// ── Helpers ────────────────────────────────────────────────

function stageIndex(stage: string): number {
  const match = stage.match(/stage_(\d+)/);
  if (!match) throw new Error(`Invalid stage name: ${stage}`);
  return parseInt(match[1], 10);
}

function broadCefr(displayLabel: string): string {
  if (displayLabel === "Pre-A1") return "Pre-A1";
  return displayLabel.replace(/[-+]$/, "");
}

function passageNumber(filePath: string): number {
  const base = path.basename(filePath, ".json");

  // Flat filename: a1_short_stage1_3.json → passage number is last segment
  const lastUnderscore = base.lastIndexOf("_");
  if (lastUnderscore !== -1) {
    const num = parseInt(base.slice(lastUnderscore + 1), 10);
    if (!isNaN(num)) return num;
  }

  // Legacy: bare numeric filename like 03.json
  const num = parseInt(base, 10);
  if (isNaN(num))
    throw new Error(`Cannot parse passage number from ${filePath}`);
  return num;
}

function collectionTitle(si: number, displayLabel: string): string {
  return `Stage ${si}: ${displayLabel}`;
}

// ── Discover all passage JSON files ────────────────────────

const PASSAGES_ROOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "..", "all_passages_renamed");

function discoverPassageFiles(): string[] {
  if (!fs.existsSync(PASSAGES_ROOT)) {
    console.error(
      `Passages directory not found at ${PASSAGES_ROOT}`,
    );
    process.exit(1);
  }

  // Flat folder: all_passages_renamed/{cefr}_{mode}_stage{N}_{num}.json
  return fs
    .readdirSync(PASSAGES_ROOT)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(PASSAGES_ROOT, f))
    .sort();
}

// ── Main import ────────────────────────────────────────────

async function main() {
  const files = discoverPassageFiles();
  console.log(`Found ${files.length} passage files to import.`);

  if (files.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  // ── Phase 1: Parse all files ─────────────────────────────

  type ParsedPassage = {
    json: PassageJson;
    pNum: number;
    key: string;
  };

  const parsed: ParsedPassage[] = [];
  const stagesNeeded = new Map<
    string,
    { stageIdx: number; displayLabel: string }
  >();

  for (const filePath of files) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const json: PassageJson = JSON.parse(raw);
      const pNum = passageNumber(filePath);
      const key = `${json.stage}|${json.mode}|${pNum}`;

      parsed.push({ json, pNum, key });

      const si = stageIndex(json.stage);
      stagesNeeded.set(json.stage, {
        stageIdx: si,
        displayLabel: json.display_label,
      });
    } catch (err) {
      console.error(`  Error parsing ${filePath}:`, err);
    }
  }

  console.log(
    `Parsed ${parsed.length} passages across ${stagesNeeded.size} stages.`,
  );

  // ── Phase 2: Delete old reading passages ────────────────
  // reading_questions cascade-deletes via FK; reading_progress,
  // comprehension_responses also cascade; daily_sessions.reading_text_id
  // gets SET NULL. text_collections are left intact and reused.

  const { data: oldPassages, error: countErr } = await supabase
    .from("texts")
    .select("id", { count: "exact", head: true })
    .not("stage", "is", null);

  const oldCount = (countErr ? 0 : (oldPassages as any)?.length) || 0;

  const { error: delErr } = await supabase
    .from("texts")
    .delete()
    .not("stage", "is", null);

  if (delErr) {
    console.error("Error deleting old reading passages:", delErr);
    process.exit(1);
  }

  console.log(`Deleted old reading passages from texts table.`);

  // ── Phase 3: Ensure text_collections per stage ───────────

  const collectionMap = new Map<string, string>(); // stage -> collection_id

  for (const [stage, info] of stagesNeeded) {
    const title = collectionTitle(info.stageIdx, info.displayLabel);

    // Check if collection already exists
    const { data: existing } = await supabase
      .from("text_collections")
      .select("id")
      .eq("title", title)
      .eq("lang", "es")
      .limit(1)
      .maybeSingle();

    if (existing) {
      collectionMap.set(stage, existing.id);
      continue;
    }

    // Create collection
    const { data: created, error } = await supabase
      .from("text_collections")
      .insert({
        title,
        lang: "es",
        description: `Graded reading passages at ${info.displayLabel} level`,
        collection_type: "graded_passages",
      })
      .select("id")
      .single();

    if (error) {
      console.error(`  Error creating collection for ${stage}:`, error);
      continue;
    }

    collectionMap.set(stage, created.id);
  }

  console.log(`Collections ready: ${collectionMap.size} stages.`);

  // ── Phase 4: Insert passages into texts ──────────────────

  let importedTexts = 0;
  let importedQuestions = 0;
  let errors = 0;

  const BATCH_SIZE = 50;

  for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
    const batch = parsed.slice(i, i + BATCH_SIZE);

    const textRows = batch.map(({ json, pNum }) => {
      const si = stageIndex(json.stage);
      const modeRank = MODE_RANK[json.mode] ?? 0;
      const wc = json.word_count_estimate ?? 0;

      return {
        lang: "es",
        title: json.title,
        content: json.passage_text,
        collection_id: collectionMap.get(json.stage) ?? null,
        order_index: modeRank * 100 + pNum,
        word_count: wc,
        estimated_minutes: Math.max(1, Math.ceil(wc / 180)),
        difficulty_cefr: broadCefr(json.display_label),
        stage: json.stage,
        stage_index: si,
        display_label: json.display_label,
        passage_mode: json.mode,
        passage_number: pNum,
      };
    });

    const { data: upserted, error: textError } = await supabase
      .from("texts")
      .upsert(textRows, { onConflict: "stage,passage_mode,passage_number" })
      .select("id, stage, passage_mode, passage_number");

    if (textError) {
      console.error(`  Text upsert error (batch ${i}):`, textError);
      errors += batch.length;
      continue;
    }

    importedTexts += (upserted ?? []).length;

    // ── Phase 5: Insert questions for each text ─────────────

    const questionsByKey = new Map<string, PassageQuestion[]>();
    for (const { json, pNum, key } of batch) {
      if (json.reading_comprehension_questions?.length) {
        questionsByKey.set(key, json.reading_comprehension_questions);
      }
    }

    for (const text of upserted ?? []) {
      const key = `${text.stage}|${text.passage_mode}|${text.passage_number}`;
      const questions = questionsByKey.get(key);
      if (!questions?.length) continue;

      const qRows = questions.map((q) => ({
        text_id: text.id,
        question_index: q.id,
        question_type: q.type,
        question_en: q.question_en,
        options_en: q.options_en,
        correct_option_index: q.correct_option_index,
      }));

      const { error: qError } = await supabase
        .from("reading_questions")
        .upsert(qRows, { onConflict: "text_id,question_index" });

      if (qError) {
        console.error(`  Question upsert error for ${key}:`, qError);
        errors++;
      } else {
        importedQuestions += qRows.length;
      }
    }

    process.stdout.write(
      `\r  Processed ${Math.min(i + BATCH_SIZE, parsed.length)}/${parsed.length} files...`,
    );
  }

  console.log(); // newline after progress
  console.log(
    `Done. Imported ${importedTexts} passages, ${importedQuestions} questions. Errors: ${errors}.`,
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
