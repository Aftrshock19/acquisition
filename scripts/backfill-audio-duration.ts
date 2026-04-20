#!/usr/bin/env npx tsx
/**
 * Backfill public.audio.duration_seconds for every ready row where it's null.
 *
 * Fetches each audio file from the public listening-audio bucket and parses the
 * MP3 header with music-metadata to read duration. No auth needed — bucket is
 * public. music-metadata.parseStream reads just enough bytes to resolve the
 * header in most cases; actual bytes-read is logged at summary time.
 *
 * Usage:
 *   npx tsx scripts/backfill-audio-duration.ts [--dry-run] [--limit N]
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import * as path from "node:path";
import { Readable } from "node:stream";

type ParseStream = typeof import("music-metadata").parseStream;

config({ path: path.resolve(__dirname, "..", ".env.local") });
config({ path: path.resolve(__dirname, "..", ".env") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const dryRun = process.argv.includes("--dry-run");
const limitIdx = process.argv.indexOf("--limit");
const limit =
  limitIdx !== -1 && process.argv[limitIdx + 1]
    ? Number.parseInt(process.argv[limitIdx + 1]!, 10)
    : null;
const CONCURRENCY = 8;

type Row = { id: string; url: string };

async function fetchDuration(
  url: string,
  parseStream: ParseStream,
): Promise<{ seconds: number; bytes: number }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  if (!response.body) {
    throw new Error(`No body from ${url}`);
  }

  // Count bytes as they pass through so we can report bandwidth.
  let bytes = 0;
  const reader = response.body.getReader();
  const counted = new Readable({
    async read() {
      try {
        const { value, done } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
        bytes += value.byteLength;
        this.push(Buffer.from(value));
      } catch (err) {
        this.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });

  const metadata = await parseStream(counted, { mimeType: "audio/mpeg" }, {
    duration: true,
    skipCovers: true,
  });
  const seconds = metadata.format.duration ?? 0;
  if (!seconds) {
    throw new Error("music-metadata returned no duration");
  }
  return { seconds, bytes };
}

async function runPool<T>(
  items: T[],
  poolSize: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let idx = 0;
  const runners = Array.from(
    { length: Math.min(poolSize, items.length) },
    async () => {
      while (idx < items.length) {
        const i = idx++;
        await worker(items[i]!, i);
      }
    },
  );
  await Promise.all(runners);
}

async function main() {
  let query = supabase
    .from("audio")
    .select("id, url")
    .eq("status", "ready")
    .is("duration_seconds", null)
    .order("created_at", { ascending: true });
  if (limit != null) query = query.limit(limit);

  const { data, error } = await query;
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  console.log(
    `[backfill] ${rows.length} row(s) to process${dryRun ? " (dry-run, no writes)" : ""}`,
  );
  if (rows.length === 0) return;

  // music-metadata v11 is ESM-only — dynamic import so tsx/CJS doesn't choke.
  // Resolved once, reused for every row.
  const { parseStream } = await import("music-metadata");

  let succeeded = 0;
  let failed = 0;
  let totalBytes = 0;
  const startedAt = Date.now();

  await runPool(rows, CONCURRENCY, async (row, i) => {
    try {
      const { seconds, bytes } = await fetchDuration(row.url, parseStream);
      totalBytes += bytes;
      const rounded = Math.round(seconds);
      if (!dryRun) {
        const { error: updateError } = await supabase
          .from("audio")
          .update({ duration_seconds: rounded })
          .eq("id", row.id);
        if (updateError) throw new Error(`UPDATE failed: ${updateError.message}`);
      }
      succeeded++;
      if ((i + 1) % 50 === 0 || i + 1 === rows.length) {
        console.log(
          `[backfill] ${i + 1}/${rows.length} done (ok=${succeeded} fail=${failed} bytes=${totalBytes})`,
        );
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[backfill-err] id=${row.id.slice(0, 8)} ${msg}`);
    }
  });

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[backfill] done: ok=${succeeded} fail=${failed} bytes=${totalBytes} elapsed=${Math.round(
      elapsedMs / 1000,
    )}s`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
