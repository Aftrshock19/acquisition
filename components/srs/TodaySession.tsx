"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getFlashcardDebugSnapshot,
  recordReview,
  type FlashcardDebugSnapshot,
} from "@/app/actions/srs";
import { BackButton } from "@/components/BackButton";
import { SettingsButton } from "@/components/SettingsButton";
import { AudioCard } from "@/components/srs/cards/AudioCard";
import { ClozeCard } from "@/components/srs/cards/ClozeCard";
import { McqCard } from "@/components/srs/cards/McqCard";
import { NormalEnToEsCard } from "@/components/srs/cards/NormalEnToEsCard";
import { NormalEsToEnCard } from "@/components/srs/cards/NormalEsToEnCard";
import { SentenceCard } from "@/components/srs/cards/SentenceCard";
import {
  buildUnifiedQueue,
  TYPE_LABELS,
  type UnifiedQueueCard,
} from "@/components/srs/logic/buildUnifiedQueue";
import type { EnabledFlashcardMode } from "@/lib/settings/types";
import type {
  DailySessionRow,
  Grade,
  TodaySession as TodaySessionData,
} from "@/lib/srs/types";

type Props = {
  enabledTypes: Record<EnabledFlashcardMode, boolean>;
  session: TodaySessionData;
  dailyLimit: number;
  retryDelayMs?: number;
  showPosHint?: boolean;
  initialDailySession?: DailySessionRow | null;
  initialDebugSnapshot?: FlashcardDebugSnapshot;
};

type RetryEntry = { card: UnifiedQueueCard; dueAt: number };
type SessionPhase = "prompt" | "feedback" | "waiting" | "done";

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(value: string) {
  return stripDiacritics(
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~¿¡]/g, ""),
  );
}

function isCorrectClozeAnswer(userAnswer: string, expected: string[]) {
  const normalizedAnswer = normalize(userAnswer);
  if (!normalizedAnswer) return false;
  return expected.some(
    (candidate) => normalize(candidate) === normalizedAnswer,
  );
}

function getClozeExpected(card: Extract<UnifiedQueueCard, { cardType: "cloze" }>) {
  if (card.direction === "en_to_es") {
    return [card.lemma];
  }

  return splitDefinitionCandidates(card.definition);
}

function splitDefinitionCandidates(definition: string | null) {
  if (!definition) return [];

  const parts = definition
    .split(/[;,/|]/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts : [definition];
}

function upsertRetrySorted(list: RetryEntry[], entry: RetryEntry) {
  const filtered = list.filter((item) => item.card.id !== entry.card.id);
  const index = filtered.findIndex((item) => item.dueAt > entry.dueAt);
  if (index === -1) return [...filtered, entry];
  return [...filtered.slice(0, index), entry, ...filtered.slice(index)];
}

export function TodaySession({
  enabledTypes,
  session,
  dailyLimit,
  retryDelayMs = 90000,
  showPosHint = true,
  initialDailySession = null,
  initialDebugSnapshot,
}: Props) {
  const { queue, enabledImplementedTypes, enabledUnimplementedTypes } = useMemo(
    () => buildUnifiedQueue(session, enabledTypes),
    [session, enabledTypes],
  );
  const initialCompletedCount = Math.max(
    0,
    initialDailySession?.reviews_done ??
      initialDebugSnapshot?.dailySession?.reviews_done ??
      0,
  );

  const [mainIndex, setMainIndex] = useState(0);
  const [mainCompletedCount, setMainCompletedCount] = useState(0);
  const [retryList, setRetryList] = useState<RetryEntry[]>([]);
  const [current, setCurrent] = useState<UnifiedQueueCard | null>(
    queue[0] ?? null,
  );
  const [currentSource, setCurrentSource] = useState<"main" | "retry">("main");
  const [phase, setPhase] = useState<SessionPhase>(queue[0] ? "prompt" : "done");
  const [clozeInput, setClozeInput] = useState("");
  const [normalRevealed, setNormalRevealed] = useState(false);
  const [feedback, setFeedback] = useState<{
    correct: boolean;
    expected: string;
  } | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<FlashcardDebugSnapshot>(
    initialDebugSnapshot ?? {
      dailySession: initialDailySession,
      currentUserWord: null,
      lastReviewEvent: null,
    },
  );

  const startedAtRef = useRef<number>(Date.now());
  const clozeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMainIndex(0);
    setMainCompletedCount(0);
    setRetryList([]);
    setCurrent(queue[0] ?? null);
    setCurrentSource("main");
    setPhase(queue[0] ? "prompt" : "done");
    setClozeInput("");
    setNormalRevealed(false);
    setFeedback(null);
    setWaitSeconds(0);
    setBusy(false);
    setSubmitError(null);
    startedAtRef.current = Date.now();
  }, [queue]);

  useEffect(() => {
    if (!current) return;

    setSubmitError(null);
    setClozeInput("");
    setNormalRevealed(false);
    setFeedback(null);
    setPhase("prompt");
    startedAtRef.current = Date.now();

    void getFlashcardDebugSnapshot(current.id).then((snapshot) => {
      setDebugSnapshot(snapshot);
    });
  }, [current]);

  useEffect(() => {
    if (phase === "prompt" && current?.cardType === "cloze") {
      requestAnimationFrame(() => clozeInputRef.current?.focus());
    }
  }, [phase, current]);

  useEffect(() => {
    if (phase !== "waiting" || retryList.length === 0) return;

    const tick = () => {
      const dueAt = retryList[0].dueAt;
      const seconds = Math.max(0, Math.ceil((dueAt - Date.now()) / 1000));
      setWaitSeconds(seconds);

      if (seconds <= 0) {
        const nextRetry = retryList[0];
        setRetryList((items) => items.slice(1));
        setCurrent(nextRetry.card);
        setCurrentSource("retry");
      }
    };

    tick();
    const intervalId = setInterval(tick, 250);
    return () => clearInterval(intervalId);
  }, [phase, retryList]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy || !current) return;
      if (event.key !== "Enter") return;

      if (phase === "feedback") {
        event.preventDefault();
        advanceFromCurrentCard(retryList);
        return;
      }

      if (phase !== "prompt") return;

      if (current.cardType === "cloze") {
        event.preventDefault();
        void handleClozeCheck();
        return;
      }

      if (current.cardType === "normal" && !normalRevealed) {
        event.preventDefault();
        setNormalRevealed(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, current, phase, retryList, clozeInput, normalRevealed]);

  function beginCard(card: UnifiedQueueCard, source: "main" | "retry") {
    setCurrent(card);
    setCurrentSource(source);
  }

  function renderNormalCard(
    card: Extract<UnifiedQueueCard, { cardType: "normal" }>,
  ) {
    if (card.direction === "en_to_es") {
      return (
        <NormalEnToEsCard
          card={card}
          busy={busy}
          submitError={submitError}
          showPosHint={showPosHint}
          revealed={normalRevealed}
          onReveal={() => setNormalRevealed(true)}
          onGrade={(grade) => {
            void handleNormalGrade(grade);
          }}
        />
      );
    }

    return (
      <NormalEsToEnCard
        card={card}
        busy={busy}
        submitError={submitError}
        showPosHint={showPosHint}
        revealed={normalRevealed}
        onReveal={() => setNormalRevealed(true)}
        onGrade={(grade) => {
          void handleNormalGrade(grade);
        }}
      />
    );
  }

  function advanceFromCurrentCard(nextRetryList: RetryEntry[]) {
    if (!current) return;

    const nextMainIndex = currentSource === "main" ? mainIndex + 1 : mainIndex;
    const nextMainCompleted =
      currentSource === "main" ? mainCompletedCount + 1 : mainCompletedCount;

    setMainIndex(nextMainIndex);
    setMainCompletedCount(nextMainCompleted);

    const now = Date.now();
    const dueRetry =
      nextRetryList.length > 0 && nextRetryList[0].dueAt <= now
        ? nextRetryList[0]
        : null;

    if (dueRetry) {
      setRetryList(nextRetryList.slice(1));
      beginCard(dueRetry.card, "retry");
      return;
    }

    if (nextMainIndex < queue.length) {
      setRetryList(nextRetryList);
      beginCard(queue[nextMainIndex], "main");
      return;
    }

    if (nextRetryList.length > 0) {
      setRetryList(nextRetryList);
      setCurrent(null);
      setPhase("waiting");
      return;
    }

    setRetryList([]);
    setCurrent(null);
    setPhase("done");
  }

  async function submitObjectiveReview(args: {
    card: Extract<
      UnifiedQueueCard,
      { cardType: "cloze" | "audio" | "mcq" | "sentences" }
    >;
    correct: boolean;
    userAnswer: string;
    expected: string[];
    feedbackExpected: string;
  }) {
    const { card, correct, userAnswer, expected, feedbackExpected } = args;

    setBusy(true);
    try {
      const result = await recordReview({
        wordId: card.id,
        correct,
        cardType: card.cardType,
        msSpent: Date.now() - startedAtRef.current,
        userAnswer,
        expected,
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      setDebugSnapshot(result.debugSnapshot);

      if (!correct) {
        setRetryList((items) =>
          upsertRetrySorted(items, {
            card,
            dueAt: Date.now() + retryDelayMs,
          }),
        );
      }

      setFeedback({
        correct,
        expected: feedbackExpected,
      });
      setPhase("feedback");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to submit review");
    } finally {
      setBusy(false);
    }
  }

  async function handleClozeCheck() {
    if (
      !current ||
      current.cardType !== "cloze" ||
      phase !== "prompt" ||
      busy
    ) {
      return;
    }

    const userAnswer = clozeInput.trim();
    if (!userAnswer) return;

    const expected = getClozeExpected(current);
    const correct = isCorrectClozeAnswer(userAnswer, expected);
    const feedbackExpected = expected[0] ?? (current.direction === "en_to_es"
      ? current.lemma
      : current.definition ?? "—");

    await submitObjectiveReview({
      card: current,
      correct,
      userAnswer,
      expected,
      feedbackExpected,
    });
  }

  async function handleChoiceSelect(option: string) {
    if (!current || phase !== "prompt" || busy) return;
    if (
      current.cardType !== "audio" &&
      current.cardType !== "mcq" &&
      current.cardType !== "sentences"
    ) {
      return;
    }

    await submitObjectiveReview({
      card: current,
      correct: option === current.correctOption,
      userAnswer: option,
      expected: [current.correctOption],
      feedbackExpected: current.correctOption,
    });
  }

  async function handleNormalGrade(grade: Grade) {
    if (
      !current ||
      current.cardType !== "normal" ||
      phase !== "prompt" ||
      !normalRevealed ||
      busy
    ) {
      return;
    }

    const correct = grade !== "again";

    setBusy(true);
    try {
      const result = await recordReview({
        wordId: current.id,
        correct,
        grade,
        cardType: "normal",
        msSpent: Date.now() - startedAtRef.current,
        userAnswer: `[self-rated:${grade}]`,
        expected: [
          current.direction === "en_to_es"
            ? current.lemma
            : (current.definition ?? current.lemma),
        ],
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      setDebugSnapshot(result.debugSnapshot);

      const nextRetryList = correct
        ? retryList
        : upsertRetrySorted(retryList, {
            card: current,
            dueAt: Date.now() + retryDelayMs,
          });

      advanceFromCurrentCard(nextRetryList);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to submit review");
    } finally {
      setBusy(false);
    }
  }

  const totalCards = queue.length;
  const normalizedInitialCompleted = Math.max(0, Math.floor(initialCompletedCount));
  const progressTotal = Math.max(
    totalCards,
    Math.min(dailyLimit, normalizedInitialCompleted + totalCards),
  );
  const localCompletedCount =
    currentSource === "main" && phase === "feedback"
      ? mainCompletedCount + 1
      : mainCompletedCount;
  const completedCount = Math.min(
    progressTotal,
    normalizedInitialCompleted + localCompletedCount,
  );
  const progressPercent = progressTotal > 0 ? (100 * completedCount) / progressTotal : 0;

  if (enabledImplementedTypes.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <section className="app-card flex flex-col gap-3 p-8">
          <h2 className="text-xl font-semibold tracking-tight">No implemented type enabled</h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            Enable at least one flashcard type in Settings to study now.
          </p>
        </section>

        {enabledUnimplementedTypes.length > 0 ? (
          <ComingSoonNotice enabledTypes={enabledUnimplementedTypes} />
        ) : null}
      </div>
    );
  }

  if (queue.length === 0) {
    return <p className="text-zinc-600 dark:text-zinc-400">No cards in this session.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {enabledImplementedTypes.length > 1 ? (
        <section className="app-card-muted p-4 text-sm text-zinc-600 dark:text-zinc-300">
          Cards are mixed evenly across your enabled types:{" "}
          {enabledImplementedTypes.map((type) => TYPE_LABELS[type]).join(", ")}.
        </section>
      ) : null}

      {phase === "done" ? (
        <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900/50">
          <h2 className="text-xl font-semibold tracking-tight">Session complete</h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            You are done for now. Come back tomorrow for more.
          </p>
        </div>
      ) : phase === "waiting" ? (
        <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900/50">
          <SessionProgressBar
            completedCount={completedCount}
            progressPercent={progressPercent}
            progressTotal={progressTotal}
          />
          <h2 className="text-xl font-semibold tracking-tight">Quick pause</h2>
          <p className="text-zinc-600 dark:text-zinc-400">Next retry in {waitSeconds}s</p>
        </div>
      ) : current ? (
        <div className="flex flex-col gap-6">
          <SessionProgressBar
            completedCount={completedCount}
            progressPercent={progressPercent}
            progressTotal={progressTotal}
          />

          {current.cardType === "cloze" ? (
            <ClozeCard
              card={current}
              value={clozeInput}
              busy={busy}
              submitError={submitError}
              showPosHint={showPosHint}
              feedback={feedback}
              inputRef={clozeInputRef}
              onChange={setClozeInput}
              onCheck={() => {
                void handleClozeCheck();
              }}
              onNext={() => advanceFromCurrentCard(retryList)}
              retryDelayMs={retryDelayMs}
            />
          ) : null}

          {current.cardType === "normal" ? renderNormalCard(current) : null}

          {current.cardType === "audio" ? (
            <AudioCard
              card={current}
              busy={busy}
              submitError={submitError}
              showPosHint={showPosHint}
              feedback={feedback}
              onSelect={(option) => {
                void handleChoiceSelect(option);
              }}
              onNext={() => advanceFromCurrentCard(retryList)}
              retryDelayMs={retryDelayMs}
            />
          ) : null}

          {current.cardType === "mcq" ? (
            <McqCard
              card={current}
              busy={busy}
              submitError={submitError}
              showPosHint={showPosHint}
              feedback={feedback}
              onSelect={(option) => {
                void handleChoiceSelect(option);
              }}
              onNext={() => advanceFromCurrentCard(retryList)}
              retryDelayMs={retryDelayMs}
            />
          ) : null}

          {current.cardType === "sentences" ? (
            <SentenceCard
              card={current}
              busy={busy}
              submitError={submitError}
              showPosHint={showPosHint}
              feedback={feedback}
              onSelect={(option) => {
                void handleChoiceSelect(option);
              }}
              onNext={() => advanceFromCurrentCard(retryList)}
              retryDelayMs={retryDelayMs}
            />
          ) : null}
        </div>
      ) : null}

      <FlashcardDebugPanel currentCard={current} debugSnapshot={debugSnapshot} />

      {enabledUnimplementedTypes.length > 0 ? (
        <ComingSoonNotice enabledTypes={enabledUnimplementedTypes} />
      ) : null}
    </div>
  );
}

function SessionProgressBar({
  completedCount,
  progressPercent,
  progressTotal,
}: {
  completedCount: number;
  progressPercent: number;
  progressTotal: number;
}) {
  return (
    <div className="flex items-start gap-3">
      <BackButton className="shrink-0" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex justify-between text-sm text-zinc-500 dark:text-zinc-400">
          <span>
            Card {completedCount} of {progressTotal}
          </span>
          <span>{Math.round(progressPercent)}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
          role="progressbar"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={progressTotal}
        >
          <div
            className="h-full rounded-full bg-zinc-700 transition-[width] duration-300 ease-out dark:bg-zinc-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <SettingsButton className="shrink-0" />
    </div>
  );
}

function FlashcardDebugPanel({
  currentCard,
  debugSnapshot,
}: {
  currentCard: UnifiedQueueCard | null;
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
            cardType: currentCard?.cardType ?? null,
            direction: getCardDirection(currentCard),
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

function getCardDirection(card: UnifiedQueueCard | null) {
  if (!card) return null;
  if (card.cardType === "normal" || card.cardType === "cloze") {
    return card.direction;
  }
  return null;
}

function ComingSoonNotice({ enabledTypes }: { enabledTypes: EnabledFlashcardMode[] }) {
  return (
    <section className="app-card-muted p-4 text-sm text-zinc-600 dark:text-zinc-300">
      Enabled but not implemented yet:{" "}
      {enabledTypes.map((type) => TYPE_LABELS[type]).join(", ")}.
    </section>
  );
}
