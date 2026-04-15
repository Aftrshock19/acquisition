/**
 * Production word-audio corpus generator.
 *
 * For each eligible `words` row, synthesizes via Google Cloud Chirp:
 *   1. lemma pronunciation        → audio/es-ES/words/{wordId}/lemma.mp3
 *   2. example-sentence audio     → audio/es-ES/words/{wordId}/lemma-sentence.mp3
 *
 * Uploads both to the `listening-audio` Supabase Storage bucket, writes the
 * storage paths back into `words.lemma_audio_path` and
 * `words.lemma_sentence_audio_path`, and (by default) mirrors the files
 * locally under repo-root folders:
 *
 *   word-audio/{rank}-{lemma}.mp3          (lemma)
 *   sentence-audio/{rank}-{lemma}.mp3      (sentence)
 *
 * Safe to interrupt and resume.  On re-run only rows that are missing either
 * the DB path, the storage object, or (when local export is enabled) the
 * local file are re-processed.
 *
 * Auth: Application Default Credentials (gcloud auth application-default login).
 *       Supabase service-role key loaded from .env.local.
 *
 * Usage:
 *   npx tsx scripts/generate-word-audio.ts                         # full run, default
 *   npx tsx scripts/generate-word-audio.ts --limit 20              # first 20 eligible
 *   npx tsx scripts/generate-word-audio.ts --type lemma            # lemma only
 *   npx tsx scripts/generate-word-audio.ts --type sentence         # sentence only
 *   npx tsx scripts/generate-word-audio.ts --word-id <uuid>
 *   npx tsx scripts/generate-word-audio.ts --rank-min 1 --rank-max 100
 *   npx tsx scripts/generate-word-audio.ts --force                 # re-synthesize + overwrite
 *   npx tsx scripts/generate-word-audio.ts --no-save-local         # skip local mirror
 *   npx tsx scripts/generate-word-audio.ts --concurrency 3
 *   npx tsx scripts/generate-word-audio.ts --dry-run
 */

import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { synthesizeChirp } from "../lib/chirp/synthesize";
import {
  LISTENING_AUDIO_BUCKET,
  wordAudioStoragePath,
  type WordAudioVariant,
} from "../lib/chirp/storage";
import {
  canonicalWordSentence,
  localDirnameForVariant,
  wordAudioLocalFilename,
} from "../lib/chirp/wordAudio";

// ── Env ───────────────────────────────────────────────────────

config({ path: path.resolve(__dirname, "..", ".env.local") });
config({ path: path.resolve(__dirname, "..", ".env") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const VOICE = process.env.GOOGLE_TTS_VOICE_SUPPORT ?? "es-ES-Chirp3-HD-Leda";

// ── Paths ─────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "word-audio-manifest.json");

function localDirForVariant(variant: WordAudioVariant): string {
  return path.join(REPO_ROOT, localDirnameForVariant(variant));
}

// ── CLI ───────────────────────────────────────────────────────

type Type = "lemma" | "sentence" | "both";

type Opts = {
  limit?: number;
  offset: number;
  wordId?: string;
  rankMin?: number;
  rankMax?: number;
  onlyMissing: boolean;
  type: Type;
  dryRun: boolean;
  force: boolean;
  saveLocal: boolean;
  concurrency: number;
};

function parseArgs(): Opts {
  const a = process.argv.slice(2);
  const opts: Opts = {
    offset: 0,
    onlyMissing: true,
    type: "both",
    dryRun: false,
    force: false,
    saveLocal: true,
    concurrency: 2,
  };
  for (let i = 0; i < a.length; i++) {
    const arg = a[i]!;
    const val = a[i + 1];
    switch (arg) {
      case "--limit":
        opts.limit = parseInt(val!, 10);
        i++;
        break;
      case "--offset":
        opts.offset = parseInt(val!, 10);
        i++;
        break;
      case "--word-id":
        opts.wordId = val;
        i++;
        break;
      case "--rank-min":
        opts.rankMin = parseInt(val!, 10);
        i++;
        break;
      case "--rank-max":
        opts.rankMax = parseInt(val!, 10);
        i++;
        break;
      case "--type":
        if (val === "lemma" || val === "sentence" || val === "both") {
          opts.type = val;
        }
        i++;
        break;
      case "--concurrency":
        opts.concurrency = Math.max(1, parseInt(val!, 10));
        i++;
        break;
      case "--only-missing":
        opts.onlyMissing = true;
        break;
      case "--all":
        opts.onlyMissing = false;
        break;
      case "--force":
        opts.force = true;
        opts.onlyMissing = false;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--no-save-local":
        opts.saveLocal = false;
        break;
      case "--save-local":
        opts.saveLocal = true;
        break;
    }
  }
  return opts;
}

// ── Types ─────────────────────────────────────────────────────

type WordRow = {
  id: string;
  rank: number;
  lemma: string;
  example_sentence: string | null;
  lemma_audio_path: string | null;
  lemma_sentence_audio_path: string | null;
};

type VariantResult = {
  storagePath: string | null;
  localPath: string | null;
  bytes: number;
  status: "ok" | "skipped" | "failed" | "not-eligible";
  error?: string;
};

type WordResult = {
  wordId: string;
  rank: number;
  lemma: string;
  lemma_audio: VariantResult;
  lemma_sentence_audio: VariantResult;
};

// ── Eligibility query ─────────────────────────────────────────

async function fetchEligible(opts: Opts): Promise<WordRow[]> {
  if (opts.wordId) {
    const { data, error } = await supabase
      .from("words")
      .select(
        "id, rank, lemma, example_sentence, lemma_audio_path, lemma_sentence_audio_path",
      )
      .eq("id", opts.wordId)
      .single();
    if (error) throw new Error(`Word lookup failed: ${error.message}`);
    return [data as WordRow];
  }

  // Fetch in pages — Supabase REST default caps at 1000 per request.
  const PAGE = 1000;
  let offset = 0;
  const rows: WordRow[] = [];
  for (;;) {
    let query = supabase
      .from("words")
      .select(
        "id, rank, lemma, example_sentence, lemma_audio_path, lemma_sentence_audio_path",
      )
      .not("lemma", "is", null)
      .neq("lemma", "")
      .order("rank", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (opts.rankMin !== undefined) query = query.gte("rank", opts.rankMin);
    if (opts.rankMax !== undefined) query = query.lte("rank", opts.rankMax);

    const { data, error } = await query;
    if (error) throw new Error(`Words query failed: ${error.message}`);
    const batch = (data ?? []) as WordRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }

  // Drop rows already fully done when onlyMissing.
  let eligible = rows;
  if (opts.onlyMissing && !opts.force) {
    eligible = eligible.filter((r) => {
      const needLemma = opts.type !== "sentence" && !r.lemma_audio_path;
      const sentenceText = canonicalWordSentence(r);
      const needSentence =
        opts.type !== "lemma" &&
        sentenceText !== null &&
        !r.lemma_sentence_audio_path;
      return needLemma || needSentence;
    });
  }

  if (opts.offset > 0) eligible = eligible.slice(opts.offset);
  if (opts.limit !== undefined) eligible = eligible.slice(0, opts.limit);
  return eligible;
}

// ── Storage bucket bootstrap ──────────────────────────────────

async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((b) => b.name === LISTENING_AUDIO_BUCKET)) return;
  const { error } = await supabase.storage.createBucket(
    LISTENING_AUDIO_BUCKET,
    { public: true },
  );
  if (error) throw new Error(`Create bucket failed: ${error.message}`);
}

/** Lightweight existence check in the bucket. */
async function storageObjectExists(objectPath: string): Promise<boolean> {
  const dir = objectPath.substring(0, objectPath.lastIndexOf("/"));
  const name = objectPath.substring(objectPath.lastIndexOf("/") + 1);
  const { data, error } = await supabase.storage
    .from(LISTENING_AUDIO_BUCKET)
    .list(dir, { limit: 100, search: name });
  if (error) return false;
  return (data ?? []).some((o) => o.name === name);
}

// ── Local filename collision handling ─────────────────────────
//
// `rank` is UNIQUE on `words`, so `{rank}-{lemma}.mp3` collisions are
// effectively impossible in practice.  We still guard against it in case of
// identical sanitized lemmas appearing under different ranks (cannot happen
// given the constraint, but the safeguard is cheap).  When a collision
// occurs, append `__{wordId}` to keep files distinguishable.

const takenLocalNames = new Map<string, string>(); // basename → wordId

function resolveLocalPath(
  row: WordRow,
  variant: WordAudioVariant,
): string {
  const base = wordAudioLocalFilename(row.rank, row.lemma);
  // Composite key across both variants — collisions detected globally.
  const key = `${variant}:${base}`;
  const prior = takenLocalNames.get(key);
  if (prior && prior !== row.id) {
    const name = wordAudioLocalFilename(row.rank, row.lemma, row.id);
    return path.join(localDirForVariant(variant), name);
  }
  takenLocalNames.set(key, row.id);
  return path.join(localDirForVariant(variant), base);
}

// ── Per-variant processing ────────────────────────────────────

async function processVariant(
  row: WordRow,
  variant: WordAudioVariant,
  text: string | null,
  opts: Opts,
): Promise<VariantResult> {
  if (text == null || text.trim().length === 0) {
    return {
      storagePath: null,
      localPath: null,
      bytes: 0,
      status: "not-eligible",
    };
  }

  const storagePath = wordAudioStoragePath(row.id, variant);
  const localPath = opts.saveLocal ? resolveLocalPath(row, variant) : null;
  const dbColumnValue =
    variant === "lemma" ? row.lemma_audio_path : row.lemma_sentence_audio_path;

  if (opts.dryRun) {
    return { storagePath, localPath, bytes: 0, status: "skipped" };
  }

  try {
    let audioBytes: Buffer | null = null;

    // Skip synthesis if the DB path is set AND the storage object exists.
    const alreadyInStorage =
      !opts.force &&
      dbColumnValue === storagePath &&
      (await storageObjectExists(storagePath));

    if (!alreadyInStorage) {
      const { audioBytes: buf } = await synthesizeChirp({
        text,
        voiceName: VOICE,
      });
      audioBytes = buf;
      const { error: upErr } = await supabase.storage
        .from(LISTENING_AUDIO_BUCKET)
        .upload(storagePath, audioBytes, {
          contentType: "audio/mpeg",
          upsert: true,
        });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    }

    // Local mirror (optional).
    if (localPath) {
      const localExists = fs.existsSync(localPath);
      if (!localExists || opts.force) {
        if (!audioBytes) {
          // Pull from storage so we can mirror without re-synthesizing.
          const { data, error } = await supabase.storage
            .from(LISTENING_AUDIO_BUCKET)
            .download(storagePath);
          if (error || !data) {
            throw new Error(
              `Local mirror download failed: ${error?.message ?? "no data"}`,
            );
          }
          audioBytes = Buffer.from(await data.arrayBuffer());
        }
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, audioBytes);
      }
    }

    return {
      storagePath,
      localPath,
      bytes: audioBytes?.length ?? 0,
      status: alreadyInStorage && (!localPath || fs.existsSync(localPath))
        ? "skipped"
        : "ok",
    };
  } catch (err) {
    return {
      storagePath,
      localPath,
      bytes: 0,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Per-word processing ───────────────────────────────────────

async function processWord(row: WordRow, opts: Opts): Promise<WordResult> {
  const lemmaText = opts.type === "sentence" ? null : row.lemma;
  const sentenceText =
    opts.type === "lemma" ? null : canonicalWordSentence(row);

  // Parallel within a word — only 2 assets max.
  const [lemmaRes, sentRes] = await Promise.all([
    processVariant(row, "lemma", lemmaText, opts),
    processVariant(row, "lemma-sentence", sentenceText, opts),
  ]);

  // Persist DB paths on success.
  if (!opts.dryRun) {
    const update: Partial<WordRow> = {};
    if (lemmaRes.status === "ok" || lemmaRes.status === "skipped") {
      if (lemmaRes.storagePath) update.lemma_audio_path = lemmaRes.storagePath;
    }
    if (sentRes.status === "ok" || sentRes.status === "skipped") {
      if (sentRes.storagePath)
        update.lemma_sentence_audio_path = sentRes.storagePath;
    }
    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from("words")
        .update(update)
        .eq("id", row.id);
      if (error) {
        // Surface DB write failures through per-variant status.
        if (update.lemma_audio_path) {
          lemmaRes.status = "failed";
          lemmaRes.error = `DB update: ${error.message}`;
        }
        if (update.lemma_sentence_audio_path) {
          sentRes.status = "failed";
          sentRes.error = `DB update: ${error.message}`;
        }
      }
    }
  }

  return {
    wordId: row.id,
    rank: row.rank,
    lemma: row.lemma,
    lemma_audio: lemmaRes,
    lemma_sentence_audio: sentRes,
  };
}

// ── Concurrency pool ──────────────────────────────────────────

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
  onResult: (r: R, idx: number) => void,
) {
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      const r = await fn(items[idx]!, idx);
      onResult(r, idx);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}

// ── Manifest I/O ──────────────────────────────────────────────

type Manifest = {
  startedAt: string;
  finishedAt: string | null;
  voice: string;
  opts: Opts;
  totals: {
    words: number;
    lemmaEligible: number;
    sentenceEligible: number;
    lemmaOk: number;
    lemmaSkipped: number;
    lemmaFailed: number;
    sentenceOk: number;
    sentenceSkipped: number;
    sentenceFailed: number;
  };
  failures: Array<{
    wordId: string;
    rank: number;
    lemma: string;
    variant: WordAudioVariant;
    error: string;
  }>;
};

function writeManifest(m: Manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log("=== Word-audio corpus generator ===");
  console.log(`  Voice:       ${VOICE}`);
  console.log(`  Type:        ${opts.type}`);
  console.log(`  Concurrency: ${opts.concurrency}`);
  console.log(`  Save local:  ${opts.saveLocal}`);
  console.log(`  Only missing:${opts.onlyMissing}`);
  console.log(`  Force:       ${opts.force}`);
  console.log(`  Dry run:     ${opts.dryRun}`);
  console.log();

  if (!opts.dryRun) await ensureBucket();

  if (opts.saveLocal) {
    fs.mkdirSync(localDirForVariant("lemma"), { recursive: true });
    fs.mkdirSync(localDirForVariant("lemma-sentence"), { recursive: true });
  }

  console.log("Fetching eligible words...");
  const words = await fetchEligible(opts);
  console.log(`  ${words.length} words to process.\n`);

  const manifest: Manifest = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    voice: VOICE,
    opts,
    totals: {
      words: words.length,
      lemmaEligible: 0,
      sentenceEligible: 0,
      lemmaOk: 0,
      lemmaSkipped: 0,
      lemmaFailed: 0,
      sentenceOk: 0,
      sentenceSkipped: 0,
      sentenceFailed: 0,
    },
    failures: [],
  };

  let done = 0;
  let interrupted = false;
  process.on("SIGINT", () => {
    console.log("\n[SIGINT] Stopping after in-flight items...");
    interrupted = true;
  });

  const started = Date.now();
  await runPool(words, opts.concurrency, async (row) => {
    if (interrupted) {
      return {
        wordId: row.id,
        rank: row.rank,
        lemma: row.lemma,
        lemma_audio: {
          storagePath: null,
          localPath: null,
          bytes: 0,
          status: "skipped" as const,
        },
        lemma_sentence_audio: {
          storagePath: null,
          localPath: null,
          bytes: 0,
          status: "skipped" as const,
        },
      };
    }
    return processWord(row, opts);
  }, (r) => {
    done++;
    const l = r.lemma_audio;
    const s = r.lemma_sentence_audio;
    if (l.status !== "not-eligible") manifest.totals.lemmaEligible++;
    if (s.status !== "not-eligible") manifest.totals.sentenceEligible++;
    if (l.status === "ok") manifest.totals.lemmaOk++;
    if (l.status === "skipped") manifest.totals.lemmaSkipped++;
    if (l.status === "failed") {
      manifest.totals.lemmaFailed++;
      manifest.failures.push({
        wordId: r.wordId,
        rank: r.rank,
        lemma: r.lemma,
        variant: "lemma",
        error: l.error ?? "unknown",
      });
    }
    if (s.status === "ok") manifest.totals.sentenceOk++;
    if (s.status === "skipped") manifest.totals.sentenceSkipped++;
    if (s.status === "failed") {
      manifest.totals.sentenceFailed++;
      manifest.failures.push({
        wordId: r.wordId,
        rank: r.rank,
        lemma: r.lemma,
        variant: "lemma-sentence",
        error: s.error ?? "unknown",
      });
    }

    if (done % 25 === 0 || done === words.length || l.status === "failed" || s.status === "failed") {
      const elapsed = (Date.now() - started) / 1000;
      const rate = done / Math.max(elapsed, 0.001);
      const eta = (words.length - done) / Math.max(rate, 0.001);
      const pct = ((done / words.length) * 100).toFixed(1);
      const lemmaPart = `L:${manifest.totals.lemmaOk}/${manifest.totals.lemmaFailed}f/${manifest.totals.lemmaSkipped}s`;
      const sentPart = `S:${manifest.totals.sentenceOk}/${manifest.totals.sentenceFailed}f/${manifest.totals.sentenceSkipped}s`;
      console.log(
        `  [${done}/${words.length}] ${pct}%  ${lemmaPart}  ${sentPart}  rate=${rate.toFixed(2)}/s  eta=${Math.round(eta)}s  (last: ${r.rank}-${r.lemma})`,
      );
      // Persist manifest periodically so a crashed run leaves usable data.
      writeManifest(manifest);
    }
  });

  manifest.finishedAt = new Date().toISOString();
  writeManifest(manifest);

  console.log("\n=== Summary ===");
  console.log(`  Words processed:    ${done}/${words.length}`);
  console.log(`  Lemma ok:           ${manifest.totals.lemmaOk}`);
  console.log(`  Lemma skipped:      ${manifest.totals.lemmaSkipped}`);
  console.log(`  Lemma failed:       ${manifest.totals.lemmaFailed}`);
  console.log(`  Sentence ok:        ${manifest.totals.sentenceOk}`);
  console.log(`  Sentence skipped:   ${manifest.totals.sentenceSkipped}`);
  console.log(`  Sentence failed:    ${manifest.totals.sentenceFailed}`);
  console.log(`  Manifest:           ${MANIFEST_PATH}`);
  if (manifest.failures.length > 0) {
    console.log(
      `\n  Resume with:  npx tsx scripts/generate-word-audio.ts --only-missing`,
    );
  }
  if (interrupted) process.exit(130);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
