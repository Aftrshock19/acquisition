/**
 * Batch generation script for Google Cloud Chirp listening audio.
 *
 * Imports listening_passages/ into the texts table (if not already present),
 * then synthesizes support audio for each text, uploads to Supabase Storage,
 * and inserts linked audio rows.
 *
 * Resumable: safe to re-run — skips texts that already have a ready support asset.
 *
 * Usage:
 *   npx tsx scripts/generate-chirp-audio.ts [options]
 *
 * Options:
 *   --limit N          Process at most N texts
 *   --offset N         Skip the first N eligible texts
 *   --text-id UUID     Process a single text by ID
 *   --filename GLOB    Filter passages by filename (e.g. "a1_short_*")
 *   --stage STAGE      Filter by stage metadata (e.g. "stage1")
 *   --cefr LEVEL       Filter by CEFR level (e.g. "a1", "b2")
 *   --only-missing      Only process texts that lack a ready support asset
 *   --variant TYPE      Asset variant (default: support)
 *   --dry-run           Show what would be done without synthesizing
 *   --concurrency N     Parallel synthesis limit (default: 1)
 *
 * Requires:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   Application Default Credentials (gcloud auth application-default login)
 *
 * Env vars (optional):
 *   GOOGLE_TTS_VOICE_SUPPORT  default: es-ES-Chirp3-HD-Leda
 *   GOOGLE_CLOUD_PROJECT_ID   default: acquisition-493119
 */

import { config } from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { synthesizeChirp } from "../lib/chirp/synthesize";
import {
  LISTENING_AUDIO_BUCKET,
  audioStoragePath,
  storagePublicUrl,
} from "../lib/chirp/storage";
import {
  extractTitleFromPassageFile,
  txtFilenameToJsonFilename,
  extractMetaFromJson,
} from "../lib/listening/passageMeta";

// ── Env ───────────────────────────────────────────────────────
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

// ── CLI args ──────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--only-missing") {
      opts.onlyMissing = true;
    } else if (arg?.startsWith("--") && i + 1 < args.length) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      opts[key] = args[++i]!;
    }
  }
  return {
    limit: opts.limit ? parseInt(opts.limit as string, 10) : undefined,
    offset: opts.offset ? parseInt(opts.offset as string, 10) : 0,
    textId: opts.textId as string | undefined,
    filename: opts.filename as string | undefined,
    stage: opts.stage as string | undefined,
    cefr: opts.cefr as string | undefined,
    onlyMissing: Boolean(opts.onlyMissing || true), // default on
    variant: (opts.variant as string) ?? "support",
    dryRun: Boolean(opts.dryRun),
    concurrency: opts.concurrency ? parseInt(opts.concurrency as string, 10) : 1,
  };
}

// ── Passage filename parsing ──────────────────────────────────

type PassageMeta = {
  filename: string;
  cefr: string;
  mode: string;
  stageNum: number;
  passageNum: number;
  title: string;
};

function parsePassageFilename(filename: string): PassageMeta | null {
  const match = filename.match(
    /^([a-c][12])_(short|medium|long|very_long)_stage(\d+)_passage(\d+)\.txt$/,
  );
  if (!match) return null;
  const [, cefr, mode, stageStr, passageStr] = match;
  const stageNum = parseInt(stageStr!, 10);
  const passageNum = parseInt(passageStr!, 10);
  return {
    filename,
    cefr: cefr!.toUpperCase(),
    mode: mode!,
    stageNum,
    passageNum,
    title: formatTitle(cefr!.toUpperCase(), mode!, stageNum, passageNum),
  };
}

function formatTitle(
  cefr: string,
  mode: string,
  stageNum: number,
  passageNum: number,
): string {
  const cap = mode.charAt(0).toUpperCase() + mode.slice(1).replace(/_/g, " ");
  return `${cefr} ${cap} – Stage ${stageNum} Passage ${passageNum}`;
}

// ── Import listening passages to texts ────────────────────────

async function importListeningPassages(
  passagesDir: string,
  opts: { cefr?: string; stage?: string; filename?: string },
): Promise<number> {
  const files = fs.readdirSync(passagesDir).filter((f) => f.endsWith(".txt"));
  let imported = 0;

  // Sort deterministically
  files.sort();

  // Filter
  const filtered = files.filter((f) => {
    const meta = parsePassageFilename(f);
    if (!meta) return false;
    if (opts.cefr && meta.cefr.toLowerCase() !== opts.cefr.toLowerCase())
      return false;
    if (opts.stage && `stage${meta.stageNum}` !== opts.stage) return false;
    if (opts.filename && !matchGlob(f, opts.filename)) return false;
    return true;
  });

  console.log(`  Found ${filtered.length} passage files to consider.`);

  const jsonDir = path.resolve(passagesDir, "..", "all_passages_renamed");

  // Batch insert/check in groups of 50
  const BATCH = 50;
  for (let i = 0; i < filtered.length; i += BATCH) {
    const batch = filtered.slice(i, i + BATCH);
    const rows = batch.map((filename) => {
      const meta = parsePassageFilename(filename)!;
      const filePath = path.join(passagesDir, filename);
      const content = fs.readFileSync(filePath, "utf-8").trim();

      // Extract real human title from the ---Title--- header
      const humanTitle = extractTitleFromPassageFile(filePath);

      // Extract topic from paired JSON metadata
      const jsonFilename = txtFilenameToJsonFilename(filename);
      const jsonPath = jsonFilename ? path.join(jsonDir, jsonFilename) : null;
      const jsonMeta = jsonPath ? extractMetaFromJson(jsonPath) : { title: null, topic: null };

      return {
        lang: "es",
        title: humanTitle ?? `Listening: ${meta.title}`,
        topic: jsonMeta.topic ?? null,
        content,
        difficulty_cefr: meta.cefr,
        stage: `listening_stage_${meta.stageNum}`,
        passage_mode: meta.mode,
        passage_number: meta.passageNum,
      };
    });

    // Use upsert to avoid duplicates (stage, passage_mode, passage_number is UNIQUE)
    const { data, error } = await supabase
      .from("texts")
      .upsert(rows, { onConflict: "stage,passage_mode,passage_number" })
      .select("id");

    if (error) {
      console.error(`  Import batch ${i} error:`, error.message);
      continue;
    }
    imported += (data ?? []).length;
  }

  return imported;
}

// ── Fetch eligible texts ──────────────────────────────────────

type TextRow = {
  id: string;
  title: string;
  content: string;
  difficulty_cefr: string | null;
  stage: string | null;
};

async function fetchEligibleTexts(opts: {
  textId?: string;
  cefr?: string;
  stage?: string;
  variant: string;
  onlyMissing: boolean;
  limit?: number;
  offset: number;
}): Promise<TextRow[]> {
  // If single text-id requested
  if (opts.textId) {
    const { data, error } = await supabase
      .from("texts")
      .select("id, title, content, difficulty_cefr, stage")
      .eq("id", opts.textId)
      .single();
    if (error || !data) {
      console.error("Text not found:", opts.textId);
      return [];
    }
    return [data as TextRow];
  }

  // Build query for listening texts
  let query = supabase
    .from("texts")
    .select("id, title, content, difficulty_cefr, stage")
    .like("stage", "listening_stage_%")
    .order("stage", { ascending: true })
    .order("passage_mode", { ascending: true })
    .order("passage_number", { ascending: true });

  if (opts.cefr) {
    query = query.eq("difficulty_cefr", opts.cefr.toUpperCase());
  }
  if (opts.stage) {
    query = query.eq("stage", `listening_${opts.stage}`);
  }

  const { data: texts, error } = await query;
  if (error) {
    console.error("Error fetching texts:", error.message);
    return [];
  }

  let eligible = (texts ?? []) as TextRow[];

  // Filter to only-missing if requested
  if (opts.onlyMissing) {
    const textIds = eligible.map((t) => t.id);
    if (textIds.length === 0) return [];

    // Fetch existing ready assets for these texts
    const { data: existingAssets } = await supabase
      .from("audio")
      .select("text_id")
      .in("text_id", textIds)
      .eq("variant_type", opts.variant)
      .eq("status", "ready");

    const existingSet = new Set(
      (existingAssets ?? []).map((a) => a.text_id),
    );
    eligible = eligible.filter((t) => !existingSet.has(t.id));
  }

  // Apply offset and limit
  if (opts.offset > 0) {
    eligible = eligible.slice(opts.offset);
  }
  if (opts.limit !== undefined) {
    eligible = eligible.slice(0, opts.limit);
  }

  return eligible;
}

// ── Ensure storage bucket ─────────────────────────────────────

async function ensureBucket(sb: SupabaseClient) {
  const { data: buckets } = await sb.storage.listBuckets();
  if (buckets?.some((b) => b.name === LISTENING_AUDIO_BUCKET)) return;

  const { error } = await sb.storage.createBucket(LISTENING_AUDIO_BUCKET, {
    public: true,
  });
  if (error) throw new Error(`Failed to create bucket: ${error.message}`);
  console.log(`  Created bucket "${LISTENING_AUDIO_BUCKET}"`);
}

// ── Process one text ──────────────────────────────────────────

type ProcessResult = {
  textId: string;
  title: string;
  status: "created" | "skipped" | "failed";
  audioId?: string;
  storagePath?: string;
  error?: string;
  requestCount?: number;
  audioSize?: number;
};

async function processText(
  text: TextRow,
  variant: string,
  voiceName: string,
  dryRun: boolean,
): Promise<ProcessResult> {
  const storagePath = audioStoragePath(text.id, variant);
  const publicUrl = storagePublicUrl(supabaseUrl, storagePath);

  if (dryRun) {
    return {
      textId: text.id,
      title: text.title,
      status: "created",
      storagePath,
    };
  }

  try {
    // Synthesize
    const { audioBytes, requestCount } = await synthesizeChirp({
      text: text.content,
      voiceName,
    });

    // Upload
    const { error: uploadError } = await supabase.storage
      .from(LISTENING_AUDIO_BUCKET)
      .upload(storagePath, audioBytes, {
        contentType: "audio/mpeg",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // Insert audio row
    const { data: audioRow, error: insertError } = await supabase
      .from("audio")
      .upsert(
        {
          text_id: text.id,
          variant_type: variant,
          title: text.title.replace(/^Listening:\s*/i, ""),
          url: publicUrl,
          storage_path: storagePath,
          transcript: text.content,
          provider: "google_chirp",
          voice_name: voiceName,
          language_code: voiceName.slice(0, 5),
          mime_type: "audio/mpeg",
          status: "ready",
          error_message: null,
        },
        { onConflict: "text_id,variant_type" },
      )
      .select("id")
      .single();

    if (insertError) {
      throw new Error(`DB insert failed: ${insertError.message}`);
    }

    return {
      textId: text.id,
      title: text.title,
      status: "created",
      audioId: audioRow.id,
      storagePath,
      requestCount,
      audioSize: audioBytes.length,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Record failure in DB
    try {
      await supabase.from("audio").upsert(
        {
          text_id: text.id,
          variant_type: variant,
          title: text.title.replace(/^Listening:\s*/i, ""),
          url: "",
          storage_path: storagePath,
          transcript: text.content,
          provider: "google_chirp",
          voice_name: voiceName,
          language_code: voiceName.slice(0, 5),
          status: "failed",
          error_message: errorMsg,
        },
        { onConflict: "text_id,variant_type" },
      );
    } catch {
      // best-effort
    }

    return {
      textId: text.id,
      title: text.title,
      status: "failed",
      error: errorMsg,
    };
  }
}

// ── Glob matching (minimal) ───────────────────────────────────

function matchGlob(filename: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$",
  );
  return re.test(filename);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const voiceName = process.env.GOOGLE_TTS_VOICE_SUPPORT ?? "es-ES-Chirp3-HD-Leda";
  const passagesDir = path.resolve(__dirname, "..", "listening_passages");

  console.log("=== Chirp Audio Generation ===");
  console.log(`  Voice:   ${voiceName}`);
  console.log(`  Variant: ${opts.variant}`);
  console.log(`  Dry run: ${opts.dryRun}`);
  console.log();

  // 1. Ensure bucket
  if (!opts.dryRun) {
    await ensureBucket(supabase);
  }

  // 2. Import listening passages to texts table
  console.log("Phase 1: Importing listening passages...");
  const imported = await importListeningPassages(passagesDir, {
    cefr: opts.cefr,
    stage: opts.stage,
    filename: opts.filename,
  });
  console.log(`  Upserted ${imported} text rows.\n`);

  // 3. Fetch eligible texts
  console.log("Phase 2: Fetching eligible texts...");
  const texts = await fetchEligibleTexts({
    textId: opts.textId,
    cefr: opts.cefr,
    stage: opts.stage,
    variant: opts.variant,
    onlyMissing: Boolean(opts.onlyMissing),
    limit: opts.limit,
    offset: opts.offset,
  });
  console.log(`  ${texts.length} texts to process.\n`);

  if (texts.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // 4. Process
  console.log("Phase 3: Generating audio...");
  const results: ProcessResult[] = [];
  let created = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i]!;
    const label = `[${i + 1}/${texts.length}]`;

    process.stdout.write(`  ${label} ${text.title}... `);

    const result = await processText(text, opts.variant, voiceName, opts.dryRun);
    results.push(result);

    if (result.status === "created") {
      created++;
      const sizeKb = result.audioSize
        ? `${Math.round(result.audioSize / 1024)}KB`
        : "";
      const chunks = (result.requestCount ?? 1) > 1
        ? ` (${result.requestCount} chunks)`
        : "";
      console.log(`OK ${sizeKb}${chunks}`);
    } else if (result.status === "failed") {
      failed++;
      console.log(`FAILED: ${result.error}`);
    } else {
      skipped++;
      console.log("skipped");
    }
  }

  // 5. Summary
  console.log("\n=== Summary ===");
  console.log(`  Total considered: ${texts.length}`);
  console.log(`  Created:          ${created}`);
  console.log(`  Failed:           ${failed}`);
  console.log(`  Skipped:          ${skipped}`);

  // 6. Write manifest
  const manifestPath = path.resolve(__dirname, "..", "chirp-generation-manifest.json");
  const manifest = {
    generatedAt: new Date().toISOString(),
    voice: voiceName,
    variant: opts.variant,
    dryRun: opts.dryRun,
    total: texts.length,
    created,
    failed,
    skipped,
    results: results.map((r) => ({
      textId: r.textId,
      title: r.title,
      status: r.status,
      audioId: r.audioId,
      storagePath: r.storagePath,
      error: r.error,
    })),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n  Manifest: ${manifestPath}`);

  if (failed > 0) {
    console.log(
      "\n  To resume failed items: npx tsx scripts/generate-chirp-audio.ts --only-missing",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
