#!/usr/bin/env npx tsx
/**
 * Download all ready audio assets from Supabase Storage to local disk.
 * Files are named by their passage identity: {cefr}_{mode}_stage{N}_passage{N}.mp3
 * Usage: npx tsx scripts/download-all-audio.ts [--out DIR]
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const outFlag = process.argv.indexOf("--out");
const OUT_DIR =
  outFlag !== -1 && process.argv[outFlag + 1]
    ? process.argv[outFlag + 1]
    : "downloads/listening-audio";

const CONCURRENCY = 10;

interface Asset {
  url: string;
  storage_path: string;
  texts: {
    difficulty_cefr: string;
    stage: string;
    passage_mode: string;
    passage_number: number;
  };
}

function buildFilename(asset: Asset): string {
  const t = asset.texts;
  const cefr = (t.difficulty_cefr || "unknown").toLowerCase();
  const mode = (t.passage_mode || "unknown").replace(/_/g, "_");
  // stage is like "listening_stage_3" → extract the number
  const stageNum = t.stage.replace(/^listening_stage_/, "");
  return `${cefr}_${mode}_stage${stageNum}_passage${t.passage_number}.mp3`;
}

async function fetchAllAssets(): Promise<Asset[]> {
  const all: Asset[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await sb
      .from("audio")
      .select("url, storage_path, texts(difficulty_cefr, stage, passage_mode, passage_number)")
      .eq("status", "ready")
      .order("storage_path")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as Asset[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function downloadOne(
  asset: Asset,
  filename: string,
  idx: number,
  total: number
): Promise<boolean> {
  const localPath = path.join(OUT_DIR, filename);
  if (fs.existsSync(localPath)) {
    return true; // already downloaded
  }
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  try {
    const res = await fetch(asset.url);
    if (!res.ok) {
      console.error(`  [${idx + 1}/${total}] FAIL ${filename}: ${res.status}`);
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(localPath, buf);
    if ((idx + 1) % 50 === 0 || idx + 1 === total) {
      console.log(`  [${idx + 1}/${total}] downloaded`);
    }
    return true;
  } catch (err: any) {
    console.error(`  [${idx + 1}/${total}] ERROR ${filename}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log(`Fetching asset list...`);
  const assets = await fetchAllAssets();
  console.log(`Found ${assets.length} ready assets. Downloading to ${OUT_DIR}/`);

  let ok = 0;
  let fail = 0;
  let skipped = 0;

  for (let i = 0; i < assets.length; i += CONCURRENCY) {
    const batch = assets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((asset, j) => {
        const filename = buildFilename(asset);
        const localPath = path.join(OUT_DIR, filename);
        if (fs.existsSync(localPath)) {
          skipped++;
          return Promise.resolve(true);
        }
        return downloadOne(asset, filename, i + j, assets.length);
      })
    );
    for (const r of results) {
      if (r) ok++;
      else fail++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Downloaded: ${ok - skipped}`);
  console.log(`  Skipped (already existed): ${skipped}`);
  console.log(`  Failed: ${fail}`);
  console.log(`  Location: ${path.resolve(OUT_DIR)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
