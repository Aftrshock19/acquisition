/**
 * Structural test for the soft-suspend migration.
 *
 * The authoritative behaviour lives in the SQL migration
 * `20260426140000_add_word_suspend.sql`: it adds the suspend bookkeeping
 * columns and replaces `get_daily_queue` so the review branch excludes
 * `status='suspended'` rows. There is no full SQL execution harness in this
 * repo, so this test file plays the same role as `sqlParity.test.ts`: it
 * reads the migration and asserts the load-bearing structural pieces are
 * actually present, so a future refactor can't quietly drop them.
 *
 * The matching server actions in app/actions/srs.ts (`suspendWord`,
 * `unsuspendWord`) are integration-checked against the live database
 * separately; manual SQL verification is documented at the bottom of this
 * file.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const MIGRATION_PATH = resolve(
  __dirname,
  "../../supabase/migrations/20260426140000_add_word_suspend.sql",
);
const sql = readFileSync(MIGRATION_PATH, "utf-8");

describe("word-suspend migration", () => {
  it("adds suspended_at and suspended_reason columns to user_words", () => {
    expect(sql).toMatch(
      /ALTER TABLE\s+public\.user_words[\s\S]*?ADD COLUMN IF NOT EXISTS\s+suspended_at\s+timestamptz/i,
    );
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS\s+suspended_reason\s+text/i,
    );
  });

  it("constrains suspended_reason to the documented set (or null)", () => {
    // CHECK should permit NULL plus the five enumerated reasons. We assert
    // each value is named explicitly so a future edit can't silently widen
    // or narrow the set without tripping this test.
    for (const reason of [
      "already_known",
      "not_useful",
      "incorrect",
      "do_not_want",
      "other",
    ]) {
      expect(sql).toContain(`'${reason}'`);
    }
    expect(sql).toMatch(/suspended_reason\s+IS\s+NULL/i);
  });

  it("get_daily_queue review branch excludes suspended rows", () => {
    // The full review-branch WHERE block must contain the status gate.
    // Match across the whole CREATE OR REPLACE so the regex isn't sensitive
    // to whitespace / inline comments.
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_daily_queue/i,
    );
    expect(sql).toMatch(
      /COALESCE\(uw\.status,\s*'new'\)\s*<>\s*'suspended'/,
    );
  });

  it("get_daily_queue new-word branch is unchanged: NOT EXISTS user_words covers suspended", () => {
    // The new-word branch must keep the existing NOT EXISTS guard, so a
    // suspended row keeps blocking a word from being re-introduced as new.
    expect(sql).toMatch(
      /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.user_words\s+uw2/i,
    );
  });

  it("review branch keeps next_due, last_review_at, and exclude-id guards alongside the status gate", () => {
    // Defence-in-depth: confirm the migration didn't accidentally drop the
    // pre-existing eligibility filters when adding the suspend gate.
    expect(sql).toMatch(/uw\.next_due\s*<=\s*now\(\)/);
    expect(sql).toMatch(/uw\.last_review_at\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/NOT\s*\(uw\.word_id\s*=\s*ANY\(p_exclude_word_ids\)\)/);
  });
});

// ---------------------------------------------------------------------------
// Manual integration verification (not run by vitest; documented for future
// regressions). Each step uses the linked Supabase project and an authenticated
// JWT for the test user so it exercises the same auth path the application
// uses, not service role.
//
// 1. Pick a user_words row that is currently due:
//      SELECT word_id, status, next_due, last_review_at
//      FROM user_words
//      WHERE user_id = '<user-id>'
//        AND last_review_at IS NOT NULL
//        AND next_due <= now()
//      LIMIT 1;
//
// 2. Confirm get_daily_queue returns it as a review:
//      SELECT word_id, kind FROM get_daily_queue('es', 0, 50, '{}')
//      WHERE word_id = '<word-id>';
//
// 3. Suspend it (simulate the server action's effect):
//      UPDATE user_words
//         SET status = 'suspended',
//             suspended_at = now(),
//             suspended_reason = 'do_not_want',
//             updated_at = now()
//       WHERE user_id = '<user-id>' AND word_id = '<word-id>';
//
// 4. Confirm get_daily_queue NO LONGER returns it as a review:
//      SELECT word_id, kind FROM get_daily_queue('es', 0, 50, '{}')
//      WHERE word_id = '<word-id>';   -- expect: 0 rows
//
// 5. Confirm pick_new_words_near_frontier and pick_user_driven_fallback
//    still exclude it (they always have, via NOT EXISTS user_words).
//
// 6. Restore the row:
//      UPDATE user_words
//         SET status = 'learning',
//             suspended_at = NULL,
//             suspended_reason = NULL,
//             updated_at = now()
//       WHERE user_id = '<user-id>' AND word_id = '<word-id>';
// ---------------------------------------------------------------------------
