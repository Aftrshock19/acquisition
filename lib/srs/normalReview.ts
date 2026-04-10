import type { Grade } from "@/lib/srs/types";

export type NormalReviewChoice = "missed" | "got_it";

type NormalReviewOutcome = {
  grade: Extract<Grade, "again" | "good">;
  correct: boolean;
  retry: boolean;
  resultLabel: string;
  userAnswer: string;
};

export function getNormalReviewOutcome(
  choice: NormalReviewChoice,
): NormalReviewOutcome {
  if (choice === "missed") {
    return {
      grade: "again",
      correct: false,
      retry: true,
      resultLabel: "I missed it",
      userAnswer: "[self-rated:missed]",
    };
  }

  return {
    grade: "good",
    correct: true,
    retry: false,
    resultLabel: "I got it",
    userAnswer: "[self-rated:got_it]",
  };
}

export function getNormalReviewResultLabel(grade?: Grade | null) {
  if (grade === "again") {
    return "I missed it";
  }

  if (grade === "good") {
    return "I got it";
  }

  return null;
}
