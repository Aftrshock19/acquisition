import { describe, it, expect } from "vitest";
import { RetryQueue, RETRY_GAP, MAX_RETRIES } from "./retryQueue";

type TestCard = { id: string };

function makeCard(id: string): TestCard {
  return { id };
}

describe("RetryQueue", () => {
  describe("basic enqueue/dequeue", () => {
    it("enqueues a card and makes it available after RETRY_GAP answers", () => {
      const rq = new RetryQueue<TestCard>();
      const card = makeCard("a");

      rq.enqueue(card);
      expect(rq.pendingCount).toBe(1);

      // Not ready yet
      for (let i = 0; i < RETRY_GAP - 1; i++) {
        rq.recordAnswer();
        expect(rq.peek()).toBeNull();
      }

      // Ready after RETRY_GAP answers
      rq.recordAnswer();
      const entry = rq.dequeue();
      expect(entry).not.toBeNull();
      expect(entry!.card.id).toBe("a");
      expect(entry!.retryCount).toBe(1);
      expect(rq.pendingCount).toBe(0);
    });
  });

  describe("incorrect card reappears after 5 answer events, not 90 seconds", () => {
    it("surfaces card exactly after RETRY_GAP (5) answers", () => {
      const rq = new RetryQueue<TestCard>();
      const card = makeCard("word1");

      rq.enqueue(card);

      // Simulate 4 answer events — card should not be ready
      for (let i = 0; i < 4; i++) {
        rq.recordAnswer();
      }
      expect(rq.peek()).toBeNull();

      // 5th answer event — card should be ready
      rq.recordAnswer();
      expect(rq.peek()).not.toBeNull();
      expect(rq.peek()!.card.id).toBe("word1");
    });
  });

  describe("max 2 same-session retries", () => {
    it("allows exactly MAX_RETRIES (2) retries", () => {
      const rq = new RetryQueue<TestCard>();
      const card = makeCard("stubborn");

      // First retry
      expect(rq.enqueue(card)).toBe(true);
      for (let i = 0; i < RETRY_GAP; i++) rq.recordAnswer();
      rq.dequeue();

      // Second retry
      expect(rq.enqueue(card)).toBe(true);
      for (let i = 0; i < RETRY_GAP; i++) rq.recordAnswer();
      rq.dequeue();

      // Third retry should be rejected
      expect(rq.enqueue(card)).toBe(false);
    });

    it("canRetry returns false after MAX_RETRIES", () => {
      const rq = new RetryQueue<TestCard>();
      const card = makeCard("x");

      rq.enqueue(card);
      for (let i = 0; i < RETRY_GAP; i++) rq.recordAnswer();
      rq.dequeue();

      rq.enqueue(card);
      for (let i = 0; i < RETRY_GAP; i++) rq.recordAnswer();
      rq.dequeue();

      expect(rq.canRetry("x")).toBe(false);
    });
  });

  describe("multiple cards interleave correctly", () => {
    it("serves cards in FIFO order based on when they become due", () => {
      const rq = new RetryQueue<TestCard>();
      const cardA = makeCard("a");
      const cardB = makeCard("b");

      // Enqueue A first
      rq.enqueue(cardA);
      // 2 answers
      rq.recordAnswer();
      rq.recordAnswer();
      // Enqueue B
      rq.enqueue(cardB);

      // A needs 3 more answers, B needs 5
      for (let i = 0; i < 3; i++) rq.recordAnswer();

      // A should be ready, B not yet
      const entryA = rq.dequeue();
      expect(entryA!.card.id).toBe("a");
      expect(rq.peek()).toBeNull();

      // 2 more answers for B
      rq.recordAnswer();
      rq.recordAnswer();

      const entryB = rq.dequeue();
      expect(entryB!.card.id).toBe("b");
    });
  });

  describe("retries do not inflate daily progress completion", () => {
    it("retry count tracks separately from answer count", () => {
      const rq = new RetryQueue<TestCard>();
      const card = makeCard("w");

      rq.enqueue(card);
      // The answer count should only increase from explicit recordAnswer calls
      expect(rq.getAnswerCount()).toBe(0);
      rq.recordAnswer();
      expect(rq.getAnswerCount()).toBe(1);

      // Dequeuing a retry does not count as an answer
      for (let i = 0; i < RETRY_GAP - 1; i++) rq.recordAnswer();
      rq.dequeue();
      expect(rq.getAnswerCount()).toBe(RETRY_GAP);
    });
  });

  describe("duplicate submit protection", () => {
    it("re-enqueuing the same card replaces the existing entry", () => {
      const rq = new RetryQueue<TestCard>();
      const card = makeCard("dup");

      rq.enqueue(card);
      expect(rq.pendingCount).toBe(1);

      // Re-enqueue should not create a duplicate
      rq.enqueue(card);
      expect(rq.pendingCount).toBe(1);
      // Retry count should increment
      expect(rq.getRetryCount("dup")).toBe(2);
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      const rq = new RetryQueue<TestCard>();
      rq.enqueue(makeCard("a"));
      rq.recordAnswer();

      rq.reset();
      expect(rq.pendingCount).toBe(0);
      expect(rq.getAnswerCount()).toBe(0);
      expect(rq.peek()).toBeNull();
    });
  });

  describe("hasPending", () => {
    it("returns false when empty", () => {
      const rq = new RetryQueue<TestCard>();
      expect(rq.hasPending).toBe(false);
    });

    it("returns true when entries exist", () => {
      const rq = new RetryQueue<TestCard>();
      rq.enqueue(makeCard("a"));
      expect(rq.hasPending).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate enqueue resets scheduling (BUG DOCUMENTATION)
  // -------------------------------------------------------------------------
  describe("duplicate enqueue resets dueAfterCount", () => {
    it("re-enqueuing a pending card pushes its due date forward", () => {
      const rq = new RetryQueue<TestCard>();
      const card = makeCard("x");

      rq.enqueue(card);
      // Card is due after 5 answers
      rq.recordAnswer(); // count=1
      rq.recordAnswer(); // count=2
      rq.recordAnswer(); // count=3

      // Card should become due at count=5. But re-enqueue now:
      rq.enqueue(card); // resets dueAfterCount to 3+5=8

      rq.recordAnswer(); // count=4
      rq.recordAnswer(); // count=5 — would have been due, but was reset

      // Card should NOT be ready yet because re-enqueue pushed it back
      expect(rq.peek()).toBeNull();

      // Need 3 more answers
      rq.recordAnswer(); // 6
      rq.recordAnswer(); // 7
      rq.recordAnswer(); // 8 — now due

      expect(rq.peek()).not.toBeNull();
      expect(rq.peek()!.card.id).toBe("x");
    });

    it("re-enqueue increments retry count even though card is replaced", () => {
      const rq = new RetryQueue<TestCard>();
      const card = makeCard("y");

      rq.enqueue(card);
      expect(rq.getRetryCount("y")).toBe(1);

      // Re-enqueue before dequeue
      rq.enqueue(card);
      expect(rq.getRetryCount("y")).toBe(2);

      // Only one entry exists
      expect(rq.pendingCount).toBe(1);

      // Third enqueue should fail (MAX_RETRIES=2 exhausted)
      expect(rq.enqueue(card)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Force-dequeue when not yet due (TodaySession exhaustion path)
  // -------------------------------------------------------------------------
  describe("force-dequeue when main queue exhausted", () => {
    it("dequeue returns null when card is not yet due", () => {
      const rq = new RetryQueue<TestCard>();
      rq.enqueue(makeCard("z"));
      // Only 2 answers, need RETRY_GAP(5)
      rq.recordAnswer();
      rq.recordAnswer();

      expect(rq.dequeue()).toBeNull();
      expect(rq.hasPending).toBe(true);
    });

    it("hasPending is true even when no card is due yet", () => {
      const rq = new RetryQueue<TestCard>();
      rq.enqueue(makeCard("a"));
      rq.enqueue(makeCard("b"));

      expect(rq.pendingCount).toBe(2);
      expect(rq.peek()).toBeNull(); // not yet due
      expect(rq.hasPending).toBe(true); // but pending
    });

    it("forceDequeue returns card even before gap is met", () => {
      const rq = new RetryQueue<TestCard>();
      rq.enqueue(makeCard("stranded"));
      rq.recordAnswer(); // only 1 answer, need RETRY_GAP(5)

      // Normal dequeue fails
      expect(rq.dequeue()).toBeNull();
      // Force-dequeue succeeds
      const entry = rq.forceDequeue();
      expect(entry).not.toBeNull();
      expect(entry!.card.id).toBe("stranded");
      expect(rq.pendingCount).toBe(0);
    });

    it("forceDequeue returns null when queue is empty", () => {
      const rq = new RetryQueue<TestCard>();
      expect(rq.forceDequeue()).toBeNull();
    });

    it("forceDequeue serves earliest-scheduled card first", () => {
      const rq = new RetryQueue<TestCard>();
      rq.enqueue(makeCard("first"));
      rq.recordAnswer();
      rq.recordAnswer();
      rq.enqueue(makeCard("second"));

      // first was enqueued at count=0, second at count=2
      const entry = rq.forceDequeue();
      expect(entry!.card.id).toBe("first");
      const entry2 = rq.forceDequeue();
      expect(entry2!.card.id).toBe("second");
    });

    it("forceDequeue works for single-card session (retry starvation fix)", () => {
      const rq = new RetryQueue<TestCard>();
      const card = makeCard("lonely");

      // Simulate: 1 card answered, marked incorrect, enqueued
      rq.recordAnswer();
      rq.enqueue(card);

      // Normal dequeue can't satisfy RETRY_GAP
      expect(rq.dequeue()).toBeNull();

      // forceDequeue rescues the stranded retry
      const entry = rq.forceDequeue();
      expect(entry).not.toBeNull();
      expect(entry!.card.id).toBe("lonely");

      // Enqueue again (retry 2)
      rq.recordAnswer();
      rq.enqueue(card);
      const entry2 = rq.forceDequeue();
      expect(entry2).not.toBeNull();

      // Third enqueue should be rejected (MAX_RETRIES=2)
      expect(rq.enqueue(card)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Stress: many cards and rapid events
  // -------------------------------------------------------------------------
  describe("stress scenarios", () => {
    it("10 cards enqueued at different times all become available in order", () => {
      const rq = new RetryQueue<TestCard>();
      const ids: string[] = [];

      for (let i = 0; i < 10; i++) {
        const card = makeCard(`card-${i}`);
        ids.push(card.id);
        rq.enqueue(card);
        rq.recordAnswer(); // stagger enqueue times
      }

      expect(rq.pendingCount).toBe(10);

      // Fast-forward enough answers to make all due
      for (let i = 0; i < RETRY_GAP + 10; i++) {
        rq.recordAnswer();
      }

      // Dequeue all — should come in enqueue order (FIFO by dueAfterCount)
      const dequeued: string[] = [];
      for (let i = 0; i < 10; i++) {
        const entry = rq.dequeue();
        expect(entry).not.toBeNull();
        dequeued.push(entry!.card.id);
      }
      // All cards were enqueued 1 answer apart, so they become due 1 answer
      // apart. With enough answers, they come out in order.
      expect(dequeued).toEqual(ids);
    });

    it("rapid 20 answers with 0 cards enqueued does not crash", () => {
      const rq = new RetryQueue<TestCard>();
      for (let i = 0; i < 20; i++) {
        rq.recordAnswer();
      }
      expect(rq.pendingCount).toBe(0);
      expect(rq.dequeue()).toBeNull();
    });
  });

  describe("serialize / hydrate round trip", () => {
    it("restores pending entries, retry history, and answer count", () => {
      const rq = new RetryQueue<TestCard>();
      rq.enqueue(makeCard("a"));
      rq.recordAnswer();
      rq.recordAnswer();
      rq.enqueue(makeCard("b"));
      rq.recordAnswer();

      const snapshot = JSON.parse(JSON.stringify(rq.serialize()));

      const rq2 = new RetryQueue<TestCard>();
      expect(rq2.hydrate(snapshot)).toBe(true);

      expect(rq2.pendingCount).toBe(rq.pendingCount);
      expect(rq2.getAnswerCount()).toBe(rq.getAnswerCount());
      expect(rq2.getRetryCount("a")).toBe(rq.getRetryCount("a"));
      expect(rq2.getRetryCount("b")).toBe(rq.getRetryCount("b"));
    });

    it("hydrate ignores corrupt payloads without mutating state", () => {
      const rq = new RetryQueue<TestCard>();
      rq.enqueue(makeCard("a"));
      const before = rq.pendingCount;

      expect(rq.hydrate(null)).toBe(false);
      expect(rq.hydrate({})).toBe(false);
      expect(rq.hydrate({ version: 999 })).toBe(false);
      expect(
        rq.hydrate({ version: 1, answerCount: "x", entries: [], retryHistory: [] }),
      ).toBe(false);
      expect(
        rq.hydrate({
          version: 1,
          answerCount: 0,
          entries: [{ card: { id: 123 }, retryCount: 1, dueAfterCount: 1 }],
          retryHistory: [],
        }),
      ).toBe(false);

      expect(rq.pendingCount).toBe(before);
    });

    it("hydrated queue continues to honor MAX_RETRIES", () => {
      const rq = new RetryQueue<TestCard>();
      const card = makeCard("capped");
      for (let i = 0; i < MAX_RETRIES; i++) {
        rq.enqueue(card);
        // Drain so we can re-enqueue.
        for (let j = 0; j < RETRY_GAP; j++) rq.recordAnswer();
        rq.dequeue();
      }

      const snapshot = JSON.parse(JSON.stringify(rq.serialize()));
      const rq2 = new RetryQueue<TestCard>();
      rq2.hydrate(snapshot);

      expect(rq2.canRetry("capped")).toBe(false);
      expect(rq2.enqueue(card)).toBe(false);
    });
  });
});
