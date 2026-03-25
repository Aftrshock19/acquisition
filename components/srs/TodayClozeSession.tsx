"use client";

import { useCallback } from "react";
import { recordReview } from "@/app/actions/srs";
import { ClozeSession, type ClozeCard } from "./ClozeSession";
import type { TodaySession } from "@/lib/srs/types";

export type TodayClozeSessionProps = {
  session: TodaySession;
  dailyLimit: number;
  retryDelayMs?: number;
  showPosHint?: boolean;
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
}: TodayClozeSessionProps) {
  const cards = sessionToClozeCards(session);

  const onReview = useCallback(
    async (
      cardId: string,
      correct: boolean,
      msSpent: number,
      userAnswer: string,
      expected: string[],
    ) => {
      await recordReview({
        wordId: cardId,
        correct,
        msSpent,
        userAnswer,
        expected,
      });
    },
    [],
  );

  return (
    <ClozeSession
      cards={cards}
      dailyLimit={dailyLimit}
      onReview={onReview}
      retryDelayMs={retryDelayMs}
      showPosHint={showPosHint}
    />
  );
}
