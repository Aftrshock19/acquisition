/**
 * Generate local MP3 files for every .txt in listening_passages/reformatted/
 * using Google Cloud Chirp HD Leda. Local-only: does not touch Supabase or DB.
 *
 * Layout:
 *   listening_passages/reformatted/{band}_{mode}_stage{N}_passage{M}.txt   (source)
 *   downloads/listening-audio/{band}_{mode}_stage{N}_passage{M}.mp3        (output)
 *
 * Each .txt is:
 *   ---Title---
 *   {body text}
 * Line 1 is skipped; body is synthesized.
 *
 * Usage:
 *   npx tsx scripts/generate-listening-audio-batch.ts --dry-run   # 1 file
 *   npx tsx scripts/generate-listening-audio-batch.ts             # all, default concurrency 3
 *   npx tsx scripts/generate-listening-audio-batch.ts --concurrency 2
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { synthesizeChirp } from "../lib/chirp/synthesize";

const SRC_DIR = path.resolve(__dirname, "..", "listening_passages", "reformatted");
const OUT_DIR = path.resolve(__dirname, "..", "downloads", "listening-audio");
const VOICE = "es-ES-Chirp3-HD-Leda";
const ADC_PATH = path.join(
  os.homedir(),
  ".config",
  "gcloud",
  "application_default_credentials.json",
);

function parseArgs() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const cIdx = argv.indexOf("--concurrency");
  const concurrency = cIdx >= 0 ? parseInt(argv[cIdx + 1] ?? "3", 10) : 3;
  return { dryRun, concurrency };
}

function checkCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
  if (fs.existsSync(ADC_PATH)) return;
  console.error(
    `FATAL: no Google Cloud credentials found.\n  Looked for GOOGLE_APPLICATION_CREDENTIALS env var and ${ADC_PATH}.\n  Run: gcloud auth application-default login`,
  );
  process.exit(1);
}

function readBody(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf-8");
  const nl = raw.indexOf("\n");
  if (nl === -1) return raw.trim();
  return raw.slice(nl + 1).trim();
}

type Task = { srcFile: string; outFile: string; tmpFile: string };

function buildTasks(): Task[] {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Source dir not found: ${SRC_DIR}`);
    process.exit(1);
  }
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".txt")).sort();
  return files.map((f) => {
    const base = f.slice(0, -4);
    return {
      srcFile: path.join(SRC_DIR, f),
      outFile: path.join(OUT_DIR, `${base}.mp3`),
      tmpFile: path.join(OUT_DIR, `.${base}.mp3.tmp`),
    };
  });
}

type Stats = {
  processed: number;
  generated: number;
  skipped: number;
  failed: Array<{ file: string; error: string }>;
  totalBytes: number;
};
const stats: Stats = {
  processed: 0,
  generated: 0,
  skipped: 0,
  failed: [],
  totalBytes: 0,
};

async function processOne(task: Task): Promise<void> {
  const name = path.basename(task.srcFile);
  try {
    if (fs.existsSync(task.outFile)) {
      stats.skipped++;
      stats.processed++;
      console.log(`  [skip] ${name} — mp3 exists`);
      return;
    }
    const body = readBody(task.srcFile);
    if (!body) {
      stats.failed.push({ file: name, error: "empty body" });
      stats.processed++;
      return;
    }
    const { audioBytes, requestCount } = await synthesizeChirp({
      text: body,
      voiceName: VOICE,
    });
    fs.writeFileSync(task.tmpFile, audioBytes);
    fs.renameSync(task.tmpFile, task.outFile);
    stats.generated++;
    stats.processed++;
    stats.totalBytes += audioBytes.length;
    console.log(
      `  [ok]   ${name} — ${audioBytes.length} bytes, ${requestCount} TTS chunk${requestCount > 1 ? "s" : ""}`,
    );
  } catch (err: any) {
    stats.failed.push({ file: name, error: err?.message ?? String(err) });
    stats.processed++;
    try {
      if (fs.existsSync(task.tmpFile)) fs.unlinkSync(task.tmpFile);
    } catch {}
    console.error(`  [fail] ${name} — ${err?.message ?? err}`);
  }
}

async function runPool<T>(items: T[], limit: number, worker: (t: T) => Promise<void>) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i]!);
    }
  });
  await Promise.all(runners);
}

function humanize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const { dryRun, concurrency } = parseArgs();
  checkCredentials();

  const tasks = buildTasks();
  console.log(`Source: ${SRC_DIR}`);
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Voice:  ${VOICE}`);
  console.log(`Total source .txt files: ${tasks.length}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Mode: ${dryRun ? "DRY RUN (1 file)" : "LIVE"}`);
  console.log();

  const targets = dryRun ? tasks.slice(0, 1) : tasks;

  const started = Date.now();
  await runPool(targets, dryRun ? 1 : concurrency, processOne);
  const elapsedSec = (Date.now() - started) / 1000;

  // Approx duration: bitrate 32 kbps => bytes * 8 / 32_000 seconds
  const approxAudioSec = stats.totalBytes ? (stats.totalBytes * 8) / 32_000 : 0;

  console.log("\n=== Summary ===");
  console.log(`Files processed:   ${stats.processed}`);
  console.log(`MP3s generated:    ${stats.generated}`);
  console.log(`Skipped (existed): ${stats.skipped}`);
  console.log(`Failed:            ${stats.failed.length}`);
  console.log(`Total audio bytes: ${humanize(stats.totalBytes)}`);
  console.log(
    `Approx audio duration: ${Math.round(approxAudioSec)} s (${(approxAudioSec / 60).toFixed(1)} min, at 32 kbps)`,
  );
  console.log(`Wall time: ${elapsedSec.toFixed(1)} s`);
  if (stats.failed.length > 0) {
    console.log("\nFailures:");
    for (const f of stats.failed) console.log(`  - ${f.file}: ${f.error}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
