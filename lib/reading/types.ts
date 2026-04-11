/** A comprehension question attached to a text (reading passage). */
export type ReadingQuestion = {
  id: string;
  questionIndex: number;
  questionType: "gist" | "detail" | "inferential";
  questionEn: string;
  optionsEn: string[];
  correctOptionIndex: number;
};

/** Minimal passage row for index / list views. */
export type ReadingPassageSummary = {
  id: string;
  stage: string;
  stageIndex: number;
  displayLabel: string;
  difficultyCefr: string;
  mode: "short" | "medium" | "long" | "very_long";
  passageNumber: number;
  title: string;
  wordCount: number | null;
  estimatedMinutes: number | null;
};

/** Full passage with content and questions for the reader. */
export type ReadingPassage = ReadingPassageSummary & {
  content: string;
  questions: ReadingQuestion[];
};

/** A stage group for the passage index page. */
export type ReadingStageGroup = {
  stage: string;
  stageIndex: number;
  displayLabel: string;
  modes: {
    mode: string;
    passages: ReadingPassageSummary[];
  }[];
};
