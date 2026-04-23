/**
 * Session flow integration tests.
 *
 * These tests simulate the key invariants of a flashcard session WITHOUT
 * requiring React rendering or server calls. They combine:
 *   - buildUnifiedQueue (queue construction)
 *   - RetryQueue (same-session retries)
 *   - WorkloadPolicy (batch sizing / comeback)
 *
 * They verify:
 *   1. No duplicate cards appear in any scenario
 *   2. Retries don't inflate progress counts
 *   3. Continuation chunks append correctly
 *   4. Comeback mode throttles new words
 *   5. seenWordIds exclusion is correct at continuation boundaries
 */

import { describe, it, expect } from "vitest";
import { buildUnifiedQueue, type UnifiedQueueCard } from "@/components/srs/logic/buildUnifiedQueue";
import { RetryQueue } from "@/lib/srs/retryQueue";
import { computeWorkloadPolicy, CONTINUATION_REVIEW_CHUNK, CONTINUATION_NEW_CHUNK } from "@/lib/srs/workloadPolicy";
import type { TodaySession, DueReviewItem, Word } from "@/lib/srs/types";
import type { EnabledFlashcardMode } from "@/lib/settings/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReview(id: string, rank = 1): DueReviewItem {
  return {
    id,
    word_id: id,
    user_id: "u1",
    language: "es",
    lemma: `lemma-${id}`,
    rank,
    translation: `trans-${id}`,
    definition: `def-${id}`,
    definitionEs: null,
    definitionEn: null,
    exampleSentence: `Sentence with ${id}`,
    exampleSentenceEn: `English sentence with ${id}`,
    status: "learning",
    pos: "noun",
  };
}

function makeNewWord(id: string, rank = 100): Word {
  return {
    id,
    language: "es",
    lemma: `lemma-${id}`,
    rank,
    translation: `trans-${id}`,
    definition: `def-${id}`,
    definitionEs: null,
    definitionEn: null,
    exampleSentence: `Sentence with ${id}`,
    exampleSentenceEn: `English sentence with ${id}`,
    pos: "noun",
  };
}

const CLOZE_ONLY: Record<EnabledFlashcardMode, boolean> = {
  cloze_en_to_es: true,
  cloze_es_to_en: false,
  normal_en_to_es: false,
  normal_es_to_en: false,
  audio: false,
  mcq: false,
  sentences: false,
};

function buildQueue(reviews: DueReviewItem[], newWords: Word[]) {
  return buildUnifiedQueue({ dueReviews: reviews, newWords }, CLOZE_ONLY);
}

/**
 * Simulates advancing through a queue the same way TodaySession does:
 * - Serve main queue cards in order
 * - After each answer, check retry queue
 * - When main queue exhausted, force-dequeue remaining retries
 *
 * Returns { servedCards, mainCompletedCount, retryCount } for verification.
 */
function simulateSession(
  queue: UnifiedQueueCard[],
  incorrectIds: Set<string> = new Set(),
) {
  const rq = new RetryQueue<UnifiedQueueCard>();
  const servedCards: { id: string; source: "main" | "retry" }[] = [];
  const seenWordIds = new Set<string>();
  let mainIndex = 0;
  let mainCompletedCount = 0;
  let retryServedCount = 0;

  function serveCard(card: UnifiedQueueCard, source: "main" | "retry") {
    servedCards.push({ id: card.id, source });
    seenWordIds.add(card.id);
    rq.recordAnswer();

    if (incorrectIds.has(card.id)) {
      rq.enqueue(card);
    }

    if (source === "main") {
      mainCompletedCount++;
    } else {
      retryServedCount++;
    }
  }

  while (true) {
    // Check for due retry
    const dueRetry = rq.dequeue();
    if (dueRetry) {
      serveCard(dueRetry.card, "retry");
      continue;
    }

    // Serve next main card
    if (mainIndex < queue.length) {
      serveCard(queue[mainIndex], "main");
      mainIndex++;
      continue;
    }

    // All main cards exhausted — flush stranded retries via forceDequeue
    // (mirrors TodaySession: rq.dequeue() ?? rq.forceDequeue())
    if (rq.hasPending) {
      const forced = rq.dequeue() ?? rq.forceDequeue();
      if (forced) {
        serveCard(forced.card, "retry");
        continue;
      }
    }

    break;
  }

  return { servedCards, mainCompletedCount, retryServedCount, seenWordIds };
}

// ---------------------------------------------------------------------------
// Part 1: No duplicate cards in initial queue
// ---------------------------------------------------------------------------
describe("no duplicates in initial queue", () => {
  it("10 reviews + 5 new words: all unique IDs", () => {
    const reviews = Array.from({ length: 10 }, (_, i) => makeReview(`r${i}`));
    const newWords = Array.from({ length: 5 }, (_, i) => makeNewWord(`n${i}`));
    const { queue } = buildQueue(reviews, newWords);

    const ids = queue.map((c) => c.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

// ---------------------------------------------------------------------------
// Part 2: Retries don't inflate mainCompletedCount
// ---------------------------------------------------------------------------
describe("retries don't inflate progress", () => {
  it("3 incorrect out of 10: mainCompletedCount is exactly 10", () => {
    const reviews = Array.from({ length: 10 }, (_, i) => makeReview(`r${i}`));
    const { queue } = buildQueue(reviews, []);
    const incorrectIds = new Set(["r2", "r5", "r8"]);

    const result = simulateSession(queue, incorrectIds);

    // mainCompletedCount should be exactly the main queue size
    expect(result.mainCompletedCount).toBe(10);
    // Retries were served but didn't count toward main completion
    expect(result.retryServedCount).toBeGreaterThan(0);
    // Total served includes both main and retries
    expect(result.servedCards.length).toBe(10 + result.retryServedCount);
  });

  it("all 5 cards incorrect: mainCompletedCount stays 5", () => {
    const reviews = Array.from({ length: 5 }, (_, i) => makeReview(`r${i}`));
    const { queue } = buildQueue(reviews, []);
    const allIncorrect = new Set(queue.map((c) => c.id));

    const result = simulateSession(queue, allIncorrect);

    expect(result.mainCompletedCount).toBe(5);
    // Each card retried up to MAX_RETRIES(2) times
    expect(result.retryServedCount).toBeLessThanOrEqual(5 * 2);
  });
});

// ---------------------------------------------------------------------------
// Part 3: Continuation: seenWordIds correct at boundary
// ---------------------------------------------------------------------------
describe("continuation: seenWordIds at boundary", () => {
  it("after initial queue, seenWordIds contains all card IDs", () => {
    const reviews = Array.from({ length: 8 }, (_, i) => makeReview(`r${i}`));
    const newWords = Array.from({ length: 3 }, (_, i) => makeNewWord(`n${i}`));
    const { queue } = buildQueue(reviews, newWords);

    const result = simulateSession(queue);

    // All initial card IDs should be in seenWordIds
    for (const card of queue) {
      expect(result.seenWordIds.has(card.id)).toBe(true);
    }
  });

  it("continuation chunk IDs must not overlap with initial queue IDs", () => {
    // Simulate: initial queue served, then a "continuation chunk" arrives
    const initialReviews = Array.from({ length: 5 }, (_, i) => makeReview(`init-${i}`));
    const { queue: initialQueue } = buildQueue(initialReviews, []);

    const initialResult = simulateSession(initialQueue);
    const seenIds = initialResult.seenWordIds;

    // Simulate server returning continuation chunk (these should be DIFFERENT IDs)
    const continuationReviews = Array.from({ length: CONTINUATION_REVIEW_CHUNK }, (_, i) =>
      makeReview(`cont-${i}`),
    );
    const { queue: contQueue } = buildQueue(continuationReviews, []);

    // Verify no overlap
    for (const card of contQueue) {
      expect(seenIds.has(card.id)).toBe(false);
    }

    // Simulate serving continuation
    const allCards = [...initialQueue, ...contQueue];
    const fullResult = simulateSession(allCards);

    // All cards should now be in seenWordIds
    expect(fullResult.seenWordIds.size).toBe(initialQueue.length + contQueue.length);
  });

  it("repeated continuation: cumulative seenWordIds grows correctly", () => {
    const seenIds = new Set<string>();

    // Round 1: initial queue
    const round1 = Array.from({ length: 5 }, (_, i) => makeReview(`r1-${i}`));
    const { queue: q1 } = buildQueue(round1, []);
    const r1 = simulateSession(q1);
    r1.seenWordIds.forEach((id) => seenIds.add(id));
    expect(seenIds.size).toBe(5);

    // Round 2: continuation
    const round2 = Array.from({ length: CONTINUATION_REVIEW_CHUNK }, (_, i) => makeReview(`r2-${i}`));
    const { queue: q2 } = buildQueue(round2, []);
    const allQ2 = [...q1, ...q2];
    const r2 = simulateSession(allQ2);
    r2.seenWordIds.forEach((id) => seenIds.add(id));
    expect(seenIds.size).toBe(5 + CONTINUATION_REVIEW_CHUNK);

    // Round 3: another continuation
    const round3 = Array.from({ length: CONTINUATION_REVIEW_CHUNK }, (_, i) => makeReview(`r3-${i}`));
    const { queue: q3 } = buildQueue(round3, []);
    const allQ3 = [...allQ2, ...q3];
    const r3 = simulateSession(allQ3);
    r3.seenWordIds.forEach((id) => seenIds.add(id));
    expect(seenIds.size).toBe(5 + CONTINUATION_REVIEW_CHUNK * 2);

    // No duplicates in the entire set
    const allIds = [...q1, ...q2, ...q3].map((c) => c.id);
    expect(allIds.length).toBe(new Set(allIds).size);
  });
});

// ---------------------------------------------------------------------------
// Part 4: Comeback mode: new words throttled initially
// ---------------------------------------------------------------------------
describe("comeback mode: new words throttled", () => {
  it("comeback limits initial new words to 3", () => {
    const policy = computeWorkloadPolicy({
      p50ReviewMs: 18_000,
      daysSinceLastSession: 14,
      overdueCount: 100,
      scheduledNewCount: 10,
    });
    expect(policy.isComeback).toBe(true);
    expect(policy.recommendedNewWords).toBe(3);
  });

  it("continuation new-word chunk is NOT throttled by comeback", () => {
    // After initial batch, continuation always offers CONTINUATION_NEW_CHUNK
    // This is by design: no hard ceiling
    const policy = computeWorkloadPolicy({
      p50ReviewMs: 18_000,
      daysSinceLastSession: 14,
      overdueCount: 100,
      scheduledNewCount: 10,
    });

    expect(policy.continuationNewChunk).toBe(CONTINUATION_NEW_CHUNK);
    // The chunk size is constant regardless of comeback status
    expect(policy.continuationNewChunk).toBeGreaterThan(policy.recommendedNewWords);
  });

  it("normal mode does not throttle new words", () => {
    const policy = computeWorkloadPolicy({
      p50ReviewMs: 18_000,
      daysSinceLastSession: 1,
      overdueCount: 5,
      scheduledNewCount: 10,
    });
    expect(policy.isComeback).toBe(false);
    expect(policy.recommendedNewWords).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Part 5: Retry queue + continuation interaction
// ---------------------------------------------------------------------------
describe("retries don't block or corrupt continuation", () => {
  it("session with retries: all unique cards served, correct counts", () => {
    const reviews = Array.from({ length: 8 }, (_, i) => makeReview(`r${i}`));
    const newWords = Array.from({ length: 2 }, (_, i) => makeNewWord(`n${i}`));
    const { queue } = buildQueue(reviews, newWords);

    // 3 incorrect cards that will be retried
    const incorrectIds = new Set(["r1", "r4", "r7"]);
    const result = simulateSession(queue, incorrectIds);

    // Main completed = all 10 cards from main queue
    expect(result.mainCompletedCount).toBe(10);

    // Each incorrect card retried up to 2 times
    // Total retries served: 3 cards * up to 2 retries each
    expect(result.retryServedCount).toBeGreaterThan(0);
    expect(result.retryServedCount).toBeLessThanOrEqual(6);

    // All 10 unique card IDs seen
    expect(result.seenWordIds.size).toBe(10);
  });

  it("exhausted retry card (MAX_RETRIES): not served again", () => {
    // Need enough cards after "stubborn" to meet RETRY_GAP(5) twice for 2 retries.
    // stubborn first, then 12 filler cards so both retry gaps can be satisfied.
    const reviews = [
      makeReview("stubborn"),
      ...Array.from({ length: 12 }, (_, i) => makeReview(`r${i}`)),
    ];
    const { queue } = buildQueue(reviews, []);

    // Only "stubborn" is always incorrect
    const result = simulateSession(queue, new Set(["stubborn"]));

    // Served once from main, then up to MAX_RETRIES(2) from retry = 3 total
    const stubbornCount = result.servedCards.filter((c) => c.id === "stubborn").length;
    expect(stubbornCount).toBe(3); // 1 main + 2 retries
  });
});

// ---------------------------------------------------------------------------
// Part 6: Progress bar semantics (unified cap model)
// ---------------------------------------------------------------------------
// Under the unified cap, the React component ends the session when
// totalAnswered >= dailyLimit. Retries count toward the cap. The bar uses:
//   progressTotal  = dailyLimit (committed target)
//   completedCount = normalizedInitialCompleted + totalAnswered, clamped to total
//   barWidthPercent = min(100, 100 * completedCount / progressTotal)
// These tests model the derivation directly rather than simulating React state.
describe("progress tracking semantics (unified cap)", () => {
  function deriveProgress(args: {
    dailyLimit: number;
    normalizedInitialCompleted?: number;
    totalAnswered: number;
    allExhausted?: boolean;
    totalDelivered?: number;
  }) {
    const init = args.normalizedInitialCompleted ?? 0;
    const progressTotal = args.allExhausted
      ? Math.max(1, init + (args.totalDelivered ?? 0))
      : Math.max(1, args.dailyLimit);
    const completedCount = Math.min(progressTotal, init + args.totalAnswered);
    const progressPercent = (100 * completedCount) / progressTotal;
    const barWidthPercent = Math.min(100, progressPercent);
    return { progressTotal, completedCount, progressPercent, barWidthPercent };
  }

  it("progressTotal equals committed target, not queue length", () => {
    // dailyLimit=10, user answers 5: bar reads 5/10
    const p = deriveProgress({ dailyLimit: 10, totalAnswered: 5 });
    expect(p.progressTotal).toBe(10);
    expect(p.completedCount).toBe(5);
    expect(p.progressPercent).toBe(50);
    expect(p.barWidthPercent).toBe(50);
  });

  it("retries count toward completedCount (submissions-based)", () => {
    // 5 mains + 5 retries = 10 submissions → session ends via cap
    const p = deriveProgress({ dailyLimit: 10, totalAnswered: 10 });
    expect(p.progressTotal).toBe(10);
    expect(p.completedCount).toBe(10);
    expect(p.progressPercent).toBe(100);
  });

  it("cap clamps completedCount at progressTotal even if totalAnswered would exceed", () => {
    // Defensive: cap in React ends session at >= dailyLimit, but the clamp
    // ensures the UI never shows an overflow if some edge case overshoots.
    const p = deriveProgress({ dailyLimit: 10, totalAnswered: 14 });
    expect(p.completedCount).toBe(10);
    expect(p.barWidthPercent).toBe(100);
    expect(p.progressPercent).toBeGreaterThanOrEqual(100);
  });

  it("resume: normalizedInitialCompleted bumps the starting point", () => {
    // Session resumed with 3 already done; user does 4 more this round
    const p = deriveProgress({
      dailyLimit: 10,
      normalizedInitialCompleted: 3,
      totalAnswered: 4,
    });
    expect(p.progressTotal).toBe(10);
    expect(p.completedCount).toBe(7);
    expect(p.progressPercent).toBe(70);
  });

  it("allExhausted shrinks progressTotal to what was actually delivered", () => {
    // dailyLimit=10, server only delivered 7 cards before exhausting supply.
    // progressTotal collapses to actual so bar ends at 100% instead of 7/10.
    const p = deriveProgress({
      dailyLimit: 10,
      totalAnswered: 7,
      allExhausted: true,
      totalDelivered: 7,
    });
    expect(p.progressTotal).toBe(7);
    expect(p.completedCount).toBe(7);
    expect(p.barWidthPercent).toBe(100);
  });

  it("retry-queue pure algorithm (simulateSession) still models main-card counts", () => {
    // Sanity: the simulateSession helper is a retry-queue unit tester, not a
    // React cap simulator. It continues to report mainCompletedCount against
    // the main queue size, unchanged by the cap rewrite.
    const initialReviews = Array.from({ length: 10 }, (_, i) => makeReview(`r${i}`));
    const { queue: initialQueue } = buildQueue(initialReviews, []);
    const continuationReviews = Array.from({ length: CONTINUATION_REVIEW_CHUNK }, (_, i) =>
      makeReview(`c${i}`),
    );
    const { queue: contQueue } = buildQueue(continuationReviews, []);

    const allCards = [...initialQueue, ...contQueue];
    const result = simulateSession(allCards);
    expect(result.mainCompletedCount).toBe(allCards.length);
  });
});

// ---------------------------------------------------------------------------
// Part 7: Edge cases / adversarial
// ---------------------------------------------------------------------------
describe("adversarial scenarios", () => {
  it("only 1 card available: session still works", () => {
    const { queue } = buildQueue([makeReview("lone")], []);
    const result = simulateSession(queue);

    expect(result.mainCompletedCount).toBe(1);
    expect(result.seenWordIds.size).toBe(1);
  });

  it("only 1 card, incorrect: retry is force-flushed, not stranded", () => {
    const { queue } = buildQueue([makeReview("solo")], []);
    const result = simulateSession(queue, new Set(["solo"]));

    // 1 main + 2 force-flushed retries (MAX_RETRIES=2)
    expect(result.mainCompletedCount).toBe(1);
    expect(result.retryServedCount).toBe(2);
    const soloCount = result.servedCards.filter((c) => c.id === "solo").length;
    expect(soloCount).toBe(3); // 1 main + 2 retries
    // Only 1 unique card
    expect(result.seenWordIds.size).toBe(1);
  });

  it("only 2 cards, both incorrect: retries force-flushed correctly", () => {
    const { queue } = buildQueue([makeReview("a"), makeReview("b")], []);
    const result = simulateSession(queue, new Set(["a", "b"]));

    // 2 main + up to 4 retries (2 cards * 2 retries each)
    expect(result.mainCompletedCount).toBe(2);
    expect(result.retryServedCount).toBe(4); // exact: both cards retried twice
    // Only 2 unique cards
    expect(result.seenWordIds.size).toBe(2);
  });

  it("3 cards, 1 incorrect: retry force-flushed, progress correct", () => {
    const { queue } = buildQueue(
      [makeReview("ok1"), makeReview("bad"), makeReview("ok2")],
      [],
    );
    const result = simulateSession(queue, new Set(["bad"]));

    expect(result.mainCompletedCount).toBe(3);
    // "bad" retried exactly 2 times (MAX_RETRIES)
    const badCount = result.servedCards.filter((c) => c.id === "bad").length;
    expect(badCount).toBe(3); // 1 main + 2 retries
    expect(result.seenWordIds.size).toBe(3);
  });

  it("empty initial queue and empty continuation: no crash", () => {
    const { queue } = buildQueue([], []);
    const result = simulateSession(queue);

    expect(result.mainCompletedCount).toBe(0);
    expect(result.retryServedCount).toBe(0);
    expect(result.seenWordIds.size).toBe(0);
  });

  it("all items mature and stable: normal mode, no comeback", () => {
    const policy = computeWorkloadPolicy({
      p50ReviewMs: 15_000,
      daysSinceLastSession: 1,
      overdueCount: 3,
      scheduledNewCount: 5,
    });
    expect(policy.isComeback).toBe(false);
    expect(policy.recommendedReviews).toBeGreaterThanOrEqual(12);
  });

  it("all items overdue and learning: comeback triggers on count", () => {
    const policy = computeWorkloadPolicy({
      p50ReviewMs: 18_000,
      daysSinceLastSession: 2,
      overdueCount: 100,
      scheduledNewCount: 5,
    });
    expect(policy.isComeback).toBe(true);
    expect(policy.recommendedNewWords).toBeLessThanOrEqual(3);
  });

  it("missing review telemetry: p50 null, fallback works", () => {
    const policy = computeWorkloadPolicy({
      p50ReviewMs: null,
      daysSinceLastSession: 3,
      overdueCount: 15,
      scheduledNewCount: 5,
    });
    expect(policy.p50ReviewMs).toBe(18_000);
    expect(policy.recommendedReviews).toBe(20);
    expect(policy.isComeback).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Part 8: Retry flush correctness
// ---------------------------------------------------------------------------
describe("retry flush correctness", () => {
  it("force-flushed retries do not inflate mainCompletedCount", () => {
    // Single card, always incorrect — all retries are force-flushed
    const { queue } = buildQueue([makeReview("x")], []);
    const result = simulateSession(queue, new Set(["x"]));

    // mainCompletedCount must remain 1 (only the original main serve)
    expect(result.mainCompletedCount).toBe(1);
    // retryServedCount = 2 (MAX_RETRIES)
    expect(result.retryServedCount).toBe(2);
    // Total served = 3 but progress = 1
    expect(result.servedCards.length).toBe(3);
  });

  it("force-flushed retries produce no duplicate IDs in seenWordIds", () => {
    const { queue } = buildQueue(
      [makeReview("a"), makeReview("b")],
      [],
    );
    const result = simulateSession(queue, new Set(["a", "b"]));

    // seenWordIds should have exactly 2 entries despite retries
    expect(result.seenWordIds.size).toBe(2);
    expect(result.seenWordIds.has("a")).toBe(true);
    expect(result.seenWordIds.has("b")).toBe(true);
  });

  it("retry flush respects MAX_RETRIES: card not served more than 3 times total", () => {
    const { queue } = buildQueue([makeReview("stubborn")], []);
    const result = simulateSession(queue, new Set(["stubborn"]));

    const total = result.servedCards.filter((c) => c.id === "stubborn").length;
    expect(total).toBe(3); // 1 main + 2 retries = MAX_RETRIES + 1
  });

  it("4 cards, all incorrect: all get exact 2 retries via flush", () => {
    const reviews = Array.from({ length: 4 }, (_, i) => makeReview(`c${i}`));
    const { queue } = buildQueue(reviews, []);
    const allIncorrect = new Set(queue.map((c) => c.id));
    const result = simulateSession(queue, allIncorrect);

    expect(result.mainCompletedCount).toBe(4);
    expect(result.retryServedCount).toBe(8); // 4 cards * 2 retries
    for (const card of queue) {
      const count = result.servedCards.filter((c) => c.id === card.id).length;
      expect(count).toBe(3); // 1 main + 2 retries
    }
  });
});
