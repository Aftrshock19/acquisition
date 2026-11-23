import { describe, expect, it } from "vitest";
import { getExtendedSessionCap, shouldPersistFlashcardsSkip } from "./sessionCap";

const doneBelowTarget = {
  phase: "done",
  unlimitedMode: false,
  loadingMore: false,
  willAutoLoad: false,
  attempts: 23,
  dailyLimit: 30,
};

describe("shouldPersistFlashcardsSkip", () => {
  it("persists when a manual target outruns the word supply", () => {
    // Target 30, only 20 words: 20 main + 3 retries, auto-load found nothing.
    expect(shouldPersistFlashcardsSkip(doneBelowTarget)).toBe(true);
  });

  it("does not persist once the target is met (server already left flashcards)", () => {
    expect(shouldPersistFlashcardsSkip({ ...doneBelowTarget, attempts: 30 })).toBe(false);
    expect(shouldPersistFlashcardsSkip({ ...doneBelowTarget, attempts: 31 })).toBe(false);
  });

  it("waits while the manual auto-load is still fetching the next chunk", () => {
    expect(shouldPersistFlashcardsSkip({ ...doneBelowTarget, willAutoLoad: true })).toBe(false);
    expect(shouldPersistFlashcardsSkip({ ...doneBelowTarget, loadingMore: true })).toBe(false);
  });

  it("only fires on the practice-complete screen, never mid-card or in unlimited mode", () => {
    expect(shouldPersistFlashcardsSkip({ ...doneBelowTarget, phase: "prompt" })).toBe(false);
    expect(shouldPersistFlashcardsSkip({ ...doneBelowTarget, phase: "feedback" })).toBe(false);
    expect(shouldPersistFlashcardsSkip({ ...doneBelowTarget, unlimitedMode: true })).toBe(false);
  });
});

describe("getExtendedSessionCap", () => {
  it("allows exactly `count` more answers after the cap was reached", () => {
    expect(getExtendedSessionCap(20, 20, 10)).toBe(30);
  });

  it("counts from attempts when they already passed the cap", () => {
    expect(getExtendedSessionCap(20, 24, 5)).toBe(29);
  });

  it("never lowers the cap", () => {
    expect(getExtendedSessionCap(30, 12, 5)).toBe(30);
    expect(getExtendedSessionCap(30, 30, -3)).toBe(30);
  });
});
