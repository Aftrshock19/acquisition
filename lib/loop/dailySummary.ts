import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailySessionRow } from "@/lib/srs/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlashcardSummary = {
  cardsPracticed: number;
  newCount: number;
  reviewCount: number;
  attempts: number;
  retries: number;
  accuracyPercent: number | null;
  showAccuracy: boolean;
  showAttemptsLine: boolean;
};

export type ReadingSummary = {
  completed: boolean;
  completedCount: number;
  totalWords: number | null;
  totalMinutes: number | null;
  displayLabel: string | null;
};

export type ListeningSummary = {
  completed: boolean;
  completedCount: number;
  totalMinutes: number | null;
  displayLabel: string | null;
};

export type DailyLoopSummary = {
  flashcards: FlashcardSummary;
  reading: ReadingSummary;
  listening: ListeningSummary;
};

// ---------------------------------------------------------------------------
// Pure helper: flashcard block
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Derive the flashcard summary from a daily_sessions row. Pure: no IO, no
 * Supabase access. The component renders directly from this shape.
 *
 * Accuracy is `1 - retries / attempts` clamped to [0, 1]. Defensive against
 * legacy rows where retries > attempts.
 *
 * `showAccuracy` is the rendering gate: hide the accuracy clause when there
 * is no signal (no reviews graded AND no retry events). For an all-new
 * session with zero retries, the implied accuracy is 100% but conveys nothing
 * useful, so we don't show it.
 */
export function computeFlashcardSummary(
  dailySession: Pick<
    DailySessionRow,
    | "flashcard_completed_count"
    | "flashcard_new_completed_count"
    | "flashcard_review_completed_count"
    | "flashcard_attempts_count"
    | "flashcard_retry_count"
  > | null,
): FlashcardSummary {
  const cardsPracticed = Math.max(0, dailySession?.flashcard_completed_count ?? 0);
  const newCount = Math.max(0, dailySession?.flashcard_new_completed_count ?? 0);
  const reviewCount = Math.max(0, dailySession?.flashcard_review_completed_count ?? 0);
  const rawAttempts = dailySession?.flashcard_attempts_count;
  const attempts = Math.max(
    0,
    rawAttempts == null ? cardsPracticed : rawAttempts,
  );
  const retries = Math.max(0, dailySession?.flashcard_retry_count ?? 0);

  const accuracy =
    attempts > 0 ? clamp01(1 - retries / attempts) : null;
  const accuracyPercent =
    accuracy == null ? null : Math.round(accuracy * 100);

  const showAccuracy =
    accuracyPercent !== null && (reviewCount > 0 || retries > 0);
  const showAttemptsLine = attempts !== cardsPracticed;

  return {
    cardsPracticed,
    newCount,
    reviewCount,
    attempts,
    retries,
    accuracyPercent,
    showAccuracy,
    showAttemptsLine,
  };
}

// ---------------------------------------------------------------------------
// Async helper: assemble the full DailyLoopSummary
// ---------------------------------------------------------------------------

type TextLookupRow = {
  id: string;
  word_count: number | null;
  estimated_minutes: number | null;
  display_label: string | null;
};

type AudioLookupRow = {
  id: string;
  duration_seconds: number | null;
  text: { display_label: string | null } | { display_label: string | null }[] | null;
};

function pickJoinedDisplayLabel(text: AudioLookupRow["text"]): string | null {
  if (!text) return null;
  if (Array.isArray(text)) return text[0]?.display_label ?? null;
  return text.display_label ?? null;
}

/**
 * Convert seconds to whole minutes for a *completed* listening item. A
 * completed track with a few seconds of duration must not visually read as
 * "0 min" — that suggests no listening at all. We floor at 1 min when there
 * is any positive duration. Returns null when there is genuinely no data.
 */
function listeningMinutes(seconds: number | null | undefined): number | null {
  if (!seconds || seconds <= 0) return null;
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * Fetch the per-text and per-audio lookups needed for the reading and
 * listening blocks. Both queries are filtered by primary key, run in
 * parallel, and skipped entirely when the corresponding `*_done` flag is
 * false. Failures fall back to "Reading completed" / "Listening completed"
 * copy via null stats — they never block the summary render.
 */
export async function loadDailyLoopSummary(
  supabase: SupabaseClient,
  dailySession: DailySessionRow,
): Promise<DailyLoopSummary> {
  const flashcards = computeFlashcardSummary(dailySession);

  const wantReading =
    dailySession.reading_done && Boolean(dailySession.reading_text_id);
  const wantListening =
    dailySession.listening_done && Boolean(dailySession.listening_asset_id);

  const [textResult, audioResult] = await Promise.all([
    wantReading
      ? supabase
          .from("texts")
          .select("id, word_count, estimated_minutes, display_label")
          .eq("id", dailySession.reading_text_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    wantListening
      ? supabase
          .from("audio")
          .select("id, duration_seconds, text:texts(display_label)")
          .eq("id", dailySession.listening_asset_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const reading: ReadingSummary = (() => {
    if (!dailySession.reading_done) {
      return {
        completed: false,
        completedCount: 0,
        totalWords: null,
        totalMinutes: null,
        displayLabel: null,
      };
    }
    const text = (textResult.data as TextLookupRow | null) ?? null;
    if (!text) {
      return {
        completed: true,
        completedCount: 1,
        totalWords: null,
        totalMinutes: null,
        displayLabel: null,
      };
    }
    const totalMinutes =
      dailySession.reading_time_seconds > 0
        ? Math.round(dailySession.reading_time_seconds / 60)
        : text.estimated_minutes ?? null;
    return {
      completed: true,
      completedCount: 1,
      totalWords: text.word_count ?? null,
      totalMinutes,
      displayLabel: text.display_label ?? null,
    };
  })();

  const listening: ListeningSummary = (() => {
    if (!dailySession.listening_done) {
      return {
        completed: false,
        completedCount: 0,
        totalMinutes: null,
        displayLabel: null,
      };
    }
    const audio = (audioResult.data as AudioLookupRow | null) ?? null;
    if (!audio) {
      return {
        completed: true,
        completedCount: 1,
        totalMinutes: null,
        displayLabel: null,
      };
    }
    const totalMinutes =
      listeningMinutes(audio.duration_seconds) ??
      listeningMinutes(dailySession.listening_time_seconds);
    return {
      completed: true,
      completedCount: 1,
      totalMinutes,
      displayLabel: pickJoinedDisplayLabel(audio.text),
    };
  })();

  return { flashcards, reading, listening };
}
