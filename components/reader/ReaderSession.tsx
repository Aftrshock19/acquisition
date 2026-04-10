"use client";

import { useEffect, useMemo, useRef } from "react";
import { markReadingOpened } from "@/app/actions/srs";
import { ReaderNextStepCard } from "@/components/reader/ReaderNextStepCard";
import { InteractiveText } from "@/components/interactive-text/InteractiveText";
import { InteractiveTextProvider } from "@/components/interactive-text/InteractiveTextProvider";
import { toReadingBlocks } from "@/lib/loop/reader";
import { tokenize } from "@/lib/reader/tokenize";
import type { ReaderText } from "@/lib/reader/types";

type ReaderSessionProps = {
  text: ReaderText;
  initialSavedWordIds: string[];
  initialSavedLemmas: string[];
  listeningAssetId: string | null;
  readingDone: boolean;
  listeningDone: boolean;
};

export function ReaderSession({
  text,
  initialSavedWordIds,
  initialSavedLemmas,
  listeningAssetId,
  readingDone,
  listeningDone,
}: ReaderSessionProps) {
  const blocks = useMemo(
    () => toReadingBlocks(text.content).map((block) => tokenize(block)),
    [text.content],
  );
  const activeStartedAtRef = useRef<number | null>(null);
  const accumulatedMsRef = useRef(0);

  useEffect(() => {
    void markReadingOpened({ textId: text.id });
  }, [text.id]);

  useEffect(() => {
    const activate = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      if (activeStartedAtRef.current === null) {
        activeStartedAtRef.current = Date.now();
      }
    };
    const deactivate = () => {
      if (activeStartedAtRef.current === null) {
        return;
      }

      accumulatedMsRef.current += Date.now() - activeStartedAtRef.current;
      activeStartedAtRef.current = null;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        activate();
        return;
      }

      deactivate();
    };

    handleVisibilityChange();
    window.addEventListener("focus", activate);
    window.addEventListener("blur", deactivate);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      deactivate();
      window.removeEventListener("focus", activate);
      window.removeEventListener("blur", deactivate);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  function getReadingTimeSeconds() {
    const liveMs =
      activeStartedAtRef.current === null ? 0 : Date.now() - activeStartedAtRef.current;
    return Math.max(0, Math.round((accumulatedMsRef.current + liveMs) / 1000));
  }

  return (
    <>
      <InteractiveTextProvider
        lang={text.lang}
        initialSavedWordIds={initialSavedWordIds}
        initialSavedLemmas={initialSavedLemmas}
        interactionContext="reader"
        textId={text.id}
        saveSource="reader"
        trackReaderTapExposure
      >
        <section className="app-card-strong flex flex-col gap-6 p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="rounded-full border border-zinc-200 px-3 py-1 dark:border-zinc-800">
              {text.lang.toUpperCase()}
            </span>
            <span>Saved words stay highlighted in this text.</span>
          </div>

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

      <ReaderNextStepCard
        textId={text.id}
        listeningAssetId={listeningAssetId}
        readingDone={readingDone}
        listeningDone={listeningDone}
        getReadingTimeSeconds={getReadingTimeSeconds}
      />
    </>
  );
}
