/**
 * Phase 8: insert 116 new listening passages into DB + upload MP3s to Storage.
 *
 * For each .txt in listening_passages/reformatted/:
 *   1. Parse stage/mode/passage from filename.
 *   2. Collision check: skip if DB row already exists.
 *   3. Generate a UUID, upload the matching .mp3 to
 *      listening-audio/audio/es-ES/{uuid}/support.mp3.
 *   4. Insert texts row (id = uuid).
 *   5. Insert audio row (text_id = uuid, variant=support, status=ready).
 *   6. If any post-upload step fails, attempt to delete the uploaded object.
 *
 * Usage:
 *   npx tsx scripts/upload-new-listening-passages.ts --dry-run      # 1 file, no writes
 *   npx tsx scripts/upload-new-listening-passages.ts --limit 5      # first 5
 *   npx tsx scripts/upload-new-listening-passages.ts                # full run (116)
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  LISTENING_AUDIO_BUCKET,
  audioStoragePath,
  storagePublicUrl,
} from "../lib/chirp/storage";

config({ path: path.resolve(__dirname, "..", ".env.local") });
config({ path: path.resolve(__dirname, "..", ".env") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "FATAL: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TXT_DIR = path.resolve(__dirname, "..", "listening_passages", "reformatted");
const MP3_DIR = path.resolve(__dirname, "..", "downloads", "listening-audio");

const BANDS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
const SUFFIXES = ["--", "-", "", "+", "++"] as const;
function deriveLabel(stageIndex: number): string {
  return `${BANDS[Math.floor((stageIndex - 1) / 5)]}${SUFFIXES[(stageIndex - 1) % 5]}`;
}

function parseFilename(base: string): {
  stageIndex: number;
  passageMode: string;
  passageNumber: number;
} {
  const parts = base.split("_");
  const stageTok = parts.findIndex((p) => p.startsWith("stage"));
  const passageTok = parts.findIndex((p) => p.startsWith("passage"));
  if (stageTok < 0 || passageTok < 0) throw new Error(`bad filename: ${base}`);
  return {
    stageIndex: parseInt(parts[stageTok]!.replace("stage", ""), 10),
    passageMode: parts.slice(1, stageTok).join("_"),
    passageNumber: parseInt(parts[passageTok]!.replace("passage", ""), 10),
  };
}

function readTxt(filePath: string): { title: string; body: string; wordCount: number } {
  const raw = fs.readFileSync(filePath, "utf-8");
  const nl = raw.indexOf("\n");
  const firstLine = nl === -1 ? raw : raw.slice(0, nl);
  const rest = nl === -1 ? "" : raw.slice(nl + 1);
  const title = firstLine.trim().replace(/^-+|-+$/g, "").trim();
  const body = rest.trim();
  const wordCount = body ? body.split(/\s+/).length : 0;
  return { title, body, wordCount };
}

type Stats = {
  processed: number;
  succeeded: number;
  collisions: number;
  uploadFailures: number;
  insertFailures: number;
  rollbackSuccess: number;
  rollbackFailures: number;
  errors: string[];
};
const stats: Stats = {
  processed: 0,
  succeeded: 0,
  collisions: 0,
  uploadFailures: 0,
  insertFailures: 0,
  rollbackSuccess: 0,
  rollbackFailures: 0,
  errors: [],
};

async function getListeningCounts(): Promise<{ texts: number; audio: number }> {
  const { count: textsCount, error: e1 } = await supabase
    .from("texts")
    .select("id", { count: "exact", head: true })
    .ilike("stage", "listening_%");
  if (e1) throw new Error(`count listening texts: ${e1.message}`);
  const { count: audioCount, error: e2 } = await supabase
    .from("audio")
    .select("id", { count: "exact", head: true })
    .not("text_id", "is", null);
  if (e2) throw new Error(`count audio: ${e2.message}`);
  return { texts: textsCount ?? 0, audio: audioCount ?? 0 };
}

type Task = {
  base: string;
  txtPath: string;
  mp3Path: string;
  stageIndex: number;
  passageMode: string;
  passageNumber: number;
};

function buildTasks(): Task[] {
  if (!fs.existsSync(TXT_DIR)) {
    console.error(`Source dir missing: ${TXT_DIR}`);
    process.exit(1);
  }
  const files = fs.readdirSync(TXT_DIR).filter((f) => f.endsWith(".txt")).sort();
  return files.map((f) => {
    const base = f.slice(0, -4);
    const parsed = parseFilename(base);
    return {
      base,
      txtPath: path.join(TXT_DIR, f),
      mp3Path: path.join(MP3_DIR, `${base}.mp3`),
      ...parsed,
    };
  });
}

async function processOne(task: Task, dryRun: boolean): Promise<void> {
  stats.processed++;
  const label = `${task.base}`;

  // 1. Preflight: mp3 must exist on disk
  if (!fs.existsSync(task.mp3Path)) {
    stats.uploadFailures++;
    stats.errors.push(`${label}: mp3 missing at ${task.mp3Path}`);
    console.error(`  [fail] ${label} — mp3 missing`);
    return;
  }

  // 2. Parse .txt
  const { title, body, wordCount } = readTxt(task.txtPath);
  if (!title || !body) {
    stats.insertFailures++;
    stats.errors.push(`${label}: empty title or body`);
    console.error(`  [fail] ${label} — empty title/body`);
    return;
  }

  // 3. Collision check
  const { data: existing, error: lookupErr } = await supabase
    .from("texts")
    .select("id")
    .eq("stage_index", task.stageIndex)
    .eq("passage_mode", task.passageMode)
    .eq("passage_number", task.passageNumber)
    .ilike("stage", "listening_%")
    .maybeSingle();
  if (lookupErr) {
    stats.errors.push(`${label}: collision-check error: ${lookupErr.message}`);
    console.error(`  [fail] ${label} — collision-check error: ${lookupErr.message}`);
    stats.insertFailures++;
    return;
  }
  if (existing) {
    stats.collisions++;
    console.log(`  [skip] ${label} — DB collision on existing id=${existing.id}`);
    return;
  }

  // 4. Generate UUID, derive fields
  const textId = randomUUID();
  const stageCol = `listening_stage_${task.stageIndex}`;
  const displayLabel = deriveLabel(task.stageIndex);
  const storagePath = audioStoragePath(textId, "support");
  const publicUrl = storagePublicUrl(SUPABASE_URL, storagePath);

  if (dryRun) {
    console.log(`\n  [dry-run] ${label}`);
    console.log(`    generated text_id:  ${textId}`);
    console.log(`    stage:              ${stageCol}`);
    console.log(`    stage_index:        ${task.stageIndex}`);
    console.log(`    passage_mode:       ${task.passageMode}`);
    console.log(`    passage_number:     ${task.passageNumber}`);
    console.log(`    display_label:      ${displayLabel}`);
    console.log(`    difficulty_cefr:    a1`);
    console.log(`    title:              ${JSON.stringify(title)}`);
    console.log(`    word_count (calc):  ${wordCount}`);
    console.log(`    body (first 60):    ${JSON.stringify(body.slice(0, 60))}`);
    console.log(`    storage_path:       ${storagePath}`);
    console.log(`    public_url:         ${publicUrl}`);
    console.log(`    mp3 size:           ${fs.statSync(task.mp3Path).size} bytes`);
    stats.succeeded++;
    return;
  }

  // 5. Upload MP3
  const mp3Bytes = fs.readFileSync(task.mp3Path);
  const { error: upErr } = await supabase.storage
    .from(LISTENING_AUDIO_BUCKET)
    .upload(storagePath, mp3Bytes, {
      contentType: "audio/mpeg",
      upsert: false,
    });
  if (upErr) {
    stats.uploadFailures++;
    stats.errors.push(`${label}: upload failed: ${upErr.message}`);
    console.error(`  [fail upload] ${label} — ${upErr.message}`);
    return;
  }

  // Helper: rollback the uploaded object
  async function rollbackUpload(reason: string): Promise<void> {
    const { error: rmErr } = await supabase.storage
      .from(LISTENING_AUDIO_BUCKET)
      .remove([storagePath]);
    if (rmErr) {
      stats.rollbackFailures++;
      console.error(
        `  [rollback FAIL] ${label} — ${rmErr.message} (orphan remains at ${storagePath})`,
      );
    } else {
      stats.rollbackSuccess++;
      console.warn(`  [rollback ok] ${label} — ${reason}; storage object removed`);
    }
  }

  // 6. Insert texts row
  const { error: textInsErr } = await supabase.from("texts").insert({
    id: textId,
    lang: "es",
    title,
    content: body,
    stage: stageCol,
    stage_index: task.stageIndex,
    display_label: displayLabel,
    passage_mode: task.passageMode,
    passage_number: task.passageNumber,
    difficulty_cefr: "a1",
  });
  if (textInsErr) {
    stats.insertFailures++;
    stats.errors.push(`${label}: texts insert: ${textInsErr.message}`);
    console.error(`  [fail texts] ${label} — ${textInsErr.message}`);
    await rollbackUpload("texts insert failed");
    return;
  }

  // Parse duration from the mp3 bytes we already have in memory.
  // Dynamic import: music-metadata v11 is ESM-only.
  let durationSeconds: number | null = null;
  try {
    const { parseBuffer } = await import("music-metadata");
    const meta = await parseBuffer(mp3Bytes, "audio/mpeg", { skipCovers: true });
    if (meta.format.duration) durationSeconds = Math.round(meta.format.duration);
  } catch {
    // Duration is best-effort; row still inserts with null and can be backfilled later.
  }

  // 7. Insert audio row
  const { error: audioInsErr } = await supabase.from("audio").insert({
    text_id: textId,
    variant_type: "support",
    status: "ready",
    url: publicUrl,
    storage_path: storagePath,
    provider: "google_chirp",
    language_code: "es-ES",
    voice_name: "es-ES-Chirp3-HD-Leda",
    mime_type: "audio/mpeg",
    duration_seconds: durationSeconds,
    title: `Listening: ${task.base}`,
  });
  if (audioInsErr) {
    stats.insertFailures++;
    stats.errors.push(`${label}: audio insert: ${audioInsErr.message}`);
    console.error(`  [fail audio] ${label} — ${audioInsErr.message}`);
    // Clean up texts row and the uploaded object
    const { error: delErr } = await supabase.from("texts").delete().eq("id", textId);
    if (delErr) {
      console.error(`  [rollback texts FAIL] ${label} — ${delErr.message}`);
    }
    await rollbackUpload("audio insert failed");
    return;
  }

  stats.succeeded++;
  console.log(
    `  [ok] ${label} — stage_${task.stageIndex} #${task.passageNumber} uuid=${textId.slice(0, 8)}`,
  );
}

async function runPool<T>(items: T[], limit: number, worker: (t: T) => Promise<void>) {
  let idx = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (idx < items.length) {
        const i = idx++;
        await worker(items[i]!);
      }
    },
  );
  await Promise.all(runners);
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(argv[limitIdx + 1] ?? "0", 10) : 0;
  const cIdx = argv.indexOf("--concurrency");
  const concurrency = cIdx >= 0 ? parseInt(argv[cIdx + 1] ?? "3", 10) : 3;

  console.log(`Mode: ${dryRun ? "DRY RUN (1 file, no writes)" : "LIVE"}`);
  console.log(`Source: ${TXT_DIR}`);
  console.log(`MP3s:   ${MP3_DIR}`);
  console.log(`Bucket: ${LISTENING_AUDIO_BUCKET}`);
  if (!dryRun) console.log(`Concurrency: ${concurrency}`);

  const before = await getListeningCounts();
  console.log(`\nListening counts BEFORE: texts=${before.texts}, audio=${before.audio}`);

  const allTasks = buildTasks();
  console.log(`Source .txt files: ${allTasks.length}`);

  let tasks = allTasks;
  if (dryRun) tasks = allTasks.slice(0, 1);
  else if (limit > 0) tasks = allTasks.slice(0, limit);

  console.log(`Processing: ${tasks.length}\n`);

  const started = Date.now();
  await runPool(tasks, dryRun ? 1 : concurrency, (t) => processOne(t, dryRun));
  const elapsed = (Date.now() - started) / 1000;

  const after = dryRun ? before : await getListeningCounts();

  console.log("\n=== Summary ===");
  console.log(`Processed:          ${stats.processed}`);
  console.log(`Succeeded:          ${stats.succeeded}`);
  console.log(`Collisions (skip):  ${stats.collisions}`);
  console.log(`Upload failures:    ${stats.uploadFailures}`);
  console.log(`Insert failures:    ${stats.insertFailures}`);
  console.log(`Rollback ok:        ${stats.rollbackSuccess}`);
  console.log(`Rollback failed:    ${stats.rollbackFailures}`);
  console.log(`Wall time:          ${elapsed.toFixed(1)} s`);
  console.log();
  console.log(`Listening counts BEFORE: texts=${before.texts}, audio=${before.audio}`);
  console.log(`Listening counts AFTER:  texts=${after.texts}, audio=${after.audio}`);
  if (stats.errors.length > 0) {
    console.log("\nErrors / warnings:");
    for (const e of stats.errors) console.log(`  - ${e}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
