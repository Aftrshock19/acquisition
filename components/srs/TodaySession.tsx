"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { recordReview, loadMoreFlashcards } from "@/app/actions/srs";
import type { WorkloadPolicy } from "@/lib/srs/workloadPolicy";
import { InteractiveTextProvider } from "@/components/interactive-text/InteractiveTextProvider";
import { LeftIcon } from "@/components/LeftIcon";
import { RightIcon } from "@/components/RightIcon";
import { SettingsButton } from "@/components/SettingsButton";
import { PracticeCompleteScreen } from "@/components/srs/PracticeCompleteScreen";
import { AudioCard } from "@/components/srs/cards/AudioCard";
import { ClozeCard } from "@/components/srs/cards/ClozeCard";
import { McqCard } from "@/components/srs/cards/McqCard";
import { NormalEnToEsCard } from "@/components/srs/cards/NormalEnToEsCard";
import { NormalEsToEnCard } from "@/components/srs/cards/NormalEsToEnCard";
import { SentenceClozePrompt } from "@/components/srs/cards/SentenceClozePrompt";
import { SentenceCard } from "@/components/srs/cards/SentenceCard";
import {
  buildUnifiedQueue,
  getEnglishPromptText,
  TYPE_LABELS,
  type UnifiedQueueCard,
} from "@/components/srs/logic/buildUnifiedQueue";
import {
  getNormalReviewOutcome,
  getNormalReviewResultLabel,
  type NormalReviewChoice,
} from "@/lib/srs/normalReview";
import {
  formatDefinitionCandidates,
  isCorrectClozeAnswer,
  splitDefinitionCandidates,
} from "@/lib/srs/cloze";
import { RetryQueue } from "@/lib/srs/retryQueue";
import {
  clearRetryQueue,
  loadRetryQueue,
  persistRetryQueue,
  sweepStaleRetryQueues,
} from "@/lib/srs/retryQueuePersistence";
import type { McqQuestionFormat } from "@/lib/settings/mcqQuestionFormats";
import type { EnabledFlashcardMode } from "@/lib/settings/types";
import type {
  DailySessionRow,
  Grade,
  TodaySession as TodaySessionData,
} from "@/lib/srs/types";

type Props = {
  enabledTypes: Record<EnabledFlashcardMode, boolean>;
  mcqQuestionFormats: McqQuestionFormat[];
  session: TodaySessionData;
  initialSavedWordIds: string[];
  initialSavedLemmas: string[];
  dailyLimit: number;
  manualTargetMode?: boolean;
  autoAdvanceCorrect?: boolean;
  showPosHint?: boolean;
  hideTranslationSentences?: boolean;
  initialDailySession?: DailySessionRow | null;
  workloadPolicy?: WorkloadPolicy;
};

type SessionPhase = "prompt" | "feedback" | "correction" | "done";
const TEXT_SUCCESS_DELAY_MS = 1200;
const CORRECTION_PLACEHOLDER_DELAY_MS = 1900;
const FLASHCARD_LOOKUP_LANG = "es";
const MANUAL_TARGET_CHUNK = 50;
function generateAttemptId(): string {
  const cryptoApi =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  return `attempt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const REVIEWED_SENTENCE_SUPPORT_EXPANDED_STORAGE_KEY =
  "reviewed-sentence-support-expanded";
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

function getClozeExpectedLabel(
  card: Extract<UnifiedQueueCard, { cardType: "cloze" }>,
  expected: string[],
) {
  if (card.direction === "en_to_es") {
    return expected[0] ?? card.lemma;
  }

  if (expected.length > 1) {
    return formatDefinitionCandidates(expected);
  }

  return expected[0] ?? getEnglishPromptText(card) ?? "—";
}

function allowContainedClozeCandidateMatch(
  card: Extract<UnifiedQueueCard, { cardType: "cloze" }>,
  expected: string[],
) {
  return card.direction === "es_to_en" && expected.length > 1;
}

function getClozeExpected(
  card: Extract<UnifiedQueueCard, { cardType: "cloze" }>,
) {
  if (card.direction === "en_to_es") {
    return [card.lemma];
  }

  return splitDefinitionCandidates(getEnglishPromptText(card));
}

function getTypingExpected(
  card: Extract<UnifiedQueueCard, { cardType: "cloze" | "sentences" }>,
) {
  if (card.cardType === "cloze") {
    return getClozeExpected(card);
  }

  return [card.correctOption];
}

function getTypingExpectedLabel(
  card: Extract<UnifiedQueueCard, { cardType: "cloze" | "sentences" }>,
  expected: string[],
) {
  if (card.cardType === "cloze") {
    return getClozeExpectedLabel(card, expected);
  }

  return expected[0] ?? card.correctOption;
}

function allowContainedTypingCandidateMatch(
  card: Extract<UnifiedQueueCard, { cardType: "cloze" | "sentences" }>,
  expected: string[],
) {
  if (card.cardType === "cloze") {
    return allowContainedClozeCandidateMatch(card, expected);
  }

  return false;
}

export function TodaySession({
  enabledTypes,
  mcqQuestionFormats,
  session,
  initialSavedWordIds,
  initialSavedLemmas,
  dailyLimit,
  manualTargetMode = false,
  autoAdvanceCorrect = true,
  showPosHint = true,
  hideTranslationSentences = false,
  initialDailySession = null,
  workloadPolicy,
}: Props) {
  const { queue, enabledImplementedTypes, enabledUnimplementedTypes } = useMemo(
    () => buildUnifiedQueue(session, enabledTypes, mcqQuestionFormats),
    [session, enabledTypes, mcqQuestionFormats],
  );

  const [extraCards, setExtraCards] = useState<UnifiedQueueCard[]>([]);
  const allCards = useMemo(() => [...queue, ...extraCards], [queue, extraCards]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reviewsExhausted, setReviewsExhausted] = useState(false);
  const [newWordsExhausted, setNewWordsExhausted] = useState(false);
  const [unlimitedMode, setUnlimitedMode] = useState(false);
  const [comebackDismissed, setComebackDismissed] = useState(false);
  const seenWordIdsRef = useRef<Set<string>>(new Set());
  const initialCompletedCount = Math.max(
    0,
    initialDailySession?.flashcard_completed_count ??
      initialDailySession?.reviews_done ??
      0,
  );
  const normalizedInitialCompleted = Math.max(0, Math.floor(initialCompletedCount));

  const [mainIndex, setMainIndex] = useState(0);
  const [mainCompletedCount, setMainCompletedCount] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const retryQueueRef = useRef(new RetryQueue<UnifiedQueueCard>());
  const [retryPending, setRetryPending] = useState(0);
  const [current, setCurrent] = useState<UnifiedQueueCard | null>(
    queue[0] ?? null,
  );
  const [currentSource, setCurrentSource] = useState<"main" | "retry">("main");
  const [currentRetryIndex, setCurrentRetryIndex] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>(
    queue[0] ? "prompt" : "done",
  );
  const [reviewedCards, setReviewedCards] = useState<ReviewedCardSnapshot[]>(
    [],
  );
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [typingInput, setTypingInput] = useState("");
  const [normalRevealed, setNormalRevealed] = useState(false);
  const [normalSubmittedGrade, setNormalSubmittedGrade] =
    useState<Grade | null>(null);
  const [feedback, setFeedback] = useState<{
    correct: boolean;
    expected: string;
  } | null>(null);
  const [showCorrectionPlaceholder, setShowCorrectionPlaceholder] =
    useState(false);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const sessionStartedAtRef = useRef<number>(Date.now());
  const startedAtRef = useRef<number>(Date.now());
  const currentAttemptRef = useRef<{
    id: string;
    shownAt: string;
  } | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correctionPlaceholderTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingInputRef = useRef<HTMLInputElement>(null);

  // Persistence key for the retry queue. We only persist when we have a
  // real daily session row, otherwise there is no stable (user, date) pair
  // and we fall back to the existing in-memory-only behaviour.
  const retryPersistKey = useMemo(() => {
    if (!initialDailySession) return null;
    return {
      userId: initialDailySession.user_id,
      sessionDate: initialDailySession.session_date,
      sessionId: initialDailySession.id,
    };
  }, [initialDailySession]);

  const retryPersistKeyRef = useRef(retryPersistKey);
  useEffect(() => {
    retryPersistKeyRef.current = retryPersistKey;
  }, [retryPersistKey]);

  const persistRetry = useCallback(() => {
    const key = retryPersistKeyRef.current;
    if (!key) return;
    persistRetryQueue({ ...key, queue: retryQueueRef.current });
  }, []);

  useEffect(() => {
    setMainIndex(0);
    setMainCompletedCount(0);
    setTotalAnswered(0);
    retryQueueRef.current.reset();

    // Sweep stale persisted retries (other users / other dates) and rehydrate
    // today's snapshot if one exists. Corrupt payloads are ignored safely.
    let rehydrated = false;
    if (retryPersistKey) {
      sweepStaleRetryQueues(retryPersistKey);
      rehydrated = loadRetryQueue({
        ...retryPersistKey,
        queue: retryQueueRef.current,
      });
    }

    setRetryPending(retryQueueRef.current.pendingCount);
    setCurrent(queue[0] ?? null);
    setCurrentSource("main");
    setCurrentRetryIndex(0);
    setPhase(queue[0] ? "prompt" : "done");
    setReviewedCards([]);
    setHistoryIndex(null);
    setTypingInput("");
    setNormalRevealed(false);
    setNormalSubmittedGrade(null);
    setFeedback(null);
    setShowCorrectionPlaceholder(false);
    setAnswerRevealed(false);
    setBusy(false);
    setSubmitError(null);
    startedAtRef.current = Date.now();
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }
    if (correctionPlaceholderTimeoutRef.current) {
      clearTimeout(correctionPlaceholderTimeoutRef.current);
      correctionPlaceholderTimeoutRef.current = null;
    }

    // Seed exclusion set with all initial queue card IDs so prefetch loads
    // don't duplicate cards already in the queue.
    seenWordIdsRef.current.clear();
    for (const card of queue) {
      seenWordIdsRef.current.add(card.id);
    }

    // If we rehydrated, the reset above cleared nothing user-visible but the
    // queue may already hold pending retries — no additional action needed
    // since `advanceFromCurrentCard` surfaces them on the next transition.
    void rehydrated;
  }, [queue, retryPersistKey]);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      if (correctionPlaceholderTimeoutRef.current) {
        clearTimeout(correctionPlaceholderTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!current) return;

    if (current.id) {
      seenWordIdsRef.current.add(current.id);
    }

    setSubmitError(null);
    setTypingInput("");
    setNormalRevealed(false);
    setNormalSubmittedGrade(null);
    setFeedback(null);
    setShowCorrectionPlaceholder(false);
    setAnswerRevealed(false);
    setPhase("prompt");
    startedAtRef.current = Date.now();
    currentAttemptRef.current = current
      ? {
          id: generateAttemptId(),
          shownAt: new Date().toISOString(),
        }
      : null;
  }, [current]);

  useEffect(() => {
    if (
      (phase === "prompt" || phase === "correction") &&
      (current?.cardType === "cloze" || current?.cardType === "sentences")
    ) {
      requestAnimationFrame(() => typingInputRef.current?.focus());
    }
  }, [phase, current]);

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (busy || !current) return;
    if (event.key !== "Enter") return;

    if (phase === "feedback") {
      event.preventDefault();
      advanceFromCurrentCard();
      return;
    }

    if (phase === "correction") {
      if (current.cardType === "cloze" || current.cardType === "sentences") {
        event.preventDefault();
        void handleTypingCheck();
      }

      return;
    }

    if (phase !== "prompt") return;

    if (current.cardType === "cloze" || current.cardType === "sentences") {
      event.preventDefault();
      if (!typingInput.trim()) {
        void handleTypingReveal();
      } else {
        void handleTypingCheck();
      }
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

  function clearSuccessAdvanceTimeout() {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }
  }

  function clearCorrectionPlaceholderTimeout() {
    if (correctionPlaceholderTimeoutRef.current) {
      clearTimeout(correctionPlaceholderTimeoutRef.current);
      correctionPlaceholderTimeoutRef.current = null;
    }
  }

  function revealCorrectionPlaceholder() {
    clearCorrectionPlaceholderTimeout();
    setShowCorrectionPlaceholder(true);
    correctionPlaceholderTimeoutRef.current = setTimeout(() => {
      correctionPlaceholderTimeoutRef.current = null;
      setShowCorrectionPlaceholder(false);
    }, CORRECTION_PLACEHOLDER_DELAY_MS);
  }

  function handleTypingInputChange(value: string) {
    if (showCorrectionPlaceholder && value.length > 0) {
      clearCorrectionPlaceholderTimeout();
      setShowCorrectionPlaceholder(false);
    }
    setTypingInput(value);
  }

  function appendReviewedCard(snapshot: ReviewedCardSnapshot) {
    setReviewedCards((items) => [...items, snapshot]);
    setHistoryIndex(null);
  }

  /**
   * Load more cards. In prefetch mode, cards are silently appended to the
   * queue so the user never sees a loading gap. In immediate mode (default),
   * the first new card is started right away — used when the queue is already
   * exhausted (phase === "done").
   */
  async function handleLoadMore(count: number, prefetch = false) {
    setLoadingMore(true);
    const result = await loadMoreFlashcards(count, [...seenWordIdsRef.current]);
    setLoadingMore(false);

    if (!result.ok) return;

    const totalLoaded = result.dueReviews.length + result.newWords.length;
    if (totalLoaded === 0) {
      setReviewsExhausted(true);
      setNewWordsExhausted(true);
      setUnlimitedMode(false);
      return;
    }

    // If fewer cards came back than requested, supply is running out
    if (totalLoaded < count) {
      setReviewsExhausted(true);
      setNewWordsExhausted(true);
    }

    const { queue: newCards } = buildUnifiedQueue(
      { dueReviews: result.dueReviews, newWords: result.newWords },
      enabledTypes,
      mcqQuestionFormats,
    );

    if (newCards.length === 0) {
      setReviewsExhausted(true);
      setNewWordsExhausted(true);
      setUnlimitedMode(false);
      return;
    }

    // Register new card IDs so future fetches exclude them
    for (const card of newCards) {
      seenWordIdsRef.current.add(card.id);
    }

    setExtraCards((prev) => [...prev, ...newCards]);

    if (!prefetch) {
      // Immediate mode: start practicing the first new card now
      beginCard(newCards[0], "main");
      setCurrentRetryIndex(0);
      setPhase("prompt");
    }
  }

  const handleLoadMoreRef = useRef(handleLoadMore);
  handleLoadMoreRef.current = handleLoadMore;
  const allExhausted = reviewsExhausted && newWordsExhausted;
  const targetRemaining = manualTargetMode
    ? dailyLimit - normalizedInitialCompleted - totalAnswered
    : dailyLimit - normalizedInitialCompleted - mainCompletedCount;

  // --- Prefetch: load next chunk while user still has cards to practice ---
  const PREFETCH_THRESHOLD = 10;
  const unseenRemaining = allCards.length - mainIndex - 1;
  const shouldPrefetch =
    manualTargetMode &&
    !unlimitedMode &&
    !loadingMore &&
    !allExhausted &&
    targetRemaining > 0 &&
    unseenRemaining <= PREFETCH_THRESHOLD &&
    unseenRemaining >= 0;

  useEffect(() => {
    if (!shouldPrefetch || phase === "done") return;
    const chunk = Math.min(MANUAL_TARGET_CHUNK, targetRemaining);
    void handleLoadMoreRef.current(chunk, true);
  }, [shouldPrefetch, targetRemaining, phase]);

  // --- Fallback: immediate load when queue is fully exhausted ---
  const shouldAutoLoadChunk =
    manualTargetMode && !unlimitedMode && targetRemaining > 0 && !allExhausted;

  useEffect(() => {
    if (phase !== "done" || loadingMore) return;

    if (unlimitedMode) {
      void handleLoadMoreRef.current(12);
      return;
    }

    if (shouldAutoLoadChunk) {
      const chunk = Math.min(MANUAL_TARGET_CHUNK, targetRemaining);
      void handleLoadMoreRef.current(chunk);
    }
  }, [phase, unlimitedMode, loadingMore, shouldAutoLoadChunk, targetRemaining]);

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
          onChoice={(choice) => {
            void handleNormalGrade(choice);
          }}
          onNext={() => advanceFromCurrentCard()}
  
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
        onChoice={(choice) => {
          void handleNormalGrade(choice);
        }}
        onNext={() => advanceFromCurrentCard()}

      />
    );
  }

  function advanceFromCurrentCard() {
    if (!current) return;

    clearSuccessAdvanceTimeout();

    const rq = retryQueueRef.current;

    // Manual-target strict cap: retries count toward the session total. Once
    // normalizedInitialCompleted + totalAnswered hits dailyLimit the session
    // ends, any pending retries are dropped (they are already logged in
    // review_events and will resurface tomorrow via SRS).
    if (
      manualTargetMode &&
      normalizedInitialCompleted + totalAnswered >= dailyLimit
    ) {
      rq.reset();
      setRetryPending(0);
      setCurrent(null);
      setPhase("done");
      if (retryPersistKey) clearRetryQueue(retryPersistKey);
      return;
    }

    const nextMainIndex = currentSource === "main" ? mainIndex + 1 : mainIndex;
    const nextMainCompleted =
      currentSource === "main" ? mainCompletedCount + 1 : mainCompletedCount;

    setMainIndex(nextMainIndex);
    setMainCompletedCount(nextMainCompleted);

    // Check if a retry card is ready (count-based, no wall-clock delay)
    const dueRetry = rq.dequeue();

    if (dueRetry) {
      setRetryPending(rq.pendingCount);
      persistRetry();
      beginCard(dueRetry.card, "retry");
      setCurrentRetryIndex(dueRetry.retryCount);
      return;
    }

    if (nextMainIndex < allCards.length) {
      beginCard(allCards[nextMainIndex], "main");
      setCurrentRetryIndex(0);
      return;
    }

    // All main cards done — flush stranded retries before session completion.
    // Normal dequeue respects RETRY_GAP, but with no more main cards the gap
    // can never be satisfied, so force-dequeue to prevent retry starvation.
    if (rq.hasPending) {
      const forced = rq.dequeue() ?? rq.forceDequeue();
      if (forced) {
        setRetryPending(rq.pendingCount);
        persistRetry();
        beginCard(forced.card, "retry");
        setCurrentRetryIndex(forced.retryCount);
        return;
      }
    }

    setCurrent(null);
    setPhase("done");
    // Session is complete: purge persisted retry state so nothing leaks to
    // tomorrow or to a subsequent fresh session on the same day.
    if (retryPersistKey) clearRetryQueue(retryPersistKey);
  }

  function scheduleSuccessAdvance() {
    clearSuccessAdvanceTimeout();

    successTimeoutRef.current = setTimeout(() => {
      successTimeoutRef.current = null;
      advanceFromCurrentCard();
    }, TEXT_SUCCESS_DELAY_MS);
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
    skipCorrection?: boolean;
  }) {
    const { card, correct, userAnswer, expected, feedbackExpected } = args;

    setBusy(true);
    try {
      const rq = retryQueueRef.current;
      const isFirstTry = currentSource === "main" || currentRetryIndex === 0;

      // Record the answer event in the retry queue counter
      rq.recordAnswer();

      const result = await recordReview({
        wordId: card.id,
        correct,
        cardType: card.cardType,
        queueKind: card.kind,
        queueSource: currentSource,
        shownAt: currentAttemptRef.current?.shownAt,
        submittedAt: new Date().toISOString(),
        clientAttemptId: currentAttemptRef.current?.id,
        retryScheduledFor: null,
        firstTry: isFirstTry && currentSource !== "retry",
        retryIndex: currentRetryIndex,
        msSpent: Date.now() - startedAtRef.current,
        userAnswer,
        expected,
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      setTotalAnswered((n) => n + 1);

      // Enqueue for retry if incorrect and budget remains
      if (!correct) {
        rq.enqueue(card);
        setRetryPending(rq.pendingCount);
      }
      persistRetry();

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
        setFeedback({
          correct,
          expected: feedbackExpected,
        });
        setPhase("feedback");
        if (autoAdvanceCorrect) {
          scheduleSuccessAdvance();
        }
        return;
      }

      setFeedback({
        correct,
        expected: feedbackExpected,
      });

      if (!args.skipCorrection && (card.cardType === "cloze" || card.cardType === "sentences")) {
        revealCorrectionPlaceholder();
        setPhase("correction");
        return;
      }

      setPhase("feedback");
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to submit review",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleTypingCheck() {
    if (
      !current ||
      (current.cardType !== "cloze" && current.cardType !== "sentences") ||
      busy
    ) {
      return;
    }

    const userAnswer = typingInput.trim();
    if (!userAnswer) return;

    const expected = getTypingExpected(current);
    const correct = isCorrectClozeAnswer(
      userAnswer,
      expected,
      allowContainedTypingCandidateMatch(current, expected),
    );
    const feedbackExpected = getTypingExpectedLabel(current, expected);

    if (phase === "correction") {
      if (correct) {
        setFeedback({
          correct: true,
          expected: feedbackExpected,
        });
        setPhase("feedback");
        if (autoAdvanceCorrect) {
          scheduleSuccessAdvance();
        }
        return;
      }

      setTypingInput("");
      setFeedback({
        correct: false,
        expected: feedbackExpected,
      });
      revealCorrectionPlaceholder();
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
      setTypingInput("");
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

  async function handleTypingReveal() {
    if (
      !current ||
      (current.cardType !== "cloze" && current.cardType !== "sentences") ||
      busy
    ) {
      return;
    }

    const expected = getTypingExpected(current);
    const feedbackExpected = getTypingExpectedLabel(current, expected);

    setAnswerRevealed(true);

    await submitObjectiveReview({
      card: current,
      correct: false,
      userAnswer: "[revealed]",
      expected,
      feedbackExpected,
      skipCorrection: true,
    });
  }

  async function handleDontKnow() {
    if (!current || phase !== "prompt" || busy) return;
    if (current.cardType !== "audio" && current.cardType !== "mcq") return;

    setAnswerRevealed(true);

    await submitObjectiveReview({
      card: current,
      correct: false,
      userAnswer: "[dont_know]",
      expected: [current.correctOption],
      feedbackExpected: current.correctOption,
    });
  }

  async function handleNormalGrade(choice: NormalReviewChoice) {
    if (
      !current ||
      current.cardType !== "normal" ||
      phase !== "prompt" ||
      !normalRevealed ||
      busy
    ) {
      return;
    }

    const outcome = getNormalReviewOutcome(choice);

    setBusy(true);
    try {
      const rq = retryQueueRef.current;
      const isFirstTry = currentSource !== "retry";

      // Record the answer event in the retry queue counter
      rq.recordAnswer();

      const result = await recordReview({
        wordId: current.id,
        correct: outcome.correct,
        grade: outcome.grade,
        cardType: "normal",
        queueKind: current.kind,
        queueSource: currentSource,
        shownAt: currentAttemptRef.current?.shownAt,
        submittedAt: new Date().toISOString(),
        clientAttemptId: currentAttemptRef.current?.id,
        retryScheduledFor: null,
        firstTry: isFirstTry,
        retryIndex: currentRetryIndex,
        msSpent: Date.now() - startedAtRef.current,
        userAnswer: outcome.userAnswer,
        expected: [
          current.direction === "en_to_es"
            ? current.lemma
            : (current.definition ?? current.lemma),
        ],
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      setTotalAnswered((n) => n + 1);

      // Enqueue for retry if incorrect and budget remains
      if (outcome.retry) {
        rq.enqueue(current);
        setRetryPending(rq.pendingCount);
      }
      persistRetry();

      appendReviewedCard({
        card: current,
        source: currentSource,
        grade: outcome.grade,
      });
      setNormalSubmittedGrade(outcome.grade);

      setPhase("feedback");
      if (outcome.correct && autoAdvanceCorrect) {
        scheduleSuccessAdvance();
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to submit review",
      );
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
    historyIndex !== null ? (historyCards[activeHistoryIndex] ?? null) : null;
  const showingHistory = viewedSnapshot !== null;
  const canGoPrevious = !busy && !showingHistory && historyCards.length > 0;
  const canAdvanceLiveCard = !busy && phase === "feedback" && !showingHistory;
  const canGoNext =
    !busy && (showingHistory ? current !== null : canAdvanceLiveCard);
  const flashcardNavigation = (
    <FlashcardNavigation
      canGoPrevious={canGoPrevious}
      canGoNext={canGoNext}
      onPrevious={goToPreviousReviewedCard}
      onNext={goToNextCard}
    />
  );
  const totalDelivered = queue.length + extraCards.length;
  let progressTotal: number;
  if (manualTargetMode && !allExhausted) {
    // Chunked manual target: show full target as denominator
    progressTotal = dailyLimit;
  } else if (manualTargetMode && allExhausted) {
    // Supply exhausted before target met: reconcile to actual
    progressTotal = Math.max(1, normalizedInitialCompleted + totalDelivered);
  } else {
    // Recommended mode: original formula grounded in delivered queue
    progressTotal = Math.max(
      totalCards,
      Math.min(dailyLimit, normalizedInitialCompleted + totalCards),
    );
  }
  let completedCount: number;
  if (manualTargetMode) {
    // Retries count toward the manual target. totalAnswered is bumped after
    // recordReview succeeds, so the feedback phase already reflects the card
    // currently shown — no +1 trick needed.
    completedCount = Math.min(
      progressTotal,
      normalizedInitialCompleted + totalAnswered,
    );
  } else {
    const localCompletedCount =
      currentSource === "main" &&
      (phase === "feedback" || phase === "correction")
        ? mainCompletedCount + 1
        : mainCompletedCount;
    completedCount = Math.min(
      progressTotal,
      normalizedInitialCompleted + localCompletedCount,
    );
  }
  const progressPercent =
    progressTotal > 0 ? (100 * completedCount) / progressTotal : 0;
  const displayPosition = Math.min(
    progressTotal,
    completedCount + (phase === "prompt" ? 1 : 0),
  );
  const interactiveTextCloseSignal = current
    ? `${current.id}:${phase}:${historyIndex ?? "live"}`
    : `${phase}:${historyIndex ?? "live"}`;
  const interactiveTextContext =
    current?.cardType === "sentences"
      ? "sentence_card"
      : current?.cardType === "mcq" && current.questionFormat === "sentence"
        ? "mcq_sentence"
        : "flashcard";

  if (enabledImplementedTypes.length === 0) {
    return (
      <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-6">
        <section className="app-card flex flex-col gap-3 p-8">
          <h2 className="text-xl font-semibold tracking-tight">
            No implemented type enabled
          </h2>
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
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        No cards in this session.
      </p>
    );
  }

  function goToPreviousReviewedCard() {
    if (!canGoPrevious) return;
    clearSuccessAdvanceTimeout();
    setHistoryIndex(historyCards.length - 1);
  }

  function goToNextCard() {
    if (!canGoNext) return;

    if (showingHistory) {
      setHistoryIndex(null);
      return;
    }

    clearSuccessAdvanceTimeout();

    advanceFromCurrentCard();
  }

  return (
    <div className="flex flex-col gap-6">
      {workloadPolicy?.isComeback && !comebackDismissed ? (
        <div className="mx-auto flex w-full min-w-0 max-w-2xl items-start justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          <p>
            Welcome back! You have a larger backlog than usual — today&apos;s session is slightly longer to help you catch up.
          </p>
          <button
            type="button"
            className="shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
            onClick={() => setComebackDismissed(true)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ) : null}

      {phase === "done" && (unlimitedMode || shouldAutoLoadChunk) ? (
        <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col items-center gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900/50">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Loading more cards...
          </p>
          {unlimitedMode ? (
            <button
              type="button"
              className="text-sm text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              onClick={() => setUnlimitedMode(false)}
            >
              Stop and see results
            </button>
          ) : null}
        </div>
      ) : phase === "done" ? (
        (() => {
          const mainCards = reviewedCards.filter((r) => r.source === "main");
          const newCount = mainCards.filter(
            (r) => r.card.kind === "new",
          ).length;
          const reviewCount = mainCards.filter(
            (r) => r.card.kind === "review",
          ).length;
          const correctMain = mainCards.filter(
            (r) => r.feedback?.correct || r.grade === "good" || r.grade === "easy",
          ).length;
          const accuracy =
            mainCards.length > 0
              ? Math.round((100 * correctMain) / mainCards.length)
              : null;
          return (
            <PracticeCompleteScreen
              cardsPracticed={mainCards.length}
              newCardsPracticed={newCount}
              reviewCardsPracticed={reviewCount}
              accuracy={accuracy}
              timeOnTaskMs={Date.now() - sessionStartedAtRef.current}
              reviewsExhausted={reviewsExhausted}
              newWordsExhausted={newWordsExhausted}
              loadingMore={loadingMore}
              onLoadMore={(count) => void handleLoadMore(count)}
              onStartUnlimited={() => {
                setUnlimitedMode(true);
                void handleLoadMore(12);
              }}
            />
          );
        })()
      ) : current ? (
        <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-6">
          <SessionProgressBar
            completedCount={completedCount}
            displayPosition={displayPosition}
            progressPercent={progressPercent}
            progressTotal={progressTotal}
            hideTarget={unlimitedMode}
          />

          {showingHistory ? (
            <ReviewedFlashcardCard
              snapshot={viewedSnapshot}
              navigation={flashcardNavigation}
            />
          ) : current.cardType === "mcq" ? (
            <InteractiveTextProvider
              lang={FLASHCARD_LOOKUP_LANG}
              initialSavedWordIds={initialSavedWordIds}
              initialSavedLemmas={initialSavedLemmas}
              interactionContext={interactiveTextContext}
              closeSignal={interactiveTextCloseSignal}
              saveSource="flashcard"
            >
              <McqCard
                card={current}
                busy={busy}
                submitError={submitError}
                showPosHint={showPosHint}
                hideTranslation={hideTranslationSentences}
                feedback={feedback}
                dontKnowRevealed={answerRevealed}
                onSelect={(option) => {
                  void handleChoiceSelect(option);
                }}
                onDontKnow={() => {
                  void handleDontKnow();
                }}
                onNext={() => advanceFromCurrentCard()}
                navigation={flashcardNavigation}
              />
            </InteractiveTextProvider>
          ) : current.cardType === "sentences" ? (
            <InteractiveTextProvider
              lang={FLASHCARD_LOOKUP_LANG}
              initialSavedWordIds={initialSavedWordIds}
              initialSavedLemmas={initialSavedLemmas}
              interactionContext={interactiveTextContext}
              closeSignal={interactiveTextCloseSignal}
              saveSource="flashcard"
            >
              <SentenceCard
                card={current}
                value={typingInput}
                busy={busy}
                submitError={submitError}
                showPosHint={showPosHint}
                hideTranslation={hideTranslationSentences}
                feedback={feedback}
                correctionPlaceholder={
                  feedback?.expected
                }
                correctionPlaceholderVisible={showCorrectionPlaceholder}
                answerRevealed={answerRevealed}
                inputRef={typingInputRef}
                onChange={handleTypingInputChange}
                onCheck={() => {
                  void handleTypingCheck();
                }}
                onReveal={() => {
                  void handleTypingReveal();
                }}
                onNext={() => advanceFromCurrentCard()}
                navigation={flashcardNavigation}
              />
            </InteractiveTextProvider>
          ) : current.cardType === "cloze" ? (
            <ClozeCard
              card={current}
              value={typingInput}
              busy={busy}
              submitError={submitError}
              showPosHint={showPosHint}
              feedback={feedback}
              correctionPlaceholder={
                feedback?.expected
              }
              correctionPlaceholderVisible={showCorrectionPlaceholder}
              answerRevealed={answerRevealed}
              inputRef={typingInputRef}
              onChange={handleTypingInputChange}
              onCheck={() => {
                void handleTypingCheck();
              }}
              onReveal={() => {
                void handleTypingReveal();
              }}
              onNext={() => advanceFromCurrentCard()}
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
              dontKnowRevealed={answerRevealed}
              onSelect={(option) => {
                void handleChoiceSelect(option);
              }}
              onDontKnow={() => {
                void handleDontKnow();
              }}
              onNext={() => advanceFromCurrentCard()}
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
        <ReviewedSentenceCard card={card} answer={feedback?.expected} />
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
      : (splitDefinitionCandidates(getEnglishPromptText(card))[0] ??
        getEnglishPromptText(card) ??
        "—"));

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div>
        <p className="text-sm uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          {card.direction === "en_to_es" ? "Meaning" : "Word"}
        </p>
        <p className="mt-2 text-zinc-800 dark:text-zinc-100">
          {card.direction === "en_to_es"
            ? (getEnglishPromptText(card) ?? "—")
            : card.lemma}
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
  const promptValue =
    card.direction === "en_to_es" ? (getEnglishPromptText(card) ?? "—") : card.lemma;
  const answerLabel = card.direction === "en_to_es" ? "Word" : "Meaning";
  const answerValue =
    card.direction === "en_to_es" ? card.lemma : (getEnglishPromptText(card) ?? "—");
  const resultLabel = getNormalReviewResultLabel(grade);

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

      {resultLabel ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200">
          Result: <span className="font-medium">{resultLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

function ReviewedChoiceCard({
  card,
  title,
  subtitle,
  feedback,
  userAnswer,
}: {
  card: Extract<UnifiedQueueCard, { cardType: "audio" | "mcq" }>;
  title: string;
  subtitle: string;
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
        {card.cardType === "mcq" &&
        card.questionFormat === "sentence" &&
        card.sentenceData ? (
          <SentenceClozePrompt
            sentence={card.sentenceData.sentence}
            className="mt-4 text-xl font-medium tracking-tight text-zinc-900 dark:text-zinc-100"
          />
        ) : null}
        {card.hint ? (
          <p className="mt-2 text-sm text-zinc-500">({card.hint})</p>
        ) : null}
      </div>

      {card.cardType === "mcq" && card.questionFormat === "sentence" ? (
        <ReviewedSentenceSupport
          translation={card.translation ?? null}
          englishSentence={card.exampleSentenceEn ?? null}
        />
      ) : null}

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
  const resolvedAnswer = answer ?? card.correctOption;

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div>
        <p className="text-sm uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          Complete the sentence
        </p>
        <SentenceClozePrompt
          sentence={card.sentenceData.sentence}
          className="mt-4 text-xl font-medium tracking-tight text-zinc-900 dark:text-zinc-100"
          blankContent={<ReviewedInlineAnswerField answer={resolvedAnswer} />}
        />
        {card.hint ? (
          <p className="mt-2 text-sm text-zinc-500">({card.hint})</p>
        ) : null}
      </div>

      <ReviewedSentenceSupport
        translation={card.translation ?? null}
        englishSentence={card.exampleSentenceEn ?? null}
      />
    </div>
  );
}

function ReviewedInlineAnswerField({
  answer,
}: {
  answer: string;
}) {
  return (
    <span className="mx-1 inline-flex min-w-16 items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 align-middle text-base font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
      {answer}
    </span>
  );
}

function ReviewedSentenceSupport({
  translation,
  englishSentence,
}: {
  translation: string | null;
  englishSentence: string | null;
}) {
  const [expanded, setExpanded] = useState(() =>
    readStoredBoolean(REVIEWED_SENTENCE_SUPPORT_EXPANDED_STORAGE_KEY),
  );
  const wordTranslation = translation?.trim() || null;
  const normalizedEnglishSentence = englishSentence?.trim() || null;

  useEffect(() => {
    try {
      window.localStorage.setItem(
        REVIEWED_SENTENCE_SUPPORT_EXPANDED_STORAGE_KEY,
        expanded ? "true" : "false",
      );
    } catch {
      // Ignore unavailable storage.
    }
  }, [expanded]);

  if (!wordTranslation && !normalizedEnglishSentence) {
    return null;
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-base font-medium text-zinc-900 dark:text-zinc-100">
            {wordTranslation ?? "Unavailable"}
          </p>
        </div>
        {normalizedEnglishSentence ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            {expanded ? "Hide sentence" : "Show sentence"}
          </button>
        ) : null}
      </div>

      {expanded && normalizedEnglishSentence ? (
        <div className="mt-3 pt-1">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {normalizedEnglishSentence}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function readStoredBoolean(key: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
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
  displayPosition,
  progressPercent,
  progressTotal,
  hideTarget,
}: {
  completedCount: number;
  displayPosition: number;
  progressPercent: number;
  progressTotal: number;
  hideTarget?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex justify-between text-sm text-zinc-500 dark:text-zinc-400">
          <span>
            {hideTarget
              ? `Card ${displayPosition}`
              : `Card ${displayPosition} of ${progressTotal}`}
          </span>
          {hideTarget ? null : <span>{Math.round(progressPercent)}%</span>}
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

function ComingSoonNotice({
  enabledTypes,
}: {
  enabledTypes: EnabledFlashcardMode[];
}) {
  return (
    <section className="app-card-muted p-4 text-sm text-zinc-600 dark:text-zinc-300">
      Enabled but not implemented yet:{" "}
      {enabledTypes.map((type) => TYPE_LABELS[type]).join(", ")}.
    </section>
  );
}
