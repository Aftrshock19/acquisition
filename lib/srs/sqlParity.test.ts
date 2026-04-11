/**
 * SQL ↔ TS parity test.
 *
 * The Postgres `record_review` RPC is the ONLY authoritative scheduler at
 * runtime.  The TypeScript reference implementation in scheduler.ts exists
 * for tests and documentation.  If the two diverge, scheduling bugs happen
 * silently at runtime while tests stay green.
 *
 * This test reads the authoritative SQL migration file and extracts key
 * numeric constants via regex, then asserts they match the TS exports.
 * It catches real drift — e.g., someone updates a difficulty delta in SQL
 * but forgets to update the TS reference.
 *
 * NOT a full SQL execution test (no Docker/Supabase needed).
 * It IS a meaningful structural guardrail against the most common drift
 * pattern: constant mismatches.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  MAX_STABILITY_DAYS,
  DEFAULT_DIFFICULTY,
  DIFFICULTY_MIN,
  DIFFICULTY_MAX,
  FIRST_CLEAN_STABILITY_DAYS,
  SECOND_CLEAN_MIN_STABILITY_DAYS,
  SECOND_CLEAN_STABILITY_MULTIPLIER,
  RESCUED_STABILITY_MULTIPLIER,
  INCORRECT_STABILITY_SHRINK,
  INCORRECT_MIN_STABILITY,
  REVIEW_GROWTH_BASE,
  REVIEW_GROWTH_DIFFICULTY_SCALE,
  STREAK_BONUS,
  DIFF_DELTA_FIRST_CLEAN,
  DIFF_DELTA_SECOND_CLEAN,
  DIFF_DELTA_LATER_CLEAN,
  DIFF_DELTA_RESCUED,
  DIFF_DELTA_INCORRECT,
  DIFF_FLOOR_FIRST_CLEAN,
  DIFF_FLOOR_SECOND_CLEAN,
  DIFF_FLOOR_LATER_CLEAN,
  DIFF_FLOOR_RESCUED,
} from "./scheduler";

// ---------------------------------------------------------------------------
// Load the authoritative SQL migration
// ---------------------------------------------------------------------------

const SQL_PATH = resolve(
  __dirname,
  "../../supabase/migrations/20260410160001_srs_v2_scheduler.sql",
);
const sql = readFileSync(SQL_PATH, "utf-8");

/**
 * Extract the SRS v2 scheduler section from the SQL (after the "SRS v2:
 * deterministic scheduler update" comment through the END of the function).
 */
function getSrsV2Section(): string {
  const marker = "SRS v2: deterministic scheduler update";
  const idx = sql.indexOf(marker);
  if (idx === -1) throw new Error(`Could not find "${marker}" in SQL`);
  return sql.slice(idx);
}

const srsSection = getSrsV2Section();

// ---------------------------------------------------------------------------
// Helpers: extract numeric constants from SQL by pattern
// ---------------------------------------------------------------------------

/** Find all occurrences of a pattern and return the captured group as numbers */
function findNumbers(pattern: RegExp, source = srsSection): number[] {
  const matches: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(pattern, "g");
  while ((m = re.exec(source)) !== null) {
    matches.push(parseFloat(m[1]));
  }
  return matches;
}

/** Assert that a specific constant appears in the SQL */
function assertSqlContains(pattern: RegExp, desc: string) {
  expect(pattern.test(srsSection), `SQL should contain ${desc}`).toBe(true);
}

// ---------------------------------------------------------------------------
// Stability cap: LEAST(N, v_new_stability)
// ---------------------------------------------------------------------------
describe("stability cap parity", () => {
  it(`SQL stability cap matches TS MAX_STABILITY_DAYS (${MAX_STABILITY_DAYS})`, () => {
    const caps = findNumbers(/LEAST\((\d+),\s*v_new_stability\)/);
    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) {
      expect(cap).toBe(MAX_STABILITY_DAYS);
    }
  });
});

// ---------------------------------------------------------------------------
// Difficulty deltas and floors
// ---------------------------------------------------------------------------
describe("difficulty constant parity", () => {
  it("first clean: difficulty delta = -0.08, floor = 0.30", () => {
    // SQL: v_new_difficulty - 0.08  within the first_ever block
    // SQL: GREATEST(0.30, v_new_difficulty - 0.08)
    assertSqlContains(
      /GREATEST\(0\.30,\s*v_new_difficulty\s*-\s*0\.08\)/,
      "first clean: GREATEST(0.30, v_new_difficulty - 0.08)",
    );
    expect(Math.abs(DIFF_DELTA_FIRST_CLEAN)).toBeCloseTo(0.08, 5);
    expect(DIFF_FLOOR_FIRST_CLEAN).toBeCloseTo(0.30, 5);
  });

  it("second clean: difficulty delta = -0.05, floor = 0.20", () => {
    assertSqlContains(
      /GREATEST\(0\.20,\s*v_new_difficulty\s*-\s*0\.05\)/,
      "second clean: GREATEST(0.20, v_new_difficulty - 0.05)",
    );
    expect(Math.abs(DIFF_DELTA_SECOND_CLEAN)).toBeCloseTo(0.05, 5);
    expect(DIFF_FLOOR_SECOND_CLEAN).toBeCloseTo(0.20, 5);
  });

  it("later clean: difficulty delta = -0.02, floor = 0.15", () => {
    assertSqlContains(
      /GREATEST\(0\.15,\s*v_new_difficulty\s*-\s*0\.02\)/,
      "later clean: GREATEST(0.15, v_new_difficulty - 0.02)",
    );
    expect(Math.abs(DIFF_DELTA_LATER_CLEAN)).toBeCloseTo(0.02, 5);
    expect(DIFF_FLOOR_LATER_CLEAN).toBeCloseTo(DIFFICULTY_MIN, 5);
  });

  it("rescued success: difficulty delta = -0.01, floor = 0.20", () => {
    assertSqlContains(
      /GREATEST\(0\.20,\s*v_new_difficulty\s*-\s*0\.01\)/,
      "rescued: GREATEST(0.20, v_new_difficulty - 0.01)",
    );
    expect(Math.abs(DIFF_DELTA_RESCUED)).toBeCloseTo(0.01, 5);
    expect(DIFF_FLOOR_RESCUED).toBeCloseTo(0.20, 5);
  });

  it("incorrect: difficulty delta = +0.08, cap = 0.95", () => {
    assertSqlContains(
      /LEAST\(0\.95,\s*v_new_difficulty\s*\+\s*0\.08\)/,
      "incorrect: LEAST(0.95, v_new_difficulty + 0.08)",
    );
    expect(DIFF_DELTA_INCORRECT).toBeCloseTo(0.08, 5);
    expect(DIFFICULTY_MAX).toBeCloseTo(0.95, 5);
  });

  it("default difficulty = 0.55", () => {
    // SQL: ADD COLUMN IF NOT EXISTS difficulty numeric NOT NULL DEFAULT 0.5
    // But the SRS v2 section uses COALESCE(v_row.difficulty, 0.55)
    assertSqlContains(
      /COALESCE\(v_row\.difficulty,\s*0\.55\)/,
      "default difficulty = 0.55",
    );
    expect(DEFAULT_DIFFICULTY).toBeCloseTo(0.55, 5);
  });
});

// ---------------------------------------------------------------------------
// Stability constants per outcome path
// ---------------------------------------------------------------------------
describe("stability constant parity", () => {
  it("first clean: stability = GREATEST(stability, 2)", () => {
    assertSqlContains(
      /GREATEST\(v_new_stability,\s*2\)/,
      "first clean stability = 2",
    );
    expect(FIRST_CLEAN_STABILITY_DAYS).toBe(2);
  });

  it("second clean: stability = GREATEST(6, stability * 3)", () => {
    assertSqlContains(
      /GREATEST\(6,\s*v_new_stability\s*\*\s*3\)/,
      "second clean stability = GREATEST(6, stability * 3)",
    );
    expect(SECOND_CLEAN_MIN_STABILITY_DAYS).toBe(6);
    expect(SECOND_CLEAN_STABILITY_MULTIPLIER).toBe(3);
  });

  it("later clean: growth = 1.8 + (1 - difficulty) * 0.8", () => {
    assertSqlContains(
      /1\.8\s*\+\s*\(1\s*-\s*v_new_difficulty\)\s*\*\s*0\.8/,
      "later clean growth formula",
    );
    expect(REVIEW_GROWTH_BASE).toBeCloseTo(1.8, 5);
    expect(REVIEW_GROWTH_DIFFICULTY_SCALE).toBeCloseTo(0.8, 5);
  });

  it("later clean: streak bonus = 0.15 when consec >= 2", () => {
    assertSqlContains(
      /v_growth\s*\+\s*0\.15/,
      "streak bonus = 0.15",
    );
    expect(STREAK_BONUS).toBeCloseTo(0.15, 5);
  });

  it("rescued: stability = GREATEST(1, stability * 1.2)", () => {
    assertSqlContains(
      /GREATEST\(1,\s*v_new_stability\s*\*\s*1\.2\)/,
      "rescued stability multiplier = 1.2",
    );
    expect(RESCUED_STABILITY_MULTIPLIER).toBeCloseTo(1.2, 5);
  });

  it("incorrect: stability = GREATEST(0.5, stability * 0.35)", () => {
    assertSqlContains(
      /GREATEST\(0\.5,\s*v_new_stability\s*\*\s*0\.35\)/,
      "incorrect stability shrink = 0.35",
    );
    expect(INCORRECT_STABILITY_SHRINK).toBeCloseTo(0.35, 5);
    expect(INCORRECT_MIN_STABILITY).toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// Learned level changes per outcome
// ---------------------------------------------------------------------------
describe("learned_level parity", () => {
  it("first clean: learned_level += 2", () => {
    assertSqlContains(
      /v_new_learned_level\s*:=\s*v_new_learned_level\s*\+\s*2/,
      "first/second clean: learned_level += 2",
    );
  });

  it("rescued: learned_level += 1 only when > 0", () => {
    assertSqlContains(
      /IF v_new_learned_level > 0 THEN\s+v_new_learned_level := v_new_learned_level \+ 1/,
      "rescued: conditional learned_level increment",
    );
  });

  it("incorrect: learned_level = GREATEST(0, level - 1)", () => {
    assertSqlContains(
      /GREATEST\(0,\s*v_new_learned_level\s*-\s*1\)/,
      "incorrect: learned_level -= 1 floored at 0",
    );
  });
});

// ---------------------------------------------------------------------------
// Scheduling: next_due intervals
// ---------------------------------------------------------------------------
describe("next_due interval parity", () => {
  it("first clean: next_due = now + 2 days", () => {
    assertSqlContains(
      /v_now\s*\+\s*interval\s*'2 days'/,
      "first clean: +2 days",
    );
  });

  it("rescued: next_due = now + 1 day", () => {
    // There should be "interval '1 day'" in the rescued path
    assertSqlContains(
      /v_now\s*\+\s*interval\s*'1 day'/,
      "rescued/incorrect: +1 day",
    );
  });
});

// ---------------------------------------------------------------------------
// Queue: get_daily_queue uses UNION ALL (overlap risk documented)
// ---------------------------------------------------------------------------
describe("get_daily_queue structure", () => {
  const queueSql = readFileSync(
    resolve(__dirname, "../../supabase/migrations/20260410160003_workload_policy.sql"),
    "utf-8",
  );

  it("uses UNION ALL between reviews and new words", () => {
    expect(queueSql).toContain("UNION ALL");
  });

  it("supports p_exclude_word_ids for continuation dedup", () => {
    expect(queueSql).toContain("p_exclude_word_ids");
    expect(queueSql).toContain("NOT (uw.word_id = ANY(p_exclude_word_ids))");
    expect(queueSql).toContain("NOT (w.id = ANY(p_exclude_word_ids))");
  });

  it("reviews use priority ordering (forgetting-risk score)", () => {
    expect(queueSql).toContain("stability_days");
    expect(queueSql).toContain("difficulty");
    expect(queueSql).toContain("srs_state");
    expect(queueSql).toMatch(/ORDER BY.*DESC/s);
  });
});
