/**
 * Lower-level regression test for the Daisy bug — the `daily_sessions` stage
 * transitions implemented inside the SQL function `public.record_review`.
 *
 * Browser-level Playwright coverage for this flow is currently BLOCKED in this
 * session (Playwright is not installed, Docker / local Supabase is off, no
 * test-account credentials in env, and we must not touch participant rows).
 * Per the pre-push audit's PART 7 fallback, this file exercises the same
 * stage-transition logic that broke production by:
 *
 *   1. Driving the shared TS stage rule (lib/loop/dailySessionStage.ts, which
 *      mirrors the SQL `v_session_stage` CASE) plus the subsequent
 *      `v_session.completed` / `completed_at` / `flashcards_completed_at`
 *      updates through a fixture set that includes Daisy's exact mid-extend
 *      shape (assigned=21, attempts incrementing through 20 → 21 with
 *      `reading_done`/`listening_done` already true, `completed_at` preserved
 *      from initial completion).
 *   2. Reading the LIVE record_review body (the newest migration that creates
 *      it) and asserting the SQL CASE branches still end with `'completed'`,
 *      not the legacy `'complete'`.
 *
 * Since 20261102120000 the stage rule counts flashcard ATTEMPTS (main +
 * retry) and honours flashcards_skipped_at (contract A).
 *
 * If the SQL function or the TS mirror drift, both layers fail loudly. If the
 * SQL CASE flips back to `'complete'`, item (2) catches it; if anyone changes
 * the branch order or skips the `reading_done` / `listening_done` checks, item
 * (1) catches it.
 *
 * This file is NOT a substitute for the browser E2E coverage — it cannot
 * verify routing (/today → /done), error sanitisation, or the /progress badge
 * UI. Those scenarios remain BLOCKED until Playwright + a non-participant
 * test account are wired up. See the audit report for the full BLOCKED list.
 */

import { describe, expect, it } from "vitest";
import {
  getDailySessionProgressState,
  resolveDailySessionStage,
} from "@/lib/loop/dailySessionStage";
import { getLiveFunctionDefinition } from "./migrationSql.testSupport";

// ---------------------------------------------------------------------------
// TS side of the record_review session transition. The stage rule is the
// shared resolveDailySessionStage (parity with the SQL CASE is asserted in
// sqlParity.test.ts); the timestamp updates mirror the SQL IF blocks.
// ---------------------------------------------------------------------------

type SessionShape = {
  flashcard_completed_count: number;
  flashcard_attempts_count: number;
  assigned_flashcard_count: number;
  flashcards_skipped_at: string | null;
  reading_done: boolean;
  listening_done: boolean;
  completed: boolean;
  completed_at: string | null;
  flashcards_completed_at: string | null;
};

type SessionStage = "flashcards" | "reading" | "listening" | "completed";

function resolveStage(s: SessionShape): SessionStage {
  return resolveDailySessionStage(getDailySessionProgressState(s));
}

function applyRecordReviewTransition(
  before: SessionShape,
  now: string,
): SessionShape {
  const stage = resolveStage(before);
  const completed = stage === "completed";
  const completedAt =
    completed && before.completed_at === null ? now : before.completed_at;
  const flashcardsCompletedAt =
    stage !== "flashcards" && before.flashcards_completed_at === null
      ? now
      : before.flashcards_completed_at;
  return {
    ...before,
    completed,
    completed_at: completedAt,
    flashcards_completed_at: flashcardsCompletedAt,
  };
}

/** One submitted answer as record_review counts it. */
function answer(before: SessionShape, queueSource: "main" | "retry"): SessionShape {
  return {
    ...before,
    flashcard_attempts_count: before.flashcard_attempts_count + 1,
    flashcard_completed_count:
      before.flashcard_completed_count + (queueSource === "main" ? 1 : 0),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = "2026-04-28T09:24:31.000Z";
const ORIGINAL_COMPLETED_AT = "2026-04-28T09:17:04.562Z";

function freshSession(overrides: Partial<SessionShape> = {}): SessionShape {
  const base: SessionShape = {
    flashcard_completed_count: 0,
    flashcard_attempts_count: 0,
    assigned_flashcard_count: 10,
    flashcards_skipped_at: null,
    reading_done: false,
    listening_done: false,
    completed: false,
    completed_at: null,
    flashcards_completed_at: null,
  };
  const merged = { ...base, ...overrides };
  // Attempts are main + retry, so never fewer than main-queue completions.
  if (overrides.flashcard_attempts_count === undefined) {
    merged.flashcard_attempts_count = merged.flashcard_completed_count;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("record_review stage CASE — TS mirror", () => {
  it("returns 'flashcards' while assigned > attempts (initial review)", () => {
    expect(resolveStage(freshSession({ flashcard_completed_count: 0, assigned_flashcard_count: 10 })))
      .toBe("flashcards");
    expect(resolveStage(freshSession({ flashcard_completed_count: 5, assigned_flashcard_count: 10 })))
      .toBe("flashcards");
    expect(resolveStage(freshSession({ flashcard_completed_count: 9, assigned_flashcard_count: 10 })))
      .toBe("flashcards");
  });

  it("transitions to 'reading' once assigned <= attempts and reading_done=false", () => {
    expect(
      resolveStage(
        freshSession({
          flashcard_completed_count: 10,
          assigned_flashcard_count: 10,
          reading_done: false,
          listening_done: false,
        }),
      ),
    ).toBe("reading");
  });

  it("transitions to 'listening' once reading_done=true but listening_done=false", () => {
    expect(
      resolveStage(
        freshSession({
          flashcard_completed_count: 10,
          assigned_flashcard_count: 10,
          reading_done: true,
          listening_done: false,
        }),
      ),
    ).toBe("listening");
  });

  it("transitions to 'completed' once flashcards/reading/listening are all done", () => {
    expect(
      resolveStage(
        freshSession({
          flashcard_completed_count: 10,
          assigned_flashcard_count: 10,
          reading_done: true,
          listening_done: true,
        }),
      ),
    ).toBe("completed");
  });

  it("a day with mistakes leaves 'flashcards' once main + retry attempts reach the target", () => {
    // 10 assigned, 3 mistakes retried: the client ends the session after the
    // 10th submitted answer (7 main + 3 retry), so the server must too.
    let s = freshSession({ assigned_flashcard_count: 10 });
    for (let i = 0; i < 7; i += 1) s = applyRecordReviewTransition(answer(s, "main"), NOW);
    for (let i = 0; i < 2; i += 1) s = applyRecordReviewTransition(answer(s, "retry"), NOW);
    expect(resolveStage(s)).toBe("flashcards");
    s = applyRecordReviewTransition(answer(s, "retry"), NOW);
    expect(s.flashcard_completed_count).toBe(7);
    expect(s.flashcard_attempts_count).toBe(10);
    expect(resolveStage(s)).toBe("reading");
    expect(s.flashcards_completed_at).toBe(NOW);
  });

  it("a persisted skip ends the flashcard stage below target", () => {
    const skipped = freshSession({
      flashcard_completed_count: 4,
      assigned_flashcard_count: 50,
      flashcards_skipped_at: "2026-04-28T09:00:00.000Z",
    });
    expect(resolveStage(skipped)).toBe("reading");
    expect(resolveStage({ ...skipped, reading_done: true, listening_done: true })).toBe(
      "completed",
    );
  });

  it("never returns the legacy 'complete' literal", () => {
    const cases: SessionShape[] = [
      freshSession(),
      freshSession({ flashcard_completed_count: 5, assigned_flashcard_count: 10 }),
      freshSession({ flashcard_completed_count: 10, assigned_flashcard_count: 10 }),
      freshSession({
        flashcard_completed_count: 10,
        assigned_flashcard_count: 10,
        reading_done: true,
      }),
      freshSession({
        flashcard_completed_count: 10,
        assigned_flashcard_count: 10,
        reading_done: true,
        listening_done: true,
      }),
    ];
    for (const c of cases) {
      const out = resolveStage(c) as string;
      expect(out).not.toBe("complete");
      expect(["flashcards", "reading", "listening", "completed"]).toContain(out);
    }
  });
});

describe("record_review transition — Daisy-shaped mid-extend rows", () => {
  // Daisy's exact pre-incident shape on 2026-04-28: she had completed the full
  // loop at 09:17:04, pressed More Practice, the extend bumped assigned 10→21
  // and pulled completed_at forward as a preserved timestamp, and she had then
  // answered 10 of the 11 extension cards (total 20 of 21).
  function daisyMidExtend(): SessionShape {
    return {
      flashcard_completed_count: 20,
      flashcard_attempts_count: 20,
      assigned_flashcard_count: 21,
      flashcards_skipped_at: null,
      reading_done: true,
      listening_done: true,
      completed: false,
      completed_at: ORIGINAL_COMPLETED_AT,
      flashcards_completed_at: ORIGINAL_COMPLETED_AT,
    };
  }

  it("Daisy mid-extend (20/21) resolves to stage='flashcards'", () => {
    expect(resolveStage(daisyMidExtend())).toBe("flashcards");
  });

  it("Daisy at 20/21 → answer one card → stage snaps to 'completed', completed=true", () => {
    const before: SessionShape = {
      ...daisyMidExtend(),
      flashcard_completed_count: 21, // simulate +1 from record_review
      flashcard_attempts_count: 21,
    };
    const after = applyRecordReviewTransition(before, NOW);
    expect(after.flashcard_completed_count).toBe(21);
    expect(resolveStage(after)).toBe("completed");
    expect(after.completed).toBe(true);
  });

  it("Daisy mid-extend final card preserves the original completed_at (does NOT overwrite)", () => {
    const before: SessionShape = {
      ...daisyMidExtend(),
      flashcard_completed_count: 21,
      flashcard_attempts_count: 21,
    };
    const after = applyRecordReviewTransition(before, NOW);
    // The IF v_session.completed_at IS NULL THEN := v_now branch must NOT fire
    // because completed_at is already set from the original loop completion.
    expect(after.completed_at).toBe(ORIGINAL_COMPLETED_AT);
    expect(after.completed_at).not.toBe(NOW);
  });

  it("Daisy mid-extend non-final card stays in 'flashcards', completed=false, completed_at preserved", () => {
    const before: SessionShape = daisyMidExtend(); // 20/21
    const afterAnotherCard: SessionShape = {
      ...before,
      flashcard_completed_count: before.flashcard_completed_count + 1, // 20 → 21? no, simulate going 19 → 20
    };
    // Reset for the 19 → 20 case explicitly, since 20+1=21 hits terminal.
    const between: SessionShape = {
      ...before,
      flashcard_completed_count: 19,
      flashcard_attempts_count: 19,
    };
    const after = applyRecordReviewTransition(between, NOW);
    expect(resolveStage(after)).toBe("flashcards");
    expect(after.completed).toBe(false);
    expect(after.completed_at).toBe(ORIGINAL_COMPLETED_AT);
    // Suppress the unused-variable lint for the simulated terminal hit.
    void afterAnotherCard;
  });

  it("Fresh full-loop completion (never been completed) gets completed_at = now", () => {
    const fresh: SessionShape = freshSession({
      flashcard_completed_count: 10,
      assigned_flashcard_count: 10,
      reading_done: true,
      listening_done: true,
      completed_at: null,
    });
    const after = applyRecordReviewTransition(fresh, NOW);
    expect(after.completed).toBe(true);
    expect(after.completed_at).toBe(NOW);
  });

  it("Daisy-shaped row at 21/21 satisfies daily_sessions_completed_stage_check", () => {
    // The live invariant: (completed = false) OR (stage = 'completed').
    // After the final extra card, completed=true must coincide with stage='completed'.
    const before: SessionShape = {
      ...daisyMidExtend(),
      flashcard_completed_count: 21,
      flashcard_attempts_count: 21,
    };
    const after = applyRecordReviewTransition(before, NOW);
    const stage = resolveStage(after);
    const satisfies = after.completed === false || stage === "completed";
    expect(satisfies).toBe(true);
  });
});

describe("record_review SQL body parity — migration source of truth", () => {
  // The TS mirror above is only as good as its agreement with the actual SQL.
  // These checks read the live definition (newest migration creating
  // record_review) and confirm the CASE block still ends with 'completed'
  // and writes (v_session_stage = 'completed') for the completion flag.

  function readActiveOverloadBody(): string {
    return getLiveFunctionDefinition("record_review").definition;
  }

  it("active overload's CASE terminates with 'completed', not 'complete'", () => {
    const body = readActiveOverloadBody();
    // Match the v_session_stage CASE: the last branch must be ELSE 'completed'.
    const caseMatch = body.match(
      /v_session_stage\s*:=\s*CASE[\s\S]*?ELSE\s+('[^']+')/,
    );
    expect(caseMatch, "could not locate v_session_stage CASE in migration").not.toBeNull();
    expect(caseMatch![1]).toBe("'completed'");
  });

  it("active overload writes v_session.completed = (v_session_stage = 'completed')", () => {
    const body = readActiveOverloadBody();
    expect(body).toMatch(
      /v_session\.completed\s*:=\s*\(\s*v_session_stage\s*=\s*'completed'\s*\)/,
    );
    // Defence against an accidental return of the legacy literal.
    const stripped = body.replace(/'completed'/g, "'__OK__'");
    expect(stripped).not.toMatch(/v_session_stage\s*=\s*'complete'/);
    expect(stripped).not.toMatch(/ELSE\s+'complete'/);
  });

  it("CASE branch order is flashcards → reading → listening → completed", () => {
    const body = readActiveOverloadBody();
    const caseBlock = body.match(
      /v_session_stage\s*:=\s*CASE([\s\S]*?)END;/,
    );
    expect(caseBlock).not.toBeNull();
    const branches = caseBlock![1];
    const flashcardsIdx = branches.indexOf("'flashcards'");
    const readingIdx = branches.indexOf("'reading'");
    const listeningIdx = branches.indexOf("'listening'");
    const completedIdx = branches.indexOf("'completed'");
    expect(flashcardsIdx).toBeGreaterThan(-1);
    expect(readingIdx).toBeGreaterThan(flashcardsIdx);
    expect(listeningIdx).toBeGreaterThan(readingIdx);
    expect(completedIdx).toBeGreaterThan(listeningIdx);
  });
});
