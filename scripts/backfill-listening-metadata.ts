#!/usr/bin/env npx tsx
/**
 * Backfill listening text and audio titles with real human titles,
 * and populate topic from paired JSON metadata.
 *
 * Idempotent: only updates rows with generic/missing titles or missing topics.
 *
 * Usage:
 *   npx tsx scripts/backfill-listening-metadata.ts [--dry-run]
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import * as path from "node:path";
import {
  getPassageMetadata,
  isGenericTitle,
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

const LISTENING_PASSAGES_DIR = path.resolve(__dirname, "..", "listening_passages");
const JSON_METADATA_DIR = path.resolve(__dirname, "..", "all_passages_renamed");

const dryRun = process.argv.includes("--dry-run");

type TextRow = {
  id: string;
  title: string;
  topic: string | null;
  difficulty_cefr: string;
  stage: string;
  passage_mode: string;
  passage_number: number;
};

type AudioRow = {
  id: string;
  text_id: string;
  title: string;
};

async function main() {
  console.log(dryRun ? "=== DRY RUN ===" : "=== BACKFILL ===");
  console.log();

  // 1. Fetch all listening texts
  const { data: texts, error: textsErr } = await supabase
    .from("texts")
    .select("id, title, topic, difficulty_cefr, stage, passage_mode, passage_number")
    .ilike("stage", "listening_%")
    .order("stage")
    .order("passage_mode")
    .order("passage_number");

  if (textsErr) {
    console.error("Error fetching texts:", textsErr.message);
    process.exit(1);
  }

  // 2. Fetch all audio rows for listening texts (batched to avoid URL length limits)
  const textIds = (texts ?? []).map((t: TextRow) => t.id);
  const audioRows: AudioRow[] = [];
  const AUDIO_BATCH = 100;
  for (let i = 0; i < textIds.length; i += AUDIO_BATCH) {
    const batch = textIds.slice(i, i + AUDIO_BATCH);
    const { data, error: audioErr } = await supabase
      .from("audio")
      .select("id, text_id, title")
      .in("text_id", batch);
    if (audioErr) {
      console.error("Error fetching audio batch:", audioErr.message);
      continue;
    }
    audioRows.push(...((data ?? []) as AudioRow[]));
  }

  // Index audio by text_id
  const audioByTextId = new Map<string, AudioRow[]>();
  for (const row of (audioRows ?? []) as AudioRow[]) {
    const existing = audioByTextId.get(row.text_id) ?? [];
    existing.push(row);
    audioByTextId.set(row.text_id, existing);
  }

  // 3. Process each text
  const stats = {
    totalTexts: 0,
    textsUpdated: 0,
    textsTitleUpdated: 0,
    textsTopicUpdated: 0,
    textsSkippedGoodTitle: 0,
    textsSkippedGoodTopic: 0,
    textsSkippedNoSource: 0,
    textsSkippedNoTitle: 0,
    textsSkippedNoTopic: 0,
    totalAudio: 0,
    audioUpdated: 0,
    audioSkippedGoodTitle: 0,
  };

  for (const text of (texts ?? []) as TextRow[]) {
    stats.totalTexts++;

    // Parse stage number from "listening_stage_3"
    const stageMatch = text.stage.match(/listening_stage_(\d+)/);
    if (!stageMatch) {
      stats.textsSkippedNoSource++;
      continue;
    }
    const stageNum = parseInt(stageMatch[1]!, 10);

    const meta = getPassageMetadata(
      LISTENING_PASSAGES_DIR,
      JSON_METADATA_DIR,
      text.difficulty_cefr,
      text.passage_mode,
      stageNum,
      text.passage_number,
    );

    // Determine what needs updating on the text row
    const textUpdates: Record<string, string> = {};

    // Title: update if current is generic and we have a real one
    const needsTitleUpdate = isGenericTitle(text.title) || !text.title;
    if (needsTitleUpdate && meta.humanTitle) {
      textUpdates.title = meta.humanTitle;
      stats.textsTitleUpdated++;
    } else if (needsTitleUpdate && !meta.humanTitle) {
      stats.textsSkippedNoTitle++;
    } else {
      stats.textsSkippedGoodTitle++;
    }

    // Topic: update if missing/null and we have one
    const needsTopicUpdate = !text.topic || text.topic.trim() === "";
    if (needsTopicUpdate && meta.topic) {
      textUpdates.topic = meta.topic;
      stats.textsTopicUpdated++;
    } else if (needsTopicUpdate && !meta.topic) {
      stats.textsSkippedNoTopic++;
    } else {
      stats.textsSkippedGoodTopic++;
    }

    // Apply text updates
    if (Object.keys(textUpdates).length > 0) {
      stats.textsUpdated++;
      if (!dryRun) {
        const { error } = await supabase
          .from("texts")
          .update(textUpdates)
          .eq("id", text.id);
        if (error) {
          console.error(`  Error updating text ${text.id}:`, error.message);
        }
      } else {
        console.log(`  [text] ${text.id}: ${JSON.stringify(textUpdates)}`);
      }
    }

    // Now update audio rows for this text
    const audioForText = audioByTextId.get(text.id) ?? [];
    for (const audio of audioForText) {
      stats.totalAudio++;

      const audioNeedsTitle = isGenericTitle(audio.title) || !audio.title;
      if (audioNeedsTitle && meta.humanTitle) {
        stats.audioUpdated++;
        if (!dryRun) {
          const { error } = await supabase
            .from("audio")
            .update({ title: meta.humanTitle })
            .eq("id", audio.id);
          if (error) {
            console.error(`  Error updating audio ${audio.id}:`, error.message);
          }
        } else {
          console.log(`  [audio] ${audio.id}: title="${meta.humanTitle}"`);
        }
      } else {
        stats.audioSkippedGoodTitle++;
      }
    }
  }

  // 4. Report
  console.log();
  console.log("=== Report ===");
  console.log(`  Texts checked:              ${stats.totalTexts}`);
  console.log(`  Texts updated:              ${stats.textsUpdated}`);
  console.log(`    - title updated:          ${stats.textsTitleUpdated}`);
  console.log(`    - topic updated:          ${stats.textsTopicUpdated}`);
  console.log(`  Texts skipped (good title): ${stats.textsSkippedGoodTitle}`);
  console.log(`  Texts skipped (good topic): ${stats.textsSkippedGoodTopic}`);
  console.log(`  Texts skipped (no source):  ${stats.textsSkippedNoSource}`);
  console.log(`  Texts skipped (no title):   ${stats.textsSkippedNoTitle}`);
  console.log(`  Texts skipped (no topic):   ${stats.textsSkippedNoTopic}`);
  console.log();
  console.log(`  Audio checked:              ${stats.totalAudio}`);
  console.log(`  Audio updated:              ${stats.audioUpdated}`);
  console.log(`  Audio skipped (good title): ${stats.audioSkippedGoodTitle}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
