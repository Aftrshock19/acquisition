"use client";

import { useMemo } from "react";
import { InteractiveText } from "@/components/interactive-text/InteractiveText";
import { InteractiveTextProvider } from "@/components/interactive-text/InteractiveTextProvider";
import { toReadingBlocks } from "@/lib/loop/reader";
import { tokenize } from "@/lib/reader/tokenize";
import type { ReaderText } from "@/lib/reader/types";

type ReaderViewProps = {
  text: ReaderText;
  initialSavedWordIds: string[];
  initialSavedLemmas: string[];
};

export function ReaderView({
  text,
  initialSavedWordIds,
  initialSavedLemmas,
}: ReaderViewProps) {
  const blocks = useMemo(
    () => toReadingBlocks(text.content).map((block) => tokenize(block)),
    [text.content],
  );

  return (
    <InteractiveTextProvider
      lang={text.lang}
      initialSavedWordIds={initialSavedWordIds}
      initialSavedLemmas={initialSavedLemmas}
      interactionContext="reader"
    >
      <section className="app-card-strong flex flex-col gap-6 p-5 sm:p-7">
        <div className="flex flex-col gap-5 text-lg leading-9 text-zinc-900 dark:text-zinc-100 sm:text-xl sm:leading-10">
          {blocks.map((block, blockIndex) => (
            <p
              key={`${blockIndex}-${block[0]?.surface ?? "empty"}`}
              className="whitespace-pre-wrap"
            >
              <InteractiveText
                tokens={block}
                tokenKeyPrefix={`reader-block-${blockIndex}`}
              />
            </p>
          ))}
        </div>
      </section>
    </InteractiveTextProvider>
  );
}
