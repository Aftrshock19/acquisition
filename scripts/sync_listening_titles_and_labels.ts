/**
 * Phase 6: Sync listening titles (from .txt) and populate display_label
 * (derived from stage_index) for all listening rows.
 *
 * Usage: npx tsx scripts/sync_listening_titles_and_labels.ts
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

config({ path: path.resolve(__dirname, "..", ".env.local") });
config({ path: path.resolve(__dirname, "..", ".env") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TXT_DIR = path.resolve(__dirname, "..", "listening_passages", "passages");

const BANDS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const SUFFIXES = ["--", "-", "", "+", "++"] as const;

function deriveLabel(stageIndex: number): string {
  const bandIdx = Math.floor((stageIndex - 1) / 5);
  const suffIdx = (stageIndex - 1) % 5;
  return `${BANDS[bandIdx]}${SUFFIXES[suffIdx]}`;
}

function parseTxtTitle(filePath: string): string {
  const firstLine = fs.readFileSync(filePath, "utf-8").split("\n", 1)[0] ?? "";
  return firstLine.trim().replace(/^-+|-+$/g, "").trim();
}

function parseFilename(base: string): {
  stageIndex: number;
  passageMode: string;
  passageNumber: number;
} {
  // e.g. b2_medium_stage16_passage2
  // band is parts[0], mode can span multiple parts if "very_long"
  const parts = base.split("_");
  const stageTokIdx = parts.findIndex((p) => p.startsWith("stage"));
  const passageTokIdx = parts.findIndex((p) => p.startsWith("passage"));
  if (stageTokIdx < 0 || passageTokIdx < 0) {
    throw new Error(`Cannot parse filename: ${base}`);
  }
  const passageMode = parts.slice(1, stageTokIdx).join("_");
  const stageIndex = parseInt(parts[stageTokIdx]!.replace("stage", ""), 10);
  const passageNumber = parseInt(
    parts[passageTokIdx]!.replace("passage", ""),
    10,
  );
  return { stageIndex, passageMode, passageNumber };
}

async function main() {
  // ── TASK A: derive + update display_label for all listening rows ──
  console.log("=== TASK A: display_label derivation ===");

  const { data: listeningRows, error: fetchErr } = await supabase
    .from("texts")
    .select("id, stage, stage_index, passage_mode, passage_number, title, display_label")
    .ilike("stage", "listening_%");

  if (fetchErr) {
    console.error("Failed to fetch listening rows:", fetchErr);
    process.exit(1);
  }
  console.log(`Fetched ${listeningRows!.length} listening rows.`);

  let labelUpdates = 0;
  let labelUnchanged = 0;
  const labelsApplied = new Map<string, number>();

  for (const row of listeningRows!) {
    const derived = deriveLabel(row.stage_index as number);
    labelsApplied.set(derived, (labelsApplied.get(derived) ?? 0) + 1);
    if (row.display_label === derived) {
      labelUnchanged++;
      continue;
    }
    const { error } = await supabase
      .from("texts")
      .update({ display_label: derived })
      .eq("id", row.id);
    if (error) {
      console.error(`HALT: update failed for ${row.id}:`, error);
      process.exit(1);
    }
    labelUpdates++;
    if (labelUpdates % 100 === 0) process.stdout.write(`  label updates: ${labelUpdates}\r`);
  }
  console.log(`\nLabel updates: ${labelUpdates}, unchanged: ${labelUnchanged}.`);
  console.log("Distribution by label:");
  for (const label of [...labelsApplied.keys()].sort()) {
    console.log(`  ${label}: ${labelsApplied.get(label)}`);
  }

  // ── TASK B: sync titles from .txt ──
  console.log("\n=== TASK B: title sync ===");

  const files = fs.readdirSync(TXT_DIR).filter((f) => f.endsWith(".txt"));
  console.log(`Found ${files.length} .txt files in ${TXT_DIR}`);

  // Build lookup: stage_index|mode|passage → row
  const rowByKey = new Map<string, typeof listeningRows[number]>();
  for (const r of listeningRows!) {
    const key = `${r.stage_index}|${r.passage_mode}|${r.passage_number}`;
    rowByKey.set(key, r);
  }

  let processed = 0;
  let matched = 0;
  let titlesChanged = 0;
  let titlesUnchanged = 0;
  const unmatchedFiles: string[] = [];
  const parseErrors: string[] = [];
  const matchedRowIds = new Set<string>();

  for (const f of files) {
    processed++;
    const base = path.basename(f, ".txt");
    let parsed;
    try {
      parsed = parseFilename(base);
    } catch (err) {
      parseErrors.push(`${f}: ${(err as Error).message}`);
      continue;
    }
    let title: string;
    try {
      title = parseTxtTitle(path.join(TXT_DIR, f));
    } catch (err) {
      parseErrors.push(`${f}: ${(err as Error).message}`);
      continue;
    }
    if (!title) {
      parseErrors.push(`${f}: empty title`);
      continue;
    }

    const key = `${parsed.stageIndex}|${parsed.passageMode}|${parsed.passageNumber}`;
    const row = rowByKey.get(key);
    if (!row) {
      unmatchedFiles.push(f);
      continue;
    }
    matched++;
    matchedRowIds.add(row.id as string);

    if (row.title === title) {
      titlesUnchanged++;
      continue;
    }
    const { error } = await supabase
      .from("texts")
      .update({ title })
      .eq("id", row.id);
    if (error) {
      console.error(`HALT: title update failed for ${row.id} (${f}):`, error);
      process.exit(1);
    }
    titlesChanged++;
    if (titlesChanged % 100 === 0) process.stdout.write(`  title updates: ${titlesChanged}\r`);
  }
  console.log();
  console.log(`.txt files processed:   ${processed}`);
  console.log(`  matched:              ${matched}`);
  console.log(`  titles changed:       ${titlesChanged}`);
  console.log(`  titles unchanged:     ${titlesUnchanged}`);
  console.log(`  unmatched .txt files: ${unmatchedFiles.length}`);
  console.log(`  parse errors:         ${parseErrors.length}`);

  if (unmatchedFiles.length > 0) {
    console.log("\nUnmatched .txt files:");
    for (const f of unmatchedFiles.slice(0, 50)) console.log(`  ${f}`);
    if (unmatchedFiles.length > 50)
      console.log(`  ...and ${unmatchedFiles.length - 50} more`);
  }
  if (parseErrors.length > 0) {
    console.log("\nParse errors:");
    for (const e of parseErrors) console.log(`  ${e}`);
  }

  // ── Unmatched DB listening rows ──
  const unmatchedRows = listeningRows!.filter((r) => !matchedRowIds.has(r.id as string));
  console.log(
    `\nDB listening rows with NO .txt transcript: ${unmatchedRows.length}`,
  );
  if (unmatchedRows.length > 0) {
    console.log("(stage_index, passage_mode, passage_number, current title):");
    const sorted = [...unmatchedRows].sort((a, b) => {
      const as = (a.stage_index as number) - (b.stage_index as number);
      if (as !== 0) return as;
      const am = String(a.passage_mode).localeCompare(String(b.passage_mode));
      if (am !== 0) return am;
      return (a.passage_number as number) - (b.passage_number as number);
    });
    for (const r of sorted) {
      console.log(
        `  stage_index=${r.stage_index} mode=${r.passage_mode} passage=${r.passage_number} "${r.title}"`,
      );
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
