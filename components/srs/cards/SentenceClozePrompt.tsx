"use client";

import { Fragment } from "react";
import { SENTENCE_CLOZE_BLANK_TOKEN } from "@/components/srs/logic/buildSentencePrompt";

export function SentenceClozePrompt({
  sentence,
  className = "mt-4 text-xl font-medium tracking-tight text-zinc-900 dark:text-zinc-100",
}: {
  sentence: string;
  className?: string;
}) {
  const parts = sentence.split(SENTENCE_CLOZE_BLANK_TOKEN);

  return (
    <p className={className}>
      {parts.map((part, index) => (
        <Fragment key={`${part}-${index}`}>
          {index > 0 ? <SentenceBlank /> : null}
          {part}
        </Fragment>
      ))}
    </p>
  );
}

function SentenceBlank() {
  return (
    <span
      aria-hidden="true"
      className="mx-1 inline-flex min-w-16 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-100 px-3 py-1 align-middle text-sm font-medium text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
    >
      &nbsp;
    </span>
  );
}
