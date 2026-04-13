#!/usr/bin/env npx tsx
/**
 * Backfill script: link unlinked audio rows to texts via listening_passages/.
 *
 * For each .txt file in listening_passages/:
 *   1. Parse filename → {cefr, mode, stageNum, passageNum}
 *   2. Upsert a text row with listening_stage_N (matching generate-chirp-audio.ts convention)
 *   3. Match the passage content to the audio row by transcript prefix
 *   4. Set text_id on the matched audio row
 *
 * Idempotent: safe to re-run. Skips audio rows that already have text_id set.
 *
 * Usage:
 *   npx tsx scripts/backfill-link-audio-texts.ts [--dry-run]
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  extractTitleFromPassageFile,
  txtFilenameToJsonFilename,
  extractMetaFromJson,
} from "../lib/listening/passageMeta";

config({ path: path.resolve(__dirname, "..", ".env.local") });
config({ path: path.resolve(__dirname, "..", ".env") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSAGES_DIR = path.resolve(__dirname, "..", "listening_passages");
const JSON_DIR = path.resolve(__dirname, "..", "all_passages_renamed");
const dryRun = process.argv.includes("--dry-run");

type PassageMeta = {
  filename: string;
  cefr: string;
  mode: string;
  stageNum: number;
  passageNum: number;
};

function parseFilename(filename: string): PassageMeta | null {
  const match = filename.match(
    /^([a-c][12])_(short|medium|long|very_long)_stage(\d+)_passage(\d+)\.txt$/,
  );
  if (!match) return null;
  return {
    filename,
    cefr: match[1]!.toUpperCase(),
    mode: match[2]!,
    stageNum: parseInt(match[3]!, 10),
    passageNum: parseInt(match[4]!, 10),
  };
}

function readPassageContent(filename: string): { title: string; content: string } {
  const filePath = path.join(PASSAGES_DIR, filename);
  const raw = fs.readFileSync(filePath, "utf-8");

  const humanTitle = extractTitleFromPassageFile(filePath);
  // Strip the ---Title--- header line to get content
  const titleMatch = raw.match(/^---(.+?)---\n/);
  const content = titleMatch ? raw.slice(titleMatch[0].length).trim() : raw.trim();

  const meta = parseFilename(filename)!;
  const fallbackTitle = `${meta.cefr} ${meta.mode.charAt(0).toUpperCase() + meta.mode.slice(1)} – Stage ${meta.stageNum} Passage ${meta.passageNum}`;

  return {
    title: humanTitle ?? fallbackTitle,
    content,
  };
}

async function main() {
  console.log(dryRun ? "=== DRY RUN ===" : "=== BACKFILL: Link Audio → Texts ===");
  console.log();

  // 1. Read all passage files
  const files = fs.readdirSync(PASSAGES_DIR).filter((f) => f.endsWith(".txt")).sort();
  console.log(`Found ${files.length} passage files`);

  const parsed = files.map((f) => ({ meta: parseFilename(f), filename: f })).filter((p) => p.meta !== null) as {
    meta: PassageMeta;
    filename: string;
  }[];
  console.log(`Parsed ${parsed.length} valid passage filenames`);

  // 2. Fetch all unlinked audio rows (text_id is null)
  const { data: unlinkedAudio, error: audioErr } = await supabase
    .from("audio")
    .select("id, transcript")
    .is("text_id", null)
    .eq("status", "ready");

  if (audioErr) {
    console.error("Error fetching audio:", audioErr.message);
    process.exit(1);
  }

  console.log(`Found ${unlinkedAudio?.length ?? 0} unlinked audio rows`);

  // Build index: first 60 chars of transcript → audio row
  const audioByPrefix = new Map<string, { id: string; transcript: string }>();
  for (const row of unlinkedAudio ?? []) {
    if (!row.transcript) continue;
    const prefix = row.transcript.substring(0, 60).trim();
    audioByPrefix.set(prefix, row);
  }

  // 3. Process in batches: upsert texts, then link audio
  const BATCH = 50;
  const stats = {
    textsUpserted: 0,
    audioLinked: 0,
    audioNoMatch: 0,
    audioAlreadyLinked: 0,
    errors: 0,
  };

  for (let i = 0; i < parsed.length; i += BATCH) {
    const batch = parsed.slice(i, i + BATCH);

    // Prepare text rows for upsert
    const textRows = batch.map(({ meta, filename }) => {
      const { title, content } = readPassageContent(filename);

      const jsonFilename = txtFilenameToJsonFilename(filename);
      const jsonPath = jsonFilename ? path.join(JSON_DIR, jsonFilename) : null;
      const jsonMeta = jsonPath ? extractMetaFromJson(jsonPath) : { title: null, topic: null };

      return {
        lang: "es",
        title,
        topic: jsonMeta.topic ?? null,
        content,
        difficulty_cefr: meta.cefr,
        stage: `listening_stage_${meta.stageNum}`,
        stage_index: meta.stageNum,
        display_label: meta.cefr,
        passage_mode: meta.mode,
        passage_number: meta.passageNum,
      };
    });

    if (dryRun) {
      for (const row of textRows) {
        console.log(`  [text] ${row.stage} ${row.passage_mode} #${row.passage_number} "${row.title}"`);
      }
      stats.textsUpserted += textRows.length;
      continue;
    }

    // Upsert texts
    const { data: upsertedTexts, error: upsertErr } = await supabase
      .from("texts")
      .upsert(textRows, { onConflict: "stage,passage_mode,passage_number" })
      .select("id, content");

    if (upsertErr) {
      console.error(`  Batch ${i} text upsert error:`, upsertErr.message);
      stats.errors++;
      continue;
    }

    stats.textsUpserted += (upsertedTexts ?? []).length;

    // Link each text to its audio row by matching content prefix
    for (const text of upsertedTexts ?? []) {
      const prefix = text.content.substring(0, 60).trim();
      const audioRow = audioByPrefix.get(prefix);

      if (!audioRow) {
        stats.audioNoMatch++;
        continue;
      }

      const { error: updateErr } = await supabase
        .from("audio")
        .update({ text_id: text.id })
        .eq("id", audioRow.id);

      if (updateErr) {
        console.error(`  Error linking audio ${audioRow.id} → text ${text.id}:`, updateErr.message);
        stats.errors++;
      } else {
        stats.audioLinked++;
        // Remove from index so we don't double-link
        audioByPrefix.delete(prefix);
      }
    }

    if ((i + BATCH) % 200 === 0 || i + BATCH >= parsed.length) {
      console.log(`  Processed ${Math.min(i + BATCH, parsed.length)}/${parsed.length}`);
    }
  }

  console.log();
  console.log("=== Report ===");
  console.log(`  Texts upserted:       ${stats.textsUpserted}`);
  console.log(`  Audio linked:         ${stats.audioLinked}`);
  console.log(`  Audio no match:       ${stats.audioNoMatch}`);
  console.log(`  Errors:               ${stats.errors}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
