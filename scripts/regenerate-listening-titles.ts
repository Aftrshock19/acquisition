/**
 * Regenerate titles for orphan listening DB rows (rows without matching .txt).
 *
 * Flow:
 *   1. Fetch all listening rows.
 *   2. Filter out those with a matching .txt at listening_passages/passages/.
 *   3. Remaining = orphans (expected: 109).
 *   4. For each orphan, call Haiku with the passage content → propose a new
 *      Spanish title. Validate. Retry once at higher temp if invalid.
 *   5. Update DB in batches of 10.
 *
 * Usage:
 *   npx tsx scripts/regenerate-listening-titles.ts --dry-run   # 3 random orphans, no writes
 *   npx tsx scripts/regenerate-listening-titles.ts             # full run
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";

config({ path: path.resolve(__dirname, "..", ".env.local") });
config({ path: path.resolve(__dirname, "..", ".env") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY!;
if (!supabaseUrl || !supabaseKey || !anthropicKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anthropic = new Anthropic({ apiKey: anthropicKey });

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 50;
const CONCURRENCY = 5;
const BATCH_WRITE_SIZE = 10;

const TXT_DIR = path.resolve(__dirname, "..", "listening_passages", "passages");

const SYSTEM_PROMPT = `You generate short, specific Spanish titles for Spanish listening comprehension passages in a language-learning app. Given a Spanish passage, generate one title that:
- Is 2 to 5 words, in Spanish
- Is specific and evocative, describing what the passage is about
- Does not use quotation marks or punctuation at the end
- Matches the content of the passage accurately
- Avoids generic titles like 'Una historia' or 'Un día'

Respond with ONLY the title. Nothing else.`;

/**
 * Build the set of (stage_index, mode, passage_number) keys covered by the
 * .txt files on disk. Parses filenames directly (band prefix is ignored)
 * so that files with incorrectly-prefixed band names still count as matches.
 */
function scanTxtKeys(): Set<string> {
  const keys = new Set<string>();
  for (const f of fs.readdirSync(TXT_DIR)) {
    if (!f.endsWith(".txt")) continue;
    const base = f.slice(0, -4);
    const parts = base.split("_");
    const stageIdx = parts.findIndex((p) => p.startsWith("stage"));
    const passageIdx = parts.findIndex((p) => p.startsWith("passage"));
    if (stageIdx < 0 || passageIdx < 0) continue;
    const stage = parseInt(parts[stageIdx]!.replace("stage", ""), 10);
    const passage = parseInt(parts[passageIdx]!.replace("passage", ""), 10);
    const mode = parts.slice(1, stageIdx).join("_");
    keys.add(`${stage}|${mode}|${passage}`);
  }
  return keys;
}

type OrphanRow = {
  id: string;
  stage_index: number;
  passage_mode: string;
  passage_number: number;
  title: string;
  content: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const GENERIC_ARTICLES = new Set([
  "un",
  "una",
  "el",
  "la",
  "los",
  "las",
  "lo",
]);
const GENERIC_NOUNS = new Set([
  "dia",
  "día",
  "historia",
  "momento",
  "tarde",
  "noche",
  "mañana",
  "cuento",
  "relato",
  "escena",
]);

function validateTitle(raw: string): { ok: true; title: string } | { ok: false; reason: string } {
  const title = raw.trim().replace(/^[\s"'«»“”‘’`]+|[\s"'«»“”‘’`]+$/g, "").trim();
  if (!title) return { ok: false, reason: "empty" };
  if (title.length > 50) return { ok: false, reason: `length ${title.length} > 50` };
  if (/["'«»“”‘’`]/.test(title[0]!)) return { ok: false, reason: "starts with quote" };
  if (/[.!?]$/.test(title)) return { ok: false, reason: "ends with punctuation" };
  const words = title.split(/\s+/);
  if (words.length === 2) {
    const a = words[0]!.toLowerCase();
    const b = words[1]!.toLowerCase();
    if (GENERIC_ARTICLES.has(a) && GENERIC_NOUNS.has(b)) {
      return { ok: false, reason: `generic "${a} ${b}"` };
    }
  }
  return { ok: true, title };
}

async function callHaiku(content: string, temperature: number): Promise<string> {
  const QUOTA_BACKOFF = [5_000, 10_000, 20_000, 40_000, 80_000];
  let quotaAttempt = 0;
  for (;;) {
    try {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      });
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      if (!text) throw new Error("empty response");
      return text;
    } catch (err: any) {
      const status = err?.status ?? err?.statusCode;
      const retriable =
        status === 429 || status === 529 || (status >= 500 && status < 600);
      if (retriable && quotaAttempt < QUOTA_BACKOFF.length) {
        const wait = QUOTA_BACKOFF[quotaAttempt]! + Math.random() * 1000;
        quotaAttempt++;
        stats.rateLimitRetries++;
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

type Stats = {
  processed: number;
  regenerated: number;
  unchanged: number;
  rejected: number;
  rateLimitRetries: number;
  dbUpdateErrors: number;
  rejectionReasons: string[];
};
const stats: Stats = {
  processed: 0,
  regenerated: 0,
  unchanged: 0,
  rejected: 0,
  rateLimitRetries: 0,
  dbUpdateErrors: 0,
  rejectionReasons: [],
};

type Proposed = { row: OrphanRow; oldTitle: string; newTitle: string; kept: boolean };

async function proposeTitleForRow(row: OrphanRow): Promise<Proposed> {
  const oldTitle = row.title;
  let attempt1Raw: string;
  try {
    attempt1Raw = await callHaiku(row.content, 0.7);
  } catch (err: any) {
    stats.rejected++;
    stats.rejectionReasons.push(
      `stage${row.stage_index} ${row.passage_mode} #${row.passage_number}: api err ${err?.message ?? err}`,
    );
    return { row, oldTitle, newTitle: oldTitle, kept: true };
  }
  const v1 = validateTitle(attempt1Raw);
  if (v1.ok) {
    return {
      row,
      oldTitle,
      newTitle: v1.title,
      kept: v1.title === oldTitle,
    };
  }

  // Retry once at higher temp
  let attempt2Raw: string;
  try {
    attempt2Raw = await callHaiku(row.content, 0.9);
  } catch (err: any) {
    stats.rejected++;
    stats.rejectionReasons.push(
      `stage${row.stage_index} ${row.passage_mode} #${row.passage_number}: retry api err ${err?.message ?? err}`,
    );
    return { row, oldTitle, newTitle: oldTitle, kept: true };
  }
  const v2 = validateTitle(attempt2Raw);
  if (v2.ok) {
    return {
      row,
      oldTitle,
      newTitle: v2.title,
      kept: v2.title === oldTitle,
    };
  }

  stats.rejected++;
  stats.rejectionReasons.push(
    `stage${row.stage_index} ${row.passage_mode} #${row.passage_number}: "${attempt1Raw}" (${v1.reason}) then "${attempt2Raw}" (${v2.reason})`,
  );
  return { row, oldTitle, newTitle: oldTitle, kept: true };
}

async function writeBatch(proposed: Proposed[]): Promise<void> {
  const toWrite = proposed.filter((p) => !p.kept && p.newTitle !== p.oldTitle);
  for (const p of toWrite) {
    const { error } = await supabase
      .from("texts")
      .update({ title: p.newTitle })
      .eq("id", p.row.id);
    if (error) {
      stats.dbUpdateErrors++;
      console.error(`  DB update failed for ${p.row.id}:`, error.message);
      continue;
    }
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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);

  const { data, error } = await supabase
    .from("texts")
    .select("id, stage_index, passage_mode, passage_number, title, content")
    .ilike("stage", "listening_%")
    .order("stage_index")
    .order("passage_mode")
    .order("passage_number");
  if (error || !data) {
    console.error("Failed to fetch listening rows:", error);
    process.exit(1);
  }
  console.log(`Fetched ${data.length} listening rows.`);

  const txtKeys = scanTxtKeys();
  const orphans: OrphanRow[] = [];
  for (const r of data) {
    const key = `${r.stage_index}|${r.passage_mode}|${r.passage_number}`;
    if (!txtKeys.has(key)) orphans.push(r as OrphanRow);
  }
  console.log(`Orphan rows (no matching .txt): ${orphans.length}`);

  if (orphans.length < 100 || orphans.length > 120) {
    console.error(
      `HALT: orphan count ${orphans.length} outside [100, 120]. Aborting.`,
    );
    process.exit(1);
  }

  let targets = orphans;
  if (dryRun) {
    const pool = [...orphans];
    const picks: OrphanRow[] = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
      const pick = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!;
      picks.push(pick);
    }
    targets = picks;
    console.log("DRY RUN — proposing titles for 3 random orphans:");
  }

  const proposals: Proposed[] = [];
  let sinceLastWrite: Proposed[] = [];

  await runPool(targets, dryRun ? 3 : CONCURRENCY, async (row) => {
    const p = await proposeTitleForRow(row);
    stats.processed++;
    if (p.kept) stats.unchanged++;
    else stats.regenerated++;

    proposals.push(p);
    sinceLastWrite.push(p);

    console.log(
      `  stage_${p.row.stage_index} ${p.row.passage_mode} #${p.row.passage_number}: ${JSON.stringify(p.oldTitle)} → ${JSON.stringify(p.newTitle)}${p.kept ? " [kept]" : ""}`,
    );

    if (!dryRun && sinceLastWrite.length >= BATCH_WRITE_SIZE) {
      const flush = sinceLastWrite;
      sinceLastWrite = [];
      await writeBatch(flush);
    }
  });

  if (!dryRun && sinceLastWrite.length > 0) {
    await writeBatch(sinceLastWrite);
  }

  console.log("\n=== Summary ===");
  console.log(`Processed:          ${stats.processed}`);
  console.log(`Regenerated (new):  ${stats.regenerated}`);
  console.log(`Unchanged / kept:   ${stats.unchanged}`);
  console.log(`Rejections:         ${stats.rejected}`);
  console.log(`Rate-limit retries: ${stats.rateLimitRetries}`);
  console.log(`DB update errors:   ${stats.dbUpdateErrors}`);
  if (stats.rejectionReasons.length > 0) {
    console.log("\nRejection reasons:");
    for (const r of stats.rejectionReasons) console.log(`  - ${r}`);
  }

  if (!dryRun && proposals.length > 0) {
    console.log("\nSample 5 random new titles:");
    const pool = proposals.filter((p) => !p.kept);
    const picks: Proposed[] = [];
    for (let i = 0; i < 5 && pool.length > 0; i++) {
      const pick = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!;
      picks.push(pick);
    }
    for (const p of picks) {
      console.log(
        `  stage_${p.row.stage_index} ${p.row.passage_mode} #${p.row.passage_number}`,
      );
      console.log(`    old: ${JSON.stringify(p.oldTitle)}`);
      console.log(`    new: ${JSON.stringify(p.newTitle)}`);
      console.log(`    body: ${p.row.content.slice(0, 80).replace(/\n/g, " ")}...`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
