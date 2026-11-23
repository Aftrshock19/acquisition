/**
 * Session-cap decisions for TodaySession. `attempts` is every submitted
 * answer today (main + retry), the unit record_review counts against
 * daily_sessions.assigned_flashcard_count; `dailyLimit` is that stored target
 * (getTodayFlashcards returns it), so `attempts < dailyLimit` means the
 * server still has the day at stage='flashcards'.
 */

/**
 * The sitting reached its practice-complete screen below today's target
 * with nothing further being loaded (manual auto-load gave up because supply
 * ran out, or the recommended queue was shorter than the target). The skip
 * must then be persisted, otherwise the row stays stage='flashcards' and the
 * reading/listening steps cannot complete the day.
 */
export function shouldPersistFlashcardsSkip({
  phase,
  unlimitedMode,
  loadingMore,
  willAutoLoad,
  attempts,
  dailyLimit,
}: {
  phase: string;
  unlimitedMode: boolean;
  loadingMore: boolean;
  willAutoLoad: boolean;
  attempts: number;
  dailyLimit: number;
}): boolean {
  return (
    phase === "done" &&
    !unlimitedMode &&
    !loadingMore &&
    !willAutoLoad &&
    attempts < dailyLimit
  );
}

/**
 * "Do more flashcards" on the practice-complete screen: allow `count` more
 * answers in this sitting beyond those already given. Without this the cap
 * (still at the stored target) ended the session after the first extra card.
 */
export function getExtendedSessionCap(
  currentCap: number,
  attempts: number,
  count: number,
): number {
  return Math.max(currentCap, attempts + Math.max(0, count));
}
