import { describe, expect, it } from "vitest";
import {
  getNormalReviewOutcome,
  getNormalReviewResultLabel,
} from "@/lib/srs/normalReview";

describe("normal review mapping", () => {
  it("maps I missed it to the existing again path and retry flow", () => {
    expect(getNormalReviewOutcome("missed")).toEqual({
      grade: "again",
      correct: false,
      retry: true,
      resultLabel: "I missed it",
      userAnswer: "[self-rated:missed]",
    });
  });

  it("maps I got it to the existing good path without a retry", () => {
    expect(getNormalReviewOutcome("got_it")).toEqual({
      grade: "good",
      correct: true,
      retry: false,
      resultLabel: "I got it",
      userAnswer: "[self-rated:got_it]",
    });
  });

  it("only exposes binary result labels for the normal grades still used by the UI", () => {
    expect(getNormalReviewResultLabel("again")).toBe("I missed it");
    expect(getNormalReviewResultLabel("good")).toBe("I got it");
    expect(getNormalReviewResultLabel("hard")).toBeNull();
    expect(getNormalReviewResultLabel("easy")).toBeNull();
  });
});
