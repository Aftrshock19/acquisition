/**
 * Local-only TTS for the RL-CEFR onboarding passages.
 *
 * Reads components/onboarding/rl-cefr-listening-passages.csv and writes
 * one MP3 per clip_id into downloads/rl-cefr-listening-audio/.
 *
 * Nothing is uploaded; nothing touches the database.
 *
 * Usage:
 *   npx tsx scripts/generate-rl-cefr-listening-audio.ts
 *   npx tsx scripts/generate-rl-cefr-listening-audio.ts --dry-run
 *   npx tsx scripts/generate-rl-cefr-listening-audio.ts --clip-id rl_a_l_a1_anchor
 *   npx tsx scripts/generate-rl-cefr-listening-audio.ts --limit 3
 *   npx tsx scripts/generate-rl-cefr-listening-audio.ts --force        # overwrite existing MP3s
 */

import * as fs from "fs";
import * as path from "path";
import { synthesizeChirp } from "../lib/chirp/synthesize";

const VOICE = "es-ES-Chirp3-HD-Charon";
const CSV_PATH = path.resolve(
  __dirname,
  "..",
  "components",
  "onboarding",
  "rl-cefr-listening-passages.csv",
);
const OUT_DIR = path.resolve(
  __dirname,
  "..",
  "downloads",
  "rl-cefr-listening-audio",
);

type Row = {
  form: string;
  band: string;
  clipKind: string;
  clipId: string;
  transcript: string;
  questions: string;
};

// RFC 4180-ish CSV parser: handles quoted fields with embedded commas,
// newlines, and "" escapes. Returns string[][] including the header row.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0]!.length > 0));
}

function readRows(): Row[] {
  const text = fs.readFileSync(CSV_PATH, "utf-8");
  const all = parseCsv(text);
  const [header, ...data] = all;
  if (!header) throw new Error(`Empty CSV: ${CSV_PATH}`);
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV missing column: ${name}`);
    return i;
  };
  const iForm = idx("form");
  const iBand = idx("band");
  const iKind = idx("clip_kind");
  const iId = idx("clip_id");
  const iTr = idx("transcript");
  const iQ = idx("questions");
  return data.map((r) => ({
    form: r[iForm] ?? "",
    band: r[iBand] ?? "",
    clipKind: r[iKind] ?? "",
    clipId: (r[iId] ?? "").trim(),
    transcript: (r[iTr] ?? "").trim(),
    questions: r[iQ] ?? "",
  }));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: { dryRun: boolean; force: boolean; clipId?: string; limit?: number } = {
    dryRun: false,
    force: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--clip-id") opts.clipId = args[++i];
    else if (a === "--limit") opts.limit = parseInt(args[++i] ?? "0", 10);
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  console.log("=== RL-CEFR Listening TTS (local only) ===");
  console.log(`  Voice:   ${VOICE}`);
  console.log(`  Source:  ${CSV_PATH}`);
  console.log(`  Out dir: ${OUT_DIR}`);
  console.log(`  Dry run: ${opts.dryRun}`);
  console.log(`  Force:   ${opts.force}`);
  console.log();

  const rows = readRows();
  let tasks = rows.filter((r) => r.clipId && r.transcript);
  if (opts.clipId) tasks = tasks.filter((r) => r.clipId === opts.clipId);
  if (opts.limit && opts.limit > 0) tasks = tasks.slice(0, opts.limit);

  if (tasks.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (!opts.dryRun) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const r = tasks[i]!;
    const label = `[${i + 1}/${tasks.length}] ${r.clipId}`;
    const outPath = path.join(OUT_DIR, `${r.clipId}.mp3`);

    if (!opts.force && fs.existsSync(outPath)) {
      skipped++;
      console.log(`  ${label} — exists, skip`);
      continue;
    }

    if (opts.dryRun) {
      console.log(
        `  ${label} — would synth ${r.transcript.length} chars → ${outPath}`,
      );
      created++;
      continue;
    }

    process.stdout.write(`  ${label} ... `);
    try {
      const { audioBytes, requestCount } = await synthesizeChirp({
        text: r.transcript,
        voiceName: VOICE,
      });
      fs.writeFileSync(outPath, audioBytes);
      created++;
      const sizeKb = Math.round(audioBytes.length / 1024);
      const chunks = requestCount > 1 ? ` (${requestCount} chunks)` : "";
      console.log(`OK ${sizeKb}KB${chunks}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${r.clipId}: ${msg}`);
      console.log(`FAILED: ${msg}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  Total:   ${tasks.length}`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed:  ${failed}`);
  if (errors.length > 0) {
    console.log("\nErrors:");
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
