import { describe, expect, it } from "vitest";
import {
  deriveSchedulerOutcome,
  type SchedulerOutcome,
  type SchedulerOutcomeEvidence,
} from "./schedulerOutcome";

function ev(overrides: Partial<SchedulerOutcomeEvidence>): SchedulerOutcomeEvidence {
  return {
    correct: true,
    first_try: true,
    difficulty_before: 0.5,
    difficulty_after: 0.42,
    baseline_interval_days: 2,
    scheduler_outcome: null,
    ...overrides,
  };
}

const NOT_CLEAN = ev({ correct: false, difficulty_before: 0.3, difficulty_after: 0.38, baseline_interval_days: 0.7 });
const CLEAN = ev({ difficulty_before: 0.24, difficulty_after: 0.22, baseline_interval_days: 4 });
const LEGACY = ev({ difficulty_before: null, difficulty_after: null, baseline_interval_days: null });

describe("deriveSchedulerOutcome: row-level rules", () => {
  it("incorrect answer → incorrect_lapse", () => {
    expect(
      deriveSchedulerOutcome(
        ev({ correct: false, difficulty_before: 0.5, difficulty_after: 0.58, baseline_interval_days: 0.5 }),
      ),
    ).toBe("incorrect_lapse");
    // Cap at 0.95.
    expect(
      deriveSchedulerOutcome(
        ev({ correct: false, difficulty_before: 0.9, difficulty_after: 0.95, baseline_interval_days: 0.5 }),
      ),
    ).toBe("incorrect_lapse");
  });

  it("correct retry → rescued_success", () => {
    expect(
      deriveSchedulerOutcome(
        ev({ first_try: false, difficulty_before: 0.58, difficulty_after: 0.57, baseline_interval_days: 1 }),
      ),
    ).toBe("rescued_success");
  });

  it("first-ever clean answer → first_clean_success", () => {
    expect(deriveSchedulerOutcome(ev({}))).toBe("first_clean_success");
  });

  it("second clean → second_clean_success", () => {
    expect(
      deriveSchedulerOutcome(
        ev({ difficulty_before: 0.42, difficulty_after: 0.37, baseline_interval_days: 6 }),
      ),
    ).toBe("second_clean_success");
  });

  it("later clean → later_clean_review", () => {
    expect(
      deriveSchedulerOutcome(
        ev({ difficulty_before: 0.37, difficulty_after: 0.35, baseline_interval_days: 19.4 }),
      ),
    ).toBe("later_clean_review");
  });

  it("tolerates float noise from JS arithmetic on 2-decimal difficulties", () => {
    expect(
      deriveSchedulerOutcome(
        ev({ difficulty_before: 0.42, difficulty_after: 0.42 - 0.05, baseline_interval_days: 6 }),
      ),
    ).toBe("second_clean_success");
  });

  it("d = 0.35: first vs second is decided by the baseline (2 vs >= 6)", () => {
    const row = { difficulty_before: 0.35, difficulty_after: 0.3 };
    expect(deriveSchedulerOutcome(ev({ ...row, baseline_interval_days: 2 }))).toBe(
      "first_clean_success",
    );
    expect(deriveSchedulerOutcome(ev({ ...row, baseline_interval_days: 6 }))).toBe(
      "second_clean_success",
    );
  });

  it("d = 0.32: baseline exactly 2 is first, anything else is later", () => {
    const row = { difficulty_before: 0.32, difficulty_after: 0.3 };
    expect(deriveSchedulerOutcome(ev({ ...row, baseline_interval_days: 2 }))).toBe(
      "first_clean_success",
    );
    expect(deriveSchedulerOutcome(ev({ ...row, baseline_interval_days: 2.344 }))).toBe(
      "later_clean_review",
    );
  });

  it("d = 0.22 with baseline < 6 can only be later", () => {
    expect(
      deriveSchedulerOutcome(
        ev({ difficulty_before: 0.22, difficulty_after: 0.2, baseline_interval_days: 5.5 }),
      ),
    ).toBe("later_clean_review");
  });

  it("rows not written by the 18-param RPC stay null", () => {
    expect(deriveSchedulerOutcome(LEGACY)).toBeNull();
  });

  it("rows whose columns contradict every branch stay null", () => {
    // Marked incorrect but difficulty went down.
    expect(
      deriveSchedulerOutcome(
        ev({ correct: false, difficulty_before: 0.5, difficulty_after: 0.42, baseline_interval_days: 2 }),
      ),
    ).toBeNull();
    // Clean answer whose difficulty matches no clean rule.
    expect(
      deriveSchedulerOutcome(
        ev({ difficulty_before: 0.5, difficulty_after: 0.6, baseline_interval_days: 2 }),
      ),
    ).toBeNull();
    // First-clean difficulty but a baseline only a later review could give
    // (first_clean_success always stores exactly 2).
    expect(
      deriveSchedulerOutcome(
        ev({ difficulty_before: 0.5, difficulty_after: 0.42, baseline_interval_days: 3 }),
      ),
    ).toBeNull();
  });
});

describe("deriveSchedulerOutcome: d = 0.22 second vs later uses the word's history", () => {
  const ambiguous = ev({ difficulty_before: 0.22, difficulty_after: 0.2, baseline_interval_days: 9 });

  it("previous event not clean → consec was 0 → later", () => {
    expect(deriveSchedulerOutcome(ambiguous, [CLEAN, NOT_CLEAN])).toBe("later_clean_review");
  });

  it("previous clean, the one before not clean → consec was 1 → second", () => {
    expect(deriveSchedulerOutcome(ambiguous, [NOT_CLEAN, CLEAN])).toBe("second_clean_success");
  });

  it("two clean events before → consec was >= 2 → later", () => {
    expect(deriveSchedulerOutcome(ambiguous, [CLEAN, CLEAN])).toBe("later_clean_review");
  });

  it("uses stored outcomes on older rows (20260410160002 era)", () => {
    const storedRescue = { ...LEGACY, scheduler_outcome: "rescued_success" as const };
    expect(deriveSchedulerOutcome(ambiguous, [storedRescue, CLEAN])).toBe(
      "second_clean_success",
    );
  });

  it("stays null when the needed history is missing or pre-v2", () => {
    expect(deriveSchedulerOutcome(ambiguous)).toBeNull();
    expect(deriveSchedulerOutcome(ambiguous, [CLEAN])).toBeNull();
    expect(deriveSchedulerOutcome(ambiguous, [LEGACY, CLEAN])).toBeNull();
    expect(deriveSchedulerOutcome(ambiguous, [LEGACY])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Exactness check: replay random review histories through a line-by-line TS
// copy of the live record_review scheduler branch logic, then confirm the
// derivation recovers every branch label from the stored columns alone.
// ---------------------------------------------------------------------------

type WordState = {
  srsState: "new" | "learning" | "review";
  reps: number;
  lapses: number;
  difficulty: number;
  stability: number;
  consec: number;
  lastWasFirstTry: boolean;
};

const round2 = (x: number) => Math.round(x * 100) / 100;

function liveRecordReview(
  state: WordState,
  correct: boolean,
  firstTry: boolean,
  combined: number | null,
): { next: WordState; event: SchedulerOutcomeEvidence; label: SchedulerOutcome } {
  // Legacy half-life block runs first and bumps reps / lapses.
  const reps = state.reps + (correct ? 1 : 0);
  const lapses = state.lapses + (correct ? 0 : 1);
  const isFirstEver = correct
    ? state.srsState === "new" || (reps === 1 && lapses === 0)
    : state.srsState === "new" || (reps <= 1 && lapses === 0);
  const isSecondClean =
    !isFirstEver && correct && firstTry && state.consec === 1 && state.lastWasFirstTry;

  let d = state.difficulty;
  let s = state.stability;
  let consec = state.consec;
  let baseline: number;
  let label: SchedulerOutcome;
  let srsState: WordState["srsState"];
  let lastWasFirstTry: boolean;

  if (correct && firstTry) {
    if (isFirstEver) {
      label = "first_clean_success";
      d = Math.max(0.3, d - 0.08);
      s = Math.max(s, 2);
    } else if (isSecondClean) {
      label = "second_clean_success";
      d = Math.max(0.2, d - 0.05);
      s = Math.min(730, Math.max(6, s * 3));
    } else {
      label = "later_clean_review";
      let growth = 1.8 + (1 - d) * 0.8;
      if (consec >= 2) growth += 0.15;
      s = Math.min(730, Math.max(s + 1, s * growth));
      d = Math.max(0.15, d - 0.02);
    }
    consec += 1;
    baseline = s;
    if (combined !== null) s = Math.max(0.5, Math.min(730, baseline * combined));
    srsState = "review";
    lastWasFirstTry = true;
  } else if (correct && !firstTry) {
    label = "rescued_success";
    d = Math.max(0.2, d - 0.01);
    s = Math.min(730, Math.max(1, s * 1.2));
    baseline = s;
    consec = 0;
    srsState = s < 2 ? "learning" : "review";
    lastWasFirstTry = false;
  } else {
    label = "incorrect_lapse";
    d = Math.min(0.95, d + 0.08);
    s = Math.max(0.5, s * 0.35);
    baseline = s;
    consec = 0;
    srsState = "learning";
    lastWasFirstTry = false;
  }

  return {
    next: { srsState, reps, lapses, difficulty: round2(d), stability: s, consec, lastWasFirstTry },
    event: {
      correct,
      first_try: firstTry,
      difficulty_before: state.difficulty,
      difficulty_after: round2(d),
      baseline_interval_days: baseline,
      scheduler_outcome: null,
    },
    label,
  };
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("deriveSchedulerOutcome: exact over simulated live histories", () => {
  it("recovers every branch label, including the d = 0.22 history cases", () => {
    const rand = mulberry32(20261102);
    const hits: Record<string, number> = {};
    let ambiguousResolved = 0;

    for (let word = 0; word < 400; word += 1) {
      let state: WordState = {
        srsState: "new",
        reps: 0,
        lapses: 0,
        difficulty: 0.5, // user_words.difficulty column default
        stability: 0,
        consec: 0,
        lastWasFirstTry: false,
      };
      const history: SchedulerOutcomeEvidence[] = [];
      let lastWasIncorrect = false;

      for (let i = 0; i < 60; i += 1) {
        const r = rand();
        // Retries only follow a miss, as in the client retry queue.
        const firstTry: boolean = !(lastWasIncorrect && r < 0.6);
        const correct: boolean = firstTry ? rand() < 0.8 : rand() < 0.85;
        const combined: number | null = rand() < 0.5 ? 0.8 + rand() * 0.4 : null;
        const { next, event, label } = liveRecordReview(state, correct, firstTry, combined);

        const derived = deriveSchedulerOutcome(event, history);
        expect(derived).toBe(label);
        hits[label] = (hits[label] ?? 0) + 1;
        if (
          correct &&
          firstTry &&
          Math.abs((event.difficulty_before ?? 0) - 0.22) < 1e-9 &&
          (event.baseline_interval_days ?? 0) >= 6
        ) {
          ambiguousResolved += 1;
        }

        history.push(event);
        state = next;
        lastWasIncorrect = !correct;
      }
    }

    for (const outcome of [
      "first_clean_success",
      "second_clean_success",
      "later_clean_review",
      "rescued_success",
      "incorrect_lapse",
    ]) {
      expect(hits[outcome] ?? 0).toBeGreaterThan(0);
    }
    expect(ambiguousResolved).toBeGreaterThan(0);
  });
});
