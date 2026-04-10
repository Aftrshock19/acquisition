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
});
