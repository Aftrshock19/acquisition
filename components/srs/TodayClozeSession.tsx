"use client";

import { useCallback, useMemo, useState } from "react";
import {
  getFlashcardDebugSnapshot,
  recordReview,
  type FlashcardDebugSnapshot,
} from "@/app/actions/srs";
import { ClozeSession, type ClozeCard } from "./ClozeSession";
import type { DailySessionRow, TodaySession } from "@/lib/srs/types";

export type TodayClozeSessionProps = {
  session: TodaySession;
  dailyLimit: number;
  retryDelayMs?: number;
  showPosHint?: boolean;
  initialDailySession?: DailySessionRow | null;
  initialDebugSnapshot?: FlashcardDebugSnapshot;
};

function sessionToClozeCards(session: TodaySession): ClozeCard[] {
  const due = session.dueReviews.map((r) => ({
    id: r.word_id,
    kind: "review" as const,
    lemma: r.lemma,
    definition: r.definition ?? null,
    hint: r.pos ?? null,
    extra: r.extra,
  }));
  const newW = session.newWords.map((w) => ({
    id: w.id,
    kind: "new" as const,
    lemma: w.lemma,
    definition: w.definition ?? null,
    hint: w.pos ?? null,
    extra: w.extra,
  }));
  return [...due, ...newW];
}

export function TodayClozeSession({
  session,
  dailyLimit,
  retryDelayMs = 90000,
  showPosHint = true,
  initialDailySession = null,
  initialDebugSnapshot,
}: TodayClozeSessionProps) {
  const cards = useMemo(() => sessionToClozeCards(session), [session]);
  const [currentCard, setCurrentCard] = useState<ClozeCard | null>(cards[0] ?? null);
  const [debugSnapshot, setDebugSnapshot] = useState<FlashcardDebugSnapshot>(
    initialDebugSnapshot ?? {
      dailySession: initialDailySession,
      currentUserWord: null,
      lastReviewEvent: null,
    },
  );

  const onReview = useCallback(
    async (
      cardId: string,
      correct: boolean,
      msSpent: number,
      userAnswer: string,
      expected: string[],
    ) => {
      const result = await recordReview({
        wordId: cardId,
        correct,
        msSpent,
        userAnswer,
        expected,
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      setDebugSnapshot(result.debugSnapshot);
    },
    [],
  );

  const onCurrentCardChange = useCallback((card: ClozeCard | null) => {
    setCurrentCard(card);
    if (!card) return;

    void getFlashcardDebugSnapshot(card.id).then((snapshot) => {
      setDebugSnapshot(snapshot);
    });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <ClozeSession
        cards={cards}
        dailyLimit={dailyLimit}
        onReview={onReview}
        retryDelayMs={retryDelayMs}
        showPosHint={showPosHint}
        onCurrentCardChange={onCurrentCardChange}
      />
      <FlashcardDebugPanel currentCard={currentCard} debugSnapshot={debugSnapshot} />
    </div>
  );
}

function FlashcardDebugPanel({
  currentCard,
  debugSnapshot,
}: {
  currentCard: ClozeCard | null;
  debugSnapshot: FlashcardDebugSnapshot;
}) {
  return (
    <section className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/80 p-5 text-sm dark:border-zinc-700 dark:bg-zinc-900/60">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold tracking-tight">Debug panel</h2>
        <p className="text-zinc-500 dark:text-zinc-400">
          Temporary database verification for the Today flashcard flow.
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <DebugBlock
          title="Current card"
          value={{
            id: currentCard?.id ?? null,
            kind: currentCard?.kind ?? null,
            lemma: currentCard?.lemma ?? null,
            definition: currentCard?.definition ?? null,
          }}
        />
        <DebugBlock title="Daily session row" value={debugSnapshot.dailySession} />
        <DebugBlock title="Last review write" value={debugSnapshot.lastReviewEvent} />
      </div>

      <div className="mt-4">
        <DebugBlock title="Current user_words row" value={debugSnapshot.currentUserWord} />
      </div>
    </section>
  );
}

function DebugBlock({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950/80">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        {title}
      </h3>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-zinc-700 dark:text-zinc-200">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
