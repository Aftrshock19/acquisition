/**
 * SQL ↔ TS parity test.
 *
 * The Postgres `record_review` RPC is the ONLY authoritative scheduler at
 * runtime.  The TypeScript reference implementation in scheduler.ts exists
 * for tests and documentation.  If the two diverge, scheduling bugs happen
 * silently at runtime while tests stay green.
 *
 * This test reads the LIVE definition of each SQL function (the last
 * migration, by filename, that creates it) and extracts key numeric constants
 * via regex, then asserts they match the TS exports.
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
import { getAppSessionTimeZone } from "@/lib/analytics/date";
import {
  getDailySessionProgressState,
  resolveDailySessionStage,
} from "@/lib/loop/dailySessionStage";
import { getLiveFunctionDefinition, MIGRATIONS_DIR } from "./migrationSql.testSupport";
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
// Load the live record_review definition (latest migration that creates it)
// ---------------------------------------------------------------------------

const liveRecordReview = getLiveFunctionDefinition("record_review");

/**
 * The scheduler section: from the v_difficulty_before snapshot (which holds
 * the COALESCE(difficulty, 0.55) default) through the end of the function.
 */
function getSrsV2Section(): string {
  const marker = "v_difficulty_before :=";
  const idx = liveRecordReview.definition.indexOf(marker);
  if (idx === -1) throw new Error(`Could not find "${marker}" in record_review`);
  return liveRecordReview.definition.slice(idx);
}

const srsSection = getSrsV2Section();

describe("live definition lookup", () => {
  it("record_review parity runs against the newest migration defining it", () => {
    // Guard against silently testing a superseded body again: the lookup
    // must never resolve to anything older than the scheduler_outcome fix.
    expect(
      liveRecordReview.migration >=
        "20261102120000_daily_loop_completion_and_scheduler_outcome.sql",
    ).toBe(true);
  });
});

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
  it("clean paths: next_due = now + stability days (first clean: 2 for a new word)", () => {
    // The live adaptive RPC schedules every clean path from v_new_stability
    // (GREATEST(stability, 2) on first clean, then the adaptive multiplier),
    // not from a literal '2 days'.
    assertSqlContains(
      /v_new_next_due\s*:=\s*v_now\s*\+\s*\(v_new_stability\s*\|\|\s*' days'\)::interval/,
      "clean: now + v_new_stability days",
    );
    expect(FIRST_CLEAN_STABILITY_DAYS).toBe(2);
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
  const queueSql = getLiveFunctionDefinition("get_daily_queue").definition;

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
    expect(queueSql).toMatch(/ORDER BY[\s\S]*DESC/);
  });
});

// ---------------------------------------------------------------------------
// Daily-loop stage rule (contract A): SQL CASE == resolveDailySessionStage
// ---------------------------------------------------------------------------
describe("daily_sessions stage rule parity", () => {
  const body = liveRecordReview.definition;

  it("SQL counts attempts (main + retry) and honours flashcards_skipped_at", () => {
    const caseBlock = body.match(/v_session_stage\s*:=\s*CASE([\s\S]*?)END;/);
    expect(caseBlock).not.toBeNull();
    const branches = caseBlock![1].replace(/\s+/g, " ").trim();
    expect(branches).toBe(
      "WHEN COALESCE(v_session.flashcard_attempts_count, 0) < COALESCE(v_session.assigned_flashcard_count, 0) " +
        "AND v_session.flashcards_skipped_at IS NULL THEN 'flashcards' " +
        "WHEN NOT COALESCE(v_session.reading_done, false) THEN 'reading' " +
        "WHEN NOT COALESCE(v_session.listening_done, false) THEN 'listening' " +
        "ELSE 'completed'",
    );
    expect(body).toMatch(
      /v_session\.completed\s*:=\s*\(\s*v_session_stage\s*=\s*'completed'\s*\)/,
    );
  });

  // Mirror of the SQL CASE above, evaluated on raw row values.
  function sqlStage(row: {
    flashcard_attempts_count: number;
    assigned_flashcard_count: number;
    flashcards_skipped_at: string | null;
    reading_done: boolean;
    listening_done: boolean;
  }) {
    if (
      row.flashcard_attempts_count < row.assigned_flashcard_count &&
      row.flashcards_skipped_at === null
    ) {
      return "flashcards";
    }
    if (!row.reading_done) return "reading";
    if (!row.listening_done) return "listening";
    return "completed";
  }

  it("TS resolveDailySessionStage agrees with the SQL CASE on every combination", () => {
    for (const attempts of [0, 9, 10, 11]) {
      for (const completedMain of [0, 7, 10]) {
        for (const skipped of [null, "2026-11-02T10:00:00.000Z"]) {
          for (const reading_done of [false, true]) {
            for (const listening_done of [false, true]) {
              const row = {
                assigned_flashcard_count: 10,
                flashcard_attempts_count: attempts,
                flashcard_completed_count: Math.min(completedMain, attempts),
                flashcards_skipped_at: skipped,
                reading_done,
                listening_done,
              };
              expect(resolveDailySessionStage(getDailySessionProgressState(row))).toBe(
                sqlStage(row),
              );
            }
          }
        }
      }
    }
  });

  it("flashcards_completed_at and completed_at are first-reached and never cleared", () => {
    expect(body).toMatch(
      /IF\s+v_session_stage\s*<>\s*'flashcards'\s+AND\s+v_session\.flashcards_completed_at\s+IS\s+NULL\s+THEN\s+v_session\.flashcards_completed_at\s*:=\s*v_now;/,
    );
    expect(body).toMatch(
      /IF\s+v_session\.completed\s+AND\s+v_session\.completed_at\s+IS\s+NULL\s+THEN\s+v_session\.completed_at\s*:=\s*v_now;/,
    );
    expect(body).not.toMatch(/flashcards_completed_at\s*:=\s*NULL/i);
    expect(body).not.toMatch(/completed_at\s*:=\s*NULL/i);
  });

  it("session date: loaded app-day (today or yesterday) in the app session time zone", () => {
    const tz = body.match(/v_app_today\s+date\s*:=\s*\(now\(\)\s+AT\s+TIME\s+ZONE\s+'([^']+)'\)::date/);
    expect(tz).not.toBeNull();
    expect(tz![1]).toBe("Europe/London");
    if (!process.env.APP_SESSION_TIME_ZONE) {
      expect(getAppSessionTimeZone()).toBe(tz![1]);
    }
    expect(body).toMatch(
      /WHEN\s+p_session_date\s+IN\s*\(\s*v_app_today\s*,\s*v_app_today\s*-\s*1\s*\)\s+THEN\s+p_session_date\s+ELSE\s+v_app_today/,
    );
    expect(body).not.toMatch(/v_now::date/);
  });
});

// ---------------------------------------------------------------------------
// scheduler_outcome: written on every branch, values allowed by the CHECK
// ---------------------------------------------------------------------------
describe("scheduler_outcome parity", () => {
  const body = liveRecordReview.definition;
  const checkSql = readFileSync(
    resolve(MIGRATIONS_DIR, "20260410160002_srs_v2_cleanup.sql"),
    "utf-8",
  );

  function allowedOutcomes(): string[] {
    const check = checkSql.match(
      /review_events_scheduler_outcome_check\s+CHECK\s*\(\s*scheduler_outcome\s+IS\s+NULL\s+OR\s+scheduler_outcome\s+IN\s*\(([^)]*)\)/,
    );
    expect(check).not.toBeNull();
    return [...check![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  }

  it("each scheduler branch assigns its outcome label", () => {
    expect(body).toMatch(
      /IF\s+v_is_first_ever\s+THEN\s+v_scheduler_outcome\s*:=\s*'first_clean_success';/,
    );
    expect(body).toMatch(
      /ELSIF\s+v_is_second_clean\s+THEN\s+v_scheduler_outcome\s*:=\s*'second_clean_success';/,
    );
    expect(body).toMatch(
      /ELSE\s+v_scheduler_outcome\s*:=\s*'later_clean_review';\s+v_growth\s*:=/,
    );
    expect(body).toMatch(
      /ELSIF\s+v_correct\s+AND\s+NOT\s+p_first_try\s+THEN\s+v_scheduler_outcome\s*:=\s*'rescued_success';/,
    );
    expect(body).toMatch(
      /ELSE\s+v_scheduler_outcome\s*:=\s*'incorrect_lapse';\s+v_new_difficulty\s*:=\s*LEAST\(0\.95/,
    );
  });

  it("assigned labels are exactly the CHECK-allowed values", () => {
    const assigned = [
      ...body.matchAll(/v_scheduler_outcome\s*:=\s*'([^']+)'/g),
    ].map((m) => m[1]);
    expect([...new Set(assigned)].sort()).toEqual(allowedOutcomes());
  });

  /** Split on commas that are not inside parentheses or quotes. */
  function splitTopLevel(list: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let inQuote = false;
    let current = "";
    for (const ch of list) {
      if (ch === "'") inQuote = !inQuote;
      if (!inQuote && ch === "(") depth += 1;
      if (!inQuote && ch === ")") depth -= 1;
      if (!inQuote && depth === 0 && ch === ",") {
        parts.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    parts.push(current.trim());
    return parts;
  }

  it("the review_events INSERT writes scheduler_outcome", () => {
    const insert = body.match(
      /INSERT INTO public\.review_events\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\);/,
    );
    expect(insert).not.toBeNull();
    const columns = splitTopLevel(insert![1]);
    const values = splitTopLevel(insert![2]);
    expect(columns.length).toBe(values.length);
    const idx = columns.indexOf("scheduler_outcome");
    expect(idx).toBeGreaterThan(-1);
    expect(values[idx]).toBe("v_scheduler_outcome");
  });
});
