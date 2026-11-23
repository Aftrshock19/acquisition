import type { DailySessionRow } from "@/lib/srs/types";

/**
 * Daily-loop stage rule shared by every TS writer of daily_sessions.
 *
 * MUST stay identical to the `v_session_stage` CASE inside the live
 * public.record_review (latest definition in supabase/migrations/, currently
 * 20261102120000_daily_loop_completion_and_scheduler_outcome.sql):
 *
 *   flashcards_pending := flashcard_attempts_count < assigned_flashcard_count
 *                         AND flashcards_skipped_at IS NULL
 *   stage := 'flashcards' if flashcards_pending
 *            else 'reading' if NOT reading_done
 *            else 'listening' if NOT listening_done
 *            else 'completed'
 *   completed := (stage = 'completed')
 *
 * Flashcard units are ATTEMPTS (main + retry): record_review increments
 * flashcard_attempts_count on every submitted answer, and the client session
 * cap counts retries too ("Retries count strictly toward the target").
 *
 * flashcards_completed_at and completed_at are first-reached timestamps:
 * set the first time the condition holds and never cleared afterwards
 * (including by "Do more flashcards").
 */

export type DailySessionProgressState = {
  assignedFlashcardCount: number;
  assignedNewWordsCount: number;
  assignedReviewCardsCount: number;
  flashcardCompletedCount: number;
  flashcardAttemptsCount: number;
  flashcardsSkipped: boolean;
  readingDone: boolean;
  listeningDone: boolean;
};

export type DailySessionProgressSource = {
  assigned_flashcard_count?: number | null;
  assigned_new_words_count?: number | null;
  assigned_review_cards_count?: number | null;
  flashcard_completed_count?: number | null;
  flashcard_attempts_count?: number | null;
  flashcards_skipped_at?: string | null;
  new_words_count?: number | null;
  reviews_done?: number | null;
  reading_done?: boolean | null;
  listening_done?: boolean | null;
};

// INVARIANT: once a daily_sessions row exists, assignedFlashcardCount must be
// returned as-is from the existing row. Do not max it against completed
// counts. The "Do more flashcards" path legitimately mutates the column via
// extendFlashcardsSession, but any other code path reaching this helper with
// an existing row must preserve the value. The upsert call sites in
// app/actions/srs.ts (upsertDailySession, extendFlashcardsSession,
// completeReadingStep, completeListeningStep, markReadingOpened,
// markListeningOpened) pass the result of this helper through to their own
// upsert payloads, relying on this preservation. If you change this helper
// back to max semantics, you silently corrupt research data across all call
// sites.
export function getDailySessionProgressState(
  current: DailySessionProgressSource | null,
  fallbackCounts?: {
    assignedFlashcardCount?: number;
    assignedNewWordsCount?: number;
    assignedReviewCardsCount?: number;
  },
): DailySessionProgressState {
  const assignedFlashcardCount = Math.max(
    0,
    current?.assigned_flashcard_count ??
      current?.new_words_count ??
      fallbackCounts?.assignedFlashcardCount ??
      0,
  );
  const assignedNewWordsCount = Math.max(
    0,
    current?.assigned_new_words_count ?? fallbackCounts?.assignedNewWordsCount ?? 0,
  );
  const assignedReviewCardsCount = Math.max(
    0,
    current?.assigned_review_cards_count ??
      fallbackCounts?.assignedReviewCardsCount ??
      0,
  );
  const flashcardCompletedCount = Math.max(
    0,
    current?.flashcard_completed_count ?? current?.reviews_done ?? 0,
  );
  const flashcardAttemptsCount = getFlashcardAttemptsCount(current);

  const hasExistingAssigned =
    current?.assigned_flashcard_count != null || current?.new_words_count != null;

  return {
    assignedFlashcardCount: hasExistingAssigned
      ? assignedFlashcardCount
      : Math.max(
          assignedFlashcardCount,
          flashcardCompletedCount,
          assignedNewWordsCount + assignedReviewCardsCount,
        ),
    assignedNewWordsCount,
    assignedReviewCardsCount,
    flashcardCompletedCount,
    flashcardAttemptsCount,
    flashcardsSkipped: current?.flashcards_skipped_at != null,
    readingDone: current?.reading_done ?? false,
    listeningDone: current?.listening_done ?? false,
  };
}

/**
 * Flashcard units done today: every submitted answer, main queue and retry.
 * Falls back to the main-queue counters only for rows that predate the
 * attempts column (it has been NOT NULL DEFAULT 0 since 20260410140000).
 */
export function getFlashcardAttemptsCount(
  current: Pick<
    DailySessionProgressSource,
    "flashcard_attempts_count" | "flashcard_completed_count" | "reviews_done"
  > | null,
): number {
  return Math.max(
    0,
    current?.flashcard_attempts_count ??
      current?.flashcard_completed_count ??
      current?.reviews_done ??
      0,
  );
}

export function isFlashcardsPending(state: DailySessionProgressState): boolean {
  return (
    state.flashcardAttemptsCount < state.assignedFlashcardCount &&
    !state.flashcardsSkipped
  );
}

export function resolveDailySessionStage(
  state: DailySessionProgressState,
): DailySessionRow["stage"] {
  if (isFlashcardsPending(state)) {
    return "flashcards";
  }

  if (!state.readingDone) {
    return "reading";
  }

  if (!state.listeningDone) {
    return "listening";
  }

  return "completed";
}

export function getDailySessionCompleted(state: DailySessionProgressState) {
  return resolveDailySessionStage(state) === "completed";
}

/** First time flashcards stop being pending; never cleared once set. */
export function resolveFlashcardsCompletedAt(
  existing: string | null | undefined,
  state: DailySessionProgressState,
  now: string,
): string | null {
  if (existing) return existing;
  return isFlashcardsPending(state) ? null : now;
}

/** First time the stage reaches 'completed'; never cleared once set. */
export function resolveCompletedAt(
  existing: string | null | undefined,
  state: DailySessionProgressState,
  now: string,
): string | null {
  if (existing) return existing;
  return getDailySessionCompleted(state) ? now : null;
}

/**
 * "Do more flashcards": require `count` more attempts beyond whatever has
 * already been done (attempts can exceed the target when the client keeps
 * going past it), and clear any earlier "Continue to reading" skip so the
 * flashcard stage is pending again. The resulting stage is always
 * 'flashcards'; the caller keeps flashcards_completed_at and completed_at.
 *
 * After a skip, attempts sit below the stored target, so the target is
 * re-based on attempts (attempts + count) rather than raised from the old
 * target; otherwise the user would owe the skipped remainder as well.
 */
export function buildExtendedProgress(
  current: DailySessionProgressState,
  count: number,
): DailySessionProgressState {
  const base = current.flashcardsSkipped
    ? current.flashcardAttemptsCount
    : Math.max(current.assignedFlashcardCount, current.flashcardAttemptsCount);
  return {
    ...current,
    assignedFlashcardCount: base + count,
    assignedNewWordsCount: current.assignedNewWordsCount + count,
    flashcardsSkipped: false,
  };
}

/**
 * "No more words available → Continue to reading": flashcards stop being
 * pending for the rest of the day even though attempts < target. Returns null
 * when there is nothing to skip (flashcards are not pending).
 */
export function buildSkippedProgress(
  current: DailySessionProgressState,
): DailySessionProgressState | null {
  if (!isFlashcardsPending(current)) return null;
  return { ...current, flashcardsSkipped: true };
}

/**
 * Value stored in assigned_flashcard_count when today's row is first
 * created. A user-driven (manual) target stores the full effective target
 * (e.g. 100) even though the first load only fetches a 50-card chunk; the
 * recommended autopilot stores the size of the queue it actually assigned.
 */
export function getInitialAssignedFlashcardCount({
  isUserDrivenTarget,
  sessionTargetCount,
  loadedCardCount,
}: {
  isUserDrivenTarget: boolean;
  sessionTargetCount: number;
  loadedCardCount: number;
}): number {
  return isUserDrivenTarget
    ? Math.max(0, sessionTargetCount, loadedCardCount)
    : Math.max(0, loadedCardCount);
}
