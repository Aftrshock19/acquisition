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

// Pre-flattened lookup shapes shared by /done and the calendar aggregator.
// Both surfaces normalise their per-row reads into these structural types so
// `buildDailyLoopSummary` can stay pure.
export type ReadingTextLookup = {
  word_count: number | null;
  estimated_minutes: number | null;
  display_label: string | null;
};

export type ListeningAudioLookup = {
  duration_seconds: number | null;
  display_label: string | null;
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
// Reading + listening blocks (pure)
// ---------------------------------------------------------------------------

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

function buildReadingSummary(
  done: boolean,
  timeSeconds: number,
  textLookup: ReadingTextLookup | null,
): ReadingSummary {
  if (!done) {
    return {
      completed: false,
      completedCount: 0,
      totalWords: null,
      totalMinutes: null,
      displayLabel: null,
    };
  }
  if (!textLookup) {
    return {
      completed: true,
      completedCount: 1,
      totalWords: null,
      totalMinutes: null,
      displayLabel: null,
    };
  }
  const totalMinutes =
    timeSeconds > 0
      ? Math.round(timeSeconds / 60)
      : textLookup.estimated_minutes ?? null;
  return {
    completed: true,
    completedCount: 1,
    totalWords: textLookup.word_count ?? null,
    totalMinutes,
    displayLabel: textLookup.display_label ?? null,
  };
}

function buildListeningSummary(
  done: boolean,
  timeSeconds: number,
  audioLookup: ListeningAudioLookup | null,
): ListeningSummary {
  if (!done) {
    return {
      completed: false,
      completedCount: 0,
      totalMinutes: null,
      displayLabel: null,
    };
  }
  if (!audioLookup) {
    return {
      completed: true,
      completedCount: 1,
      totalMinutes: null,
      displayLabel: null,
    };
  }
  const totalMinutes =
    listeningMinutes(audioLookup.duration_seconds) ??
    listeningMinutes(timeSeconds);
  return {
    completed: true,
    completedCount: 1,
    totalMinutes,
    displayLabel: audioLookup.display_label,
  };
}

// ---------------------------------------------------------------------------
// Pure aggregator: full DailyLoopSummary from already-normalised inputs
// ---------------------------------------------------------------------------

export type DailyLoopSummaryFlashcardInput = Pick<
  DailySessionRow,
  | "flashcard_completed_count"
  | "flashcard_new_completed_count"
  | "flashcard_review_completed_count"
  | "flashcard_attempts_count"
  | "flashcard_retry_count"
>;

export type DailyLoopSummaryInput = {
  flashcards: DailyLoopSummaryFlashcardInput | null;
  reading: { done: boolean; timeSeconds: number };
  listening: { done: boolean; timeSeconds: number };
};

/**
 * Pure builder used by both /done (`loadDailyLoopSummary`) and the calendar
 * day-detail aggregator (`buildLoopSummariesByDate`). Caller is responsible
 * for fetching and normalising the per-text and per-audio lookups; this
 * function just shapes the result.
 */
export function buildDailyLoopSummary(
  input: DailyLoopSummaryInput,
  textLookup: ReadingTextLookup | null,
  audioLookup: ListeningAudioLookup | null,
): DailyLoopSummary {
  return {
    flashcards: computeFlashcardSummary(input.flashcards),
    reading: buildReadingSummary(input.reading.done, input.reading.timeSeconds, textLookup),
    listening: buildListeningSummary(
      input.listening.done,
      input.listening.timeSeconds,
      audioLookup,
    ),
  };
}

// ---------------------------------------------------------------------------
// Calendar aggregator: many days, pre-fetched lookup maps
// ---------------------------------------------------------------------------

export type CalendarLoopSummaryDay = {
  date: string;
  usedApp: boolean;
  flashcardsDone: number;
  newWords: number;
  reviewsDone: number;
  flashcardAttempts: number;
  retryCount: number;
  readingCompleted: boolean;
  readingTextId: string | null;
  readingTimeSeconds: number;
  listeningCompleted: boolean;
  listeningAssetId: string | null;
  listeningTimeSeconds: number;
};

/**
 * Build a `date → DailyLoopSummary` map for the visible calendar range.
 * Empty days (no app activity) are skipped — the day-detail panel keeps its
 * "No activity" rendering for those.
 */
export function buildLoopSummariesByDate(
  days: ReadonlyArray<CalendarLoopSummaryDay>,
  texts: ReadonlyMap<string, ReadingTextLookup>,
  audios: ReadonlyMap<string, ListeningAudioLookup>,
): Record<string, DailyLoopSummary> {
  const out: Record<string, DailyLoopSummary> = {};
  for (const day of days) {
    if (!day.usedApp) continue;
    const text = day.readingTextId ? texts.get(day.readingTextId) ?? null : null;
    const audio = day.listeningAssetId
      ? audios.get(day.listeningAssetId) ?? null
      : null;
    out[day.date] = buildDailyLoopSummary(
      {
        flashcards: {
          flashcard_completed_count: day.flashcardsDone,
          flashcard_new_completed_count: day.newWords,
          flashcard_review_completed_count: day.reviewsDone,
          flashcard_attempts_count: day.flashcardAttempts,
          flashcard_retry_count: day.retryCount,
        },
        reading: { done: day.readingCompleted, timeSeconds: day.readingTimeSeconds },
        listening: { done: day.listeningCompleted, timeSeconds: day.listeningTimeSeconds },
      },
      text,
      audio,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// /done loader: fetches a single user's text + audio rows then builds.
// ---------------------------------------------------------------------------

type AudioJoinedTextRow = {
  id: string;
  duration_seconds: number | null;
  text: { display_label: string | null } | { display_label: string | null }[] | null;
};

function pickJoinedDisplayLabel(text: AudioJoinedTextRow["text"]): string | null {
  if (!text) return null;
  if (Array.isArray(text)) return text[0]?.display_label ?? null;
  return text.display_label ?? null;
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

  const text = textResult.data as
    | { word_count: number | null; estimated_minutes: number | null; display_label: string | null }
    | null;
  const audio = audioResult.data as AudioJoinedTextRow | null;

  return buildDailyLoopSummary(
    {
      flashcards: dailySession,
      reading: {
        done: dailySession.reading_done,
        timeSeconds: dailySession.reading_time_seconds,
      },
      listening: {
        done: dailySession.listening_done,
        timeSeconds: dailySession.listening_time_seconds,
      },
    },
    text
      ? {
          word_count: text.word_count,
          estimated_minutes: text.estimated_minutes,
          display_label: text.display_label,
        }
      : null,
    audio
      ? {
          duration_seconds: audio.duration_seconds,
          display_label: pickJoinedDisplayLabel(audio.text),
        }
      : null,
  );
}
