"use client";

import { useState } from "react";
import type { ReadingQuestion } from "@/lib/reading/types";

type ReadingQuizProps = {
  questions: ReadingQuestion[];
  onComplete: () => void;
};

export function ReadingQuiz({ questions, onComplete }: ReadingQuizProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const question = questions[currentIndex];

  if (finished) {
    return (
      <section className="app-card-strong flex flex-col gap-5 p-5 sm:p-7">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">
            Comprehension
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            {score === questions.length ? "Perfect score" : "Quiz complete"}
          </h2>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            You got {score} out of {questions.length} right.
          </p>
        </div>
        <button type="button" onClick={onComplete} className="app-button self-start">
          Continue
        </button>
      </section>
    );
  }

  if (!question) {
    onComplete();
    return null;
  }

  const isAnswered = selectedOption !== null;
  const isCorrect = selectedOption === question.correctOptionIndex;

  function handleSelect(optionIndex: number) {
    if (isAnswered) return;
    setSelectedOption(optionIndex);
    if (optionIndex === question.correctOptionIndex) {
      setScore((s) => s + 1);
    }
  }

  function handleNext() {
    setSelectedOption(null);
    if (currentIndex + 1 >= questions.length) {
      setFinished(true);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }

  return (
    <section className="app-card-strong flex flex-col gap-5 p-5 sm:p-7">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">
            Comprehension
          </p>
          <p className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
            {currentIndex + 1} / {questions.length}
          </p>
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          {question.questionEn}
        </h2>
      </div>

      <div className="grid gap-2">
        {question.optionsEn.map((option, i) => {
          let style =
            "rounded-lg border px-4 py-3 text-left text-sm transition";

          if (!isAnswered) {
            style +=
              " border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800";
          } else if (i === question.correctOptionIndex) {
            style +=
              " border-emerald-400 bg-emerald-50 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-100";
          } else if (i === selectedOption) {
            style +=
              " border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200";
          } else {
            style +=
              " border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-500";
          }

          return (
            <button
              key={i}
              type="button"
              onClick={() => handleSelect(i)}
              disabled={isAnswered}
              className={style}
            >
              {option}
            </button>
          );
        })}
      </div>

      {isAnswered ? (
        <div className="flex items-center justify-between">
          <p
            className={`text-sm font-medium ${
              isCorrect
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-red-700 dark:text-red-300"
            }`}
          >
            {isCorrect ? "Correct" : "Not quite"}
          </p>
          <button
            type="button"
            onClick={handleNext}
            className="app-button"
          >
            {currentIndex + 1 >= questions.length ? "See results" : "Next"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
