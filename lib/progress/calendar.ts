import { getAppSessionDate, shiftSessionDate } from "@/lib/analytics/date";
import { getUserAnalyticsBundle } from "@/lib/analytics/service";
import type { DailyAggregate } from "@/lib/analytics/types";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = NonNullable<
  Awaited<ReturnType<typeof createSupabaseServerClient>>
>;

export type CalendarDayStatus = "empty" | "partial" | "completed";

export type CalendarDayMetrics = {
  date: string;
  status: CalendarDayStatus;
  usedApp: boolean;
  flashcardsDone: number;
  flashcardsAssigned: number;
  flashcardAttempts: number;
  flashcardAccuracy: number | null;
  newWords: number;
  reviewsDone: number;
  savedWords: number;
  readingCompleted: boolean;
  listeningCompleted: boolean;
  timeOnTaskMinutes: number;
  retryCount: number;
};

export type CalendarRangeTotals = {
  activeDays: number;
  completedDays: number;
  completionRate: number | null;
  totalFlashcards: number;
  averageAccuracy: number | null;
  totalMinutes: number;
};

export type CalendarMonthSummary = CalendarRangeTotals & {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  days: CalendarDayMetrics[];
};

export type CalendarWeekSummary = CalendarRangeTotals & {
  startDate: string;
  endDate: string;
  days: CalendarDayMetrics[];
};

export function toCalendarDayMetrics(day: DailyAggregate): CalendarDayMetrics {
  const status: CalendarDayStatus = day.session_completed
    ? "completed"
    : day.days_active_flag
      ? "partial"
      : "empty";

  return {
    date: day.session_date,
    status,
    usedApp: day.days_active_flag,
    flashcardsDone: day.flashcard_completed_count,
    flashcardsAssigned: day.assigned_flashcard_count,
    flashcardAttempts: day.flashcard_attempts_count,
    flashcardAccuracy: day.flashcard_accuracy,
    newWords: day.flashcard_new_completed_count,
    reviewsDone: day.flashcard_review_completed_count,
    savedWords: day.reader_saved_words_count,
    readingCompleted: day.reading_completed,
    listeningCompleted: day.listening_completed,
    timeOnTaskMinutes: Math.round(day.total_time_seconds / 60),
    retryCount: day.flashcard_retry_count,
  };
}

function daysInCalendarMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function getMonthRange(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const last = daysInCalendarMonth(year, month);
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(last).padStart(2, "0")}`,
  };
}

export function getWeekRange(anchorDate: string, weekStartsOn: 0 | 1 = 1) {
  const anchor = new Date(`${anchorDate}T00:00:00.000Z`);
  const weekday = anchor.getUTCDay();
  const offset = (weekday - weekStartsOn + 7) % 7;
  const from = shiftSessionDate(anchorDate, -offset);
  const to = shiftSessionDate(from, 6);
  return { from, to };
}

export function shiftMonth(year: number, month: number, delta: number) {
  const zeroBased = (month - 1) + delta;
  const y = year + Math.floor(zeroBased / 12);
  const m = ((zeroBased % 12) + 12) % 12;
  return { year: y, month: m + 1 };
}

export function parseYearMonth(
  yearParam: string | undefined,
  monthParam: string | undefined,
) {
  const today = getAppSessionDate();
  const [ty, tm] = today.split("-").map(Number);
  const y = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : ty;
  const m =
    monthParam && /^\d{1,2}$/.test(monthParam)
      ? Math.min(12, Math.max(1, Number(monthParam)))
      : tm;
  return { year: y, month: m };
}

function summarize(days: CalendarDayMetrics[]): CalendarRangeTotals {
  const activeDays = days.filter((d) => d.usedApp).length;
  const completedDays = days.filter((d) => d.status === "completed").length;
  const completionRate = activeDays > 0 ? completedDays / activeDays : null;
  const totalFlashcards = days.reduce((t, d) => t + d.flashcardsDone, 0);

  // Weight by flashcardAttempts (all review_events, retries included) to match
  // the source-of-truth denominator in buildAnalyticsSummary:
  //   flashcard_accuracy = correctAttempts / reviewEvents.length
  // Since dailyAccuracy = dailyCorrect / dailyAttempts, summing acc * attempts
  // gives exact total correct, so the ratio is identical to the source-of-truth.
  let weightedCorrect = 0;
  let weightedAttempts = 0;
  for (const d of days) {
    if (d.flashcardAccuracy !== null && d.flashcardAttempts > 0) {
      weightedCorrect += d.flashcardAccuracy * d.flashcardAttempts;
      weightedAttempts += d.flashcardAttempts;
    }
  }
  const averageAccuracy =
    weightedAttempts > 0 ? weightedCorrect / weightedAttempts : null;

  const totalMinutes = days.reduce((t, d) => t + d.timeOnTaskMinutes, 0);

  return {
    activeDays,
    completedDays,
    completionRate,
    totalFlashcards,
    averageAccuracy,
    totalMinutes,
  };
}

export async function getCalendarRangeSummary(
  supabase: SupabaseServerClient,
  userId: string,
  from: string,
  to: string,
): Promise<CalendarDayMetrics[]> {
  const bundle = await getUserAnalyticsBundle(supabase, userId, { from, to });
  return bundle.dailyAggregates.map(toCalendarDayMetrics);
}

export async function getCalendarMonthSummary(
  supabase: SupabaseServerClient,
  userId: string,
  year: number,
  month: number,
): Promise<CalendarMonthSummary> {
  const { from, to } = getMonthRange(year, month);
  const days = await getCalendarRangeSummary(supabase, userId, from, to);
  return { year, month, startDate: from, endDate: to, days, ...summarize(days) };
}

export async function getCalendarWeekSummary(
  supabase: SupabaseServerClient,
  userId: string,
  anchorDate: string = getAppSessionDate(),
): Promise<CalendarWeekSummary> {
  const { from, to } = getWeekRange(anchorDate);
  const days = await getCalendarRangeSummary(supabase, userId, from, to);
  return { startDate: from, endDate: to, days, ...summarize(days) };
}

export function getCalendarDayMetrics(
  days: CalendarDayMetrics[],
  date: string,
): CalendarDayMetrics | null {
  return days.find((d) => d.date === date) ?? null;
}

export { summarize as summariseCalendarDays };
