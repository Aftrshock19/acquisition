/**
 * Parity test for daily_sessions.stage between live database, app code and
 * the most recent migration on disk.
 *
 * Runtime context (production incident on 2026-04-28): the app TS code wrote
 * stage='completed' while the DB function record_review wrote 'complete' and
 * a rogue CHECK constraint named daily_sessions_completed_stage_check
 * rejected one of the two literals. This file enforces the post-fix
 * invariants so the drift can't return silently:
 *
 *   1. The latest stage CHECK migration allows exactly the canonical four
 *      values (with 'completed', NOT 'complete').
 *   2. The DailySessionRow["stage"] union matches that allowlist.
 *   3. The fix-drift migration backfills 'complete' → 'completed' AND
 *      drops both the rogue and the legacy stage check.
 *   4. No remaining migration installs a stage CHECK that contains the
 *      legacy 'complete' literal.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = resolve(__dirname, "../../supabase/migrations");
const FIX_DRIFT_FILE = "20260428130000_fix_daily_sessions_stage_drift.sql";

function readFixDriftMigration(): string {
  return readFileSync(resolve(MIGRATIONS_DIR, FIX_DRIFT_FILE), "utf8");
}

function readAllMigrations(): { name: string; body: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      body: readFileSync(resolve(MIGRATIONS_DIR, name), "utf8"),
    }));
}

describe("daily_sessions stage canonical values", () => {
  it("fix-drift migration exists", () => {
    expect(() => readFixDriftMigration()).not.toThrow();
  });

  it("fix-drift migration drops both CHECKs so they can be recreated", () => {
    const sql = readFixDriftMigration();
    expect(sql).toMatch(
      /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+daily_sessions_completed_stage_check/i,
    );
    expect(sql).toMatch(
      /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+daily_sessions_stage_check/i,
    );
  });

  it("fix-drift migration installs the canonical stage CHECK including 'not_started'", () => {
    const sql = readFixDriftMigration();
    // Live constraint allows: not_started, flashcards, reading, listening, completed.
    expect(sql).toMatch(
      /ADD\s+CONSTRAINT\s+daily_sessions_stage_check[\s\S]*?CHECK\s*\(\s*stage\s+IN\s*\(\s*'not_started'\s*,\s*'flashcards'\s*,\s*'reading'\s*,\s*'listening'\s*,\s*'completed'\s*\)\s*\)/i,
    );
  });

  it("fix-drift migration codifies the completed_stage_check invariant", () => {
    const sql = readFixDriftMigration();
    // Invariant: completed=true implies stage='completed'.
    expect(sql).toMatch(
      /ADD\s+CONSTRAINT\s+daily_sessions_completed_stage_check[\s\S]*?CHECK\s*\(\s*\(\s*completed\s*=\s*false\s*\)\s+OR\s+\(\s*stage\s*=\s*'completed'\s*\)\s*\)/i,
    );
  });

  it("fix-drift migration backfills any historical 'complete' rows to 'completed'", () => {
    const sql = readFixDriftMigration();
    expect(sql).toMatch(
      /UPDATE\s+public\.daily_sessions[\s\S]*?SET\s+stage\s*=\s*'completed'[\s\S]*?WHERE\s+stage\s*=\s*'complete'/i,
    );
  });

  it("fix-drift migration recreates the active 18-param record_review with 'completed' terminal stage", () => {
    const sql = readFixDriftMigration();
    // Strip line comments so doc text mentioning "ELSE 'complete'" doesn't
    // confuse the literal scan.
    const sqlNoComments = sql.replace(/--[^\n]*\n/g, "\n");

    expect(sqlNoComments).toContain(
      "CREATE OR REPLACE FUNCTION public.record_review(",
    );
    // The active 18-param overload must be present (use a distinctive
    // signature marker that only appears on this overload).
    expect(sqlNoComments).toMatch(
      /p_scheduler_variant\s+text\s+DEFAULT\s+'baseline'/,
    );
    // Canonical literal must be present in the new body.
    expect(sqlNoComments).toContain("ELSE 'completed'");
    expect(sqlNoComments).toContain("(v_session_stage = 'completed')");
    // The new body must NOT contain the legacy literal as a stage value.
    // Strip 'completed' tokens so we can grep for an isolated 'complete'.
    // The DO-block dynamic patch search/replace strings DO contain
    // `ELSE 'complete'` and `(v_session_stage = 'complete')` literally —
    // those are inputs to PostgreSQL's `replace()`. Strip the surrounding
    // dollar-quoted wrappers (`$lit$...$lit$`) before checking the body.
    const sqlNoDollarQuotes = sqlNoComments.replace(
      /\$lit\$[^$]*\$lit\$/g,
      "''",
    );
    const stripped = sqlNoDollarQuotes.replace(/'completed'/g, "'__OK__'");
    expect(stripped).not.toMatch(/ELSE\s+'complete'/);
    expect(stripped).not.toMatch(/v_session_stage\s*=\s*'complete'/);
  });

  it("fix-drift migration patches surviving record_review overloads in pg_proc", () => {
    // The migration must contain a defensive DO block that loops over every
    // public.record_review overload via pg_proc and rewrites the legacy
    // 'complete' literal in any that still hold it. We do NOT drop legacy
    // overloads during the live study.
    const sql = readFixDriftMigration();
    expect(sql).toMatch(/FROM\s+pg_proc\s+p[\s\S]*?WHERE[\s\S]*?p\.proname\s*=\s*'record_review'/i);
    expect(sql).toMatch(/pg_get_functiondef\s*\(\s*v_proc\.oid\s*\)/i);
    expect(sql).toMatch(/replace\s*\(/i);
  });

  it("no migration *after* the fix-drift migration re-introduces a stage CHECK with 'complete'", () => {
    const migrations = readAllMigrations();
    const fixIndex = migrations.findIndex((m) => m.name === FIX_DRIFT_FILE);
    expect(fixIndex).toBeGreaterThanOrEqual(0);
    const laterMigrations = migrations.slice(fixIndex + 1);

    const offenders: string[] = [];
    for (const { name, body } of laterMigrations) {
      const stageCheckMatches = body.match(
        /CHECK\s*\(\s*stage\s+IN\s*\([^)]*\)\s*\)/gi,
      );
      if (!stageCheckMatches) continue;
      for (const expr of stageCheckMatches) {
        // The legacy literal is 'complete' specifically; 'completed' is fine.
        // Replace 'completed' with a placeholder to test for an isolated
        // 'complete'.
        const stripped = expr.replace(/'completed'/g, "'__OK__'");
        if (/'complete'/.test(stripped)) {
          offenders.push(`${name}: ${expr}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("DailySessionRow.stage TS union matches the canonical list", () => {
  it("includes exactly the four canonical stage values", () => {
    const tsTypeFile = readFileSync(
      resolve(__dirname, "./types.ts"),
      "utf8",
    );
    expect(tsTypeFile).toMatch(
      /stage\s*:\s*"flashcards"\s*\|\s*"reading"\s*\|\s*"listening"\s*\|\s*"completed"/,
    );
    // Defence: the TS union must NOT include the legacy 'complete' literal.
    expect(tsTypeFile).not.toMatch(/stage[^"]*"complete"\s*[|;]/);
  });
});
