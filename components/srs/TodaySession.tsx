"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  recordReview,
} from "@/app/actions/srs";
import { BackButton } from "@/components/BackButton";
import { LeftIcon } from "@/components/LeftIcon";
import { RightIcon } from "@/components/RightIcon";
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
  autoAdvanceCorrect?: boolean;
  showPosHint?: boolean;
  initialDailySession?: DailySessionRow | null;
};

type RetryEntry = { card: UnifiedQueueCard; dueAt: number };
type SessionPhase = "prompt" | "feedback" | "correction" | "waiting" | "done";
type ReviewedCardSnapshot = {
  card: UnifiedQueueCard;
  source: "main" | "retry";
  userAnswer?: string;
  feedback?: {
    correct: boolean;
    expected: string;
  };
  grade?: Grade;
};

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
  autoAdvanceCorrect = true,
  showPosHint = true,
  initialDailySession = null,
}: Props) {
  const { queue, enabledImplementedTypes, enabledUnimplementedTypes } = useMemo(
    () => buildUnifiedQueue(session, enabledTypes),
    [session, enabledTypes],
  );
  const initialCompletedCount = Math.max(
    0,
    initialDailySession?.reviews_done ?? 0,
  );

  const [mainIndex, setMainIndex] = useState(0);
  const [mainCompletedCount, setMainCompletedCount] = useState(0);
  const [retryList, setRetryList] = useState<RetryEntry[]>([]);
  const [current, setCurrent] = useState<UnifiedQueueCard | null>(
    queue[0] ?? null,
  );
  const [currentSource, setCurrentSource] = useState<"main" | "retry">("main");
  const [phase, setPhase] = useState<SessionPhase>(queue[0] ? "prompt" : "done");
  const [reviewedCards, setReviewedCards] = useState<ReviewedCardSnapshot[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [clozeInput, setClozeInput] = useState("");
  const [sentenceCorrectionInput, setSentenceCorrectionInput] = useState("");
  const [normalRevealed, setNormalRevealed] = useState(false);
  const [normalSubmittedGrade, setNormalSubmittedGrade] = useState<Grade | null>(null);
  const [feedback, setFeedback] = useState<{
    correct: boolean;
    expected: string;
  } | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const startedAtRef = useRef<number>(Date.now());
  const clozeInputRef = useRef<HTMLInputElement>(null);
  const sentenceCorrectionInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMainIndex(0);
    setMainCompletedCount(0);
    setRetryList([]);
    setCurrent(queue[0] ?? null);
    setCurrentSource("main");
    setPhase(queue[0] ? "prompt" : "done");
    setReviewedCards([]);
    setHistoryIndex(null);
    setClozeInput("");
    setSentenceCorrectionInput("");
    setNormalRevealed(false);
    setNormalSubmittedGrade(null);
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
    setSentenceCorrectionInput("");
    setNormalRevealed(false);
    setNormalSubmittedGrade(null);
    setFeedback(null);
    setPhase("prompt");
    startedAtRef.current = Date.now();
  }, [current]);

  useEffect(() => {
    if (
      (phase === "prompt" || phase === "correction") &&
      current?.cardType === "cloze"
    ) {
      requestAnimationFrame(() => clozeInputRef.current?.focus());
    }
  }, [phase, current]);

  useEffect(() => {
    if (phase === "correction" && current?.cardType === "sentences") {
      requestAnimationFrame(() => sentenceCorrectionInputRef.current?.focus());
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

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (busy || !current) return;
    if (event.key !== "Enter") return;

    if (phase === "feedback") {
      event.preventDefault();
      advanceFromCurrentCard(retryList);
      return;
    }

    if (phase === "correction") {
      if (current.cardType === "cloze") {
        event.preventDefault();
        void handleClozeCheck();
        return;
      }

      if (current.cardType === "sentences") {
        event.preventDefault();
        handleSentenceCorrectionSubmit();
      }

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
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleKeyDown(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function beginCard(card: UnifiedQueueCard, source: "main" | "retry") {
    setCurrent(card);
    setCurrentSource(source);
    setHistoryIndex(null);
  }

  function appendReviewedCard(snapshot: ReviewedCardSnapshot) {
    setReviewedCards((items) => [...items, snapshot]);
    setHistoryIndex(null);
  }

  function renderNormalCard(
    card: Extract<UnifiedQueueCard, { cardType: "normal" }>,
    navigation: ReactNode,
  ) {
    if (card.direction === "en_to_es") {
      return (
        <NormalEnToEsCard
          card={card}
          busy={busy}
          submitError={submitError}
          showPosHint={showPosHint}
          revealed={normalRevealed}
          submittedGrade={normalSubmittedGrade}
          navigation={navigation}
          onReveal={() => setNormalRevealed(true)}
          onGrade={(grade) => {
            void handleNormalGrade(grade);
          }}
          onNext={() => advanceFromCurrentCard(retryList)}
          retryDelayMs={retryDelayMs}
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
        submittedGrade={normalSubmittedGrade}
        navigation={navigation}
        onReveal={() => setNormalRevealed(true)}
        onGrade={(grade) => {
          void handleNormalGrade(grade);
        }}
        onNext={() => advanceFromCurrentCard(retryList)}
        retryDelayMs={retryDelayMs}
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
      const nextRetryList = correct
        ? retryList
        : upsertRetrySorted(retryList, {
            card,
            dueAt: Date.now() + retryDelayMs,
          });

      setRetryList(nextRetryList);

      appendReviewedCard({
        card,
        source: currentSource,
        userAnswer,
        feedback: {
          correct,
          expected: feedbackExpected,
        },
      });

      if (correct) {
        if (autoAdvanceCorrect) {
          advanceFromCurrentCard(nextRetryList);
          return;
        }

        setFeedback({
          correct,
          expected: feedbackExpected,
        });
        setPhase("feedback");
        return;
      }

      setFeedback({
        correct,
        expected: feedbackExpected,
      });

      if (card.cardType === "cloze" || card.cardType === "sentences") {
        setPhase("correction");
        return;
      }

      setPhase("feedback");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to submit review");
    } finally {
      setBusy(false);
    }
  }

  async function handleClozeCheck() {
    if (!current || current.cardType !== "cloze" || busy) {
      return;
    }

    const userAnswer = clozeInput.trim();
    if (!userAnswer) return;

    const expected = getClozeExpected(current);
    const correct = isCorrectClozeAnswer(userAnswer, expected);
    const feedbackExpected = expected[0] ?? (current.direction === "en_to_es"
      ? current.lemma
      : current.definition ?? "—");

    if (phase === "correction") {
      if (correct) {
        if (autoAdvanceCorrect) {
          setFeedback(null);
          advanceFromCurrentCard(retryList);
          return;
        }

        setFeedback({
          correct: true,
          expected: feedbackExpected,
        });
        setPhase("feedback");
        return;
      }

      setClozeInput("");
      setFeedback({
        correct: false,
        expected: feedbackExpected,
      });
      return;
    }

    if (phase !== "prompt") return;

    await submitObjectiveReview({
      card: current,
      correct,
      userAnswer,
      expected,
      feedbackExpected,
    });

    if (!correct) {
      setClozeInput("");
    }
  }

  async function handleChoiceSelect(option: string) {
    if (!current || phase !== "prompt" || busy) return;
    if (current.cardType !== "audio" && current.cardType !== "mcq") {
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

  async function handleSentenceSelect(option: string) {
    if (!current || current.cardType !== "sentences" || phase !== "prompt" || busy) {
      return;
    }

    const correct = option === current.correctOption;

    await submitObjectiveReview({
      card: current,
      correct,
      userAnswer: option,
      expected: [current.correctOption],
      feedbackExpected: current.correctOption,
    });

    if (!correct) {
      setSentenceCorrectionInput("");
    }
  }

  function handleSentenceCorrectionSubmit() {
    if (!current || current.cardType !== "sentences" || phase !== "correction" || busy) {
      return;
    }

    const answer = sentenceCorrectionInput.trim();
    if (!answer) return;

    if (normalize(answer) === normalize(current.correctOption)) {
      if (autoAdvanceCorrect) {
        setFeedback(null);
        advanceFromCurrentCard(retryList);
        return;
      }

      setFeedback({
        correct: true,
        expected: current.correctOption,
      });
      setPhase("feedback");
      return;
    }

    setSentenceCorrectionInput("");
    setFeedback({
      correct: false,
      expected: current.correctOption,
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
      const nextRetryList = correct
        ? retryList
        : upsertRetrySorted(retryList, {
            card: current,
            dueAt: Date.now() + retryDelayMs,
          });

      setRetryList(nextRetryList);
      appendReviewedCard({
        card: current,
        source: currentSource,
        grade,
      });
      setNormalSubmittedGrade(grade);

      if (correct && autoAdvanceCorrect) {
        advanceFromCurrentCard(nextRetryList);
        return;
      }

      setPhase("feedback");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to submit review");
    } finally {
      setBusy(false);
    }
  }

  const totalCards = queue.length;
  const historyCards =
    phase === "feedback" || phase === "correction"
      ? reviewedCards.slice(0, -1)
      : reviewedCards;
  const activeHistoryIndex = historyIndex ?? -1;
  const viewedSnapshot =
    historyIndex !== null ? historyCards[activeHistoryIndex] ?? null : null;
  const showingHistory = viewedSnapshot !== null;
  const canGoPrevious = !busy && !showingHistory && historyCards.length > 0;
  const canAdvanceLiveCard = !busy && phase === "feedback" && !showingHistory;
  const canGoNext =
    !busy &&
    (showingHistory ? current !== null : canAdvanceLiveCard);
  const flashcardNavigation = (
    <FlashcardNavigation
      canGoPrevious={canGoPrevious}
      canGoNext={canGoNext}
      onPrevious={goToPreviousReviewedCard}
      onNext={goToNextCard}
    />
  );
  const normalizedInitialCompleted = Math.max(0, Math.floor(initialCompletedCount));
  const progressTotal = Math.max(
    totalCards,
    Math.min(dailyLimit, normalizedInitialCompleted + totalCards),
  );
  const localCompletedCount =
    currentSource === "main" && (phase === "feedback" || phase === "correction")
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

  function goToPreviousReviewedCard() {
    if (!canGoPrevious) return;
    setHistoryIndex(historyCards.length - 1);
  }

  function goToNextCard() {
    if (!canGoNext) return;

    if (showingHistory) {
      setHistoryIndex(null);
      return;
    }

    advanceFromCurrentCard(retryList);
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

          {showingHistory ? (
            <ReviewedFlashcardCard
              snapshot={viewedSnapshot}
              navigation={flashcardNavigation}
            />
          ) : current.cardType === "cloze" ? (
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
              navigation={flashcardNavigation}
            />
          ) : current.cardType === "normal" ? (
            renderNormalCard(current, flashcardNavigation)
          ) : current.cardType === "audio" ? (
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
              navigation={flashcardNavigation}
            />
          ) : current.cardType === "mcq" ? (
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
              navigation={flashcardNavigation}
            />
          ) : current.cardType === "sentences" ? (
            <SentenceCard
              card={current}
              busy={busy}
              submitError={submitError}
              showPosHint={showPosHint}
              feedback={feedback}
              correctionValue={sentenceCorrectionInput}
              correctionInputRef={sentenceCorrectionInputRef}
              onSelect={(option) => {
                void handleSentenceSelect(option);
              }}
              onCorrectionChange={setSentenceCorrectionInput}
              onCorrectionSubmit={handleSentenceCorrectionSubmit}
              onNext={() => advanceFromCurrentCard(retryList)}
              navigation={flashcardNavigation}
            />
          ) : null}
        </div>
      ) : null}

      {enabledUnimplementedTypes.length > 0 ? (
        <ComingSoonNotice enabledTypes={enabledUnimplementedTypes} />
      ) : null}
    </div>
  );
}

function FlashcardNavigation({
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
}: {
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <button
        type="button"
        onClick={onPrevious}
        disabled={!canGoPrevious}
        aria-label="Previous flashcard"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-300 bg-white text-lg font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        <LeftIcon className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!canGoNext}
        aria-label="Next flashcard"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-300 bg-white text-lg font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        <RightIcon className="h-5 w-5" />
      </button>
    </div>
  );
}

function ReviewedFlashcardCard({
  snapshot,
  navigation,
}: {
  snapshot: ReviewedCardSnapshot;
  navigation: ReactNode;
}) {
  const { card, feedback, grade, userAnswer } = snapshot;

  return (
    <section className="relative rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="absolute inset-x-6 top-6">{navigation}</div>
      <div className="flex min-h-9 flex-col items-center gap-2 px-12 text-center">
          <p className="text-sm uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
            Previous flashcard
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {getCardKindLabel(card.kind)}
          </p>
      </div>

      {card.cardType === "cloze" ? (
        <ReviewedClozeCard card={card} answer={feedback?.expected} />
      ) : null}

      {card.cardType === "normal" ? (
        <ReviewedNormalCard card={card} grade={grade} />
      ) : null}

      {card.cardType === "audio" ? (
        <ReviewedChoiceCard
          card={card}
          title="Audio"
          subtitle={card.prompt}
          userAnswer={userAnswer}
        />
      ) : null}

      {card.cardType === "mcq" ? (
        <ReviewedChoiceCard
          card={card}
          title="Multiple choice"
          subtitle={card.prompt}
          userAnswer={userAnswer}
        />
      ) : null}

      {card.cardType === "sentences" ? (
        <ReviewedSentenceCard
          card={card}
          answer={feedback?.expected}
        />
      ) : null}
    </section>
  );
}

function ReviewedClozeCard({
  card,
  answer,
}: {
  card: Extract<UnifiedQueueCard, { cardType: "cloze" }>;
  answer?: string;
}) {
  const resolvedAnswer =
    answer ??
    (card.direction === "en_to_es"
      ? card.lemma
      : splitDefinitionCandidates(card.definition)[0] ?? card.definition ?? "—");

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div>
        <p className="text-sm uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          {card.direction === "en_to_es" ? "Meaning" : "Word"}
        </p>
        <p className="mt-2 text-zinc-800 dark:text-zinc-100">
          {card.direction === "en_to_es" ? (card.definition ?? "—") : card.lemma}
        </p>
        {card.hint ? (
          <p className="mt-1 text-sm text-zinc-500">({card.hint})</p>
        ) : null}
      </div>

      <div className="rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/40">
        <p className="text-xs uppercase tracking-[0.14em] text-green-700 dark:text-green-300">
          Correct answer
        </p>
        <p className="mt-2 text-lg font-medium text-green-900 dark:text-green-100">
          {resolvedAnswer}
        </p>
      </div>
    </div>
  );
}

function ReviewedNormalCard({
  card,
  grade,
}: {
  card: Extract<UnifiedQueueCard, { cardType: "normal" }>;
  grade?: Grade;
}) {
  const promptLabel = card.direction === "en_to_es" ? "Meaning" : "Word";
  const promptValue = card.direction === "en_to_es" ? (card.definition ?? "—") : card.lemma;
  const answerLabel = card.direction === "en_to_es" ? "Word" : "Meaning";
  const answerValue = card.direction === "en_to_es" ? card.lemma : (card.definition ?? "—");

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div>
        <p className="text-sm uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          {promptLabel}
        </p>
        <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {promptValue}
        </p>
        {card.hint ? (
          <p className="mt-1 text-sm text-zinc-500">({card.hint})</p>
        ) : null}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
        <p className="text-xs uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          {answerLabel}
        </p>
        <p className="mt-2 text-lg font-medium text-zinc-900 dark:text-zinc-100">
          {answerValue}
        </p>
      </div>

      {grade ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200">
          Grade: <span className="font-medium capitalize">{grade}</span>
        </div>
      ) : null}
    </div>
  );
}

function ReviewedChoiceCard({
  card,
  title,
  subtitle,
  sentence,
  translation,
  feedback,
  userAnswer,
}: {
  card: Extract<UnifiedQueueCard, { cardType: "audio" | "mcq" | "sentences" }>;
  title: string;
  subtitle: string;
  sentence?: string;
  translation?: string | null;
  feedback?: { correct: boolean; expected: string };
  userAnswer?: string;
}) {
  return (
    <div className="mt-5 flex flex-col gap-5">
      <div>
        <p className="text-sm uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          {title}
        </p>
        <p className="mt-2 text-lg font-medium text-zinc-900 dark:text-zinc-100">
          {subtitle}
        </p>
        {sentence ? (
          <p className="mt-4 text-xl font-medium tracking-tight text-zinc-900 dark:text-zinc-100">
            {sentence}
          </p>
        ) : null}
        {translation ? (
          <p className="mt-2 text-sm text-zinc-500">{translation}</p>
        ) : null}
        {card.hint ? (
          <p className="mt-2 text-sm text-zinc-500">({card.hint})</p>
        ) : null}
      </div>

      <div className="grid gap-2">
        {card.options.map((option) => {
          const isSelected = option === userAnswer;
          const isCorrect = option === card.correctOption;

          return (
            <div
              key={option}
              className={`rounded-lg border px-4 py-3 text-sm ${
                isCorrect
                  ? "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100"
                  : isSelected
                    ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
                    : "border-zinc-300 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span>{option}</span>
                <span className="text-xs uppercase tracking-[0.12em] text-current">
                  {isCorrect ? "Correct" : isSelected ? "Your answer" : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {feedback ? <ReviewedFeedback feedback={feedback} /> : null}
    </div>
  );
}

function ReviewedSentenceCard({
  card,
  answer,
}: {
  card: Extract<UnifiedQueueCard, { cardType: "sentences" }>;
  answer?: string;
}) {
  return (
    <div className="mt-5 flex flex-col gap-5">
      <div>
        <p className="text-sm uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          Sentence
        </p>
        <p className="mt-2 text-lg font-medium text-zinc-900 dark:text-zinc-100">
          {card.prompt}
        </p>
        <p className="mt-4 text-xl font-medium tracking-tight text-zinc-900 dark:text-zinc-100">
          {card.sentenceData.sentence}
        </p>
        {card.sentenceData.translation ? (
          <p className="mt-2 text-sm text-zinc-500">{card.sentenceData.translation}</p>
        ) : null}
        {card.hint ? (
          <p className="mt-2 text-sm text-zinc-500">({card.hint})</p>
        ) : null}
      </div>

      <div className="rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/40">
        <p className="text-xs uppercase tracking-[0.14em] text-green-700 dark:text-green-300">
          Correct answer
        </p>
        <p className="mt-2 text-lg font-medium text-green-900 dark:text-green-100">
          {answer ?? card.correctOption}
        </p>
      </div>
    </div>
  );
}

function ReviewedFeedback({
  feedback,
}: {
  feedback: { correct: boolean; expected: string };
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        feedback.correct
          ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/40"
          : "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40"
      }`}
    >
      <p className="font-medium text-zinc-900 dark:text-zinc-100">
        {feedback.correct ? "Correct" : "Incorrect"}
      </p>
      <p className="mt-1 text-zinc-600 dark:text-zinc-300">
        Expected: {feedback.expected}
      </p>
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

function getCardKindLabel(kind: UnifiedQueueCard["kind"]) {
  return kind === "review" ? "Review" : "New";
}

function ComingSoonNotice({ enabledTypes }: { enabledTypes: EnabledFlashcardMode[] }) {
  return (
    <section className="app-card-muted p-4 text-sm text-zinc-600 dark:text-zinc-300">
      Enabled but not implemented yet:{" "}
      {enabledTypes.map((type) => TYPE_LABELS[type]).join(", ")}.
    </section>
  );
}
