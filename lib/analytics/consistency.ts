import { getAppSessionDate } from "@/lib/analytics/date";
import { anonymizeUserId } from "@/lib/analytics/export";
import type { AnalyticsBundle, ConsistencyIssue } from "@/lib/analytics/types";

const MAX_REVIEW_MS_SPENT = 30 * 60 * 1000;

export function getConsistencyIssues(
  bundle: AnalyticsBundle,
  userId: string,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const expectedAnonymousId = anonymizeUserId(userId);

  const duplicateAttemptIds = new Map<string, number>();
  for (const row of bundle.reviewEvents) {
    if (!row.client_attempt_id) {
      continue;
    }
    duplicateAttemptIds.set(
      row.client_attempt_id,
      (duplicateAttemptIds.get(row.client_attempt_id) ?? 0) + 1,
    );
  }
  const duplicateAttemptDetails = Array.from(duplicateAttemptIds.entries())
    .filter(([, count]) => count > 1)
    .map(([attemptId, count]) => `${attemptId} (${count})`);
  if (duplicateAttemptDetails.length > 0) {
    issues.push({
      id: "duplicate-review-attempts",
      severity: "error",
      message: "Duplicate review attempt IDs detected.",
      details: duplicateAttemptDetails,
    });
  }

  const missingReviewSessionLinks = bundle.reviewEvents
    .filter((row) => !row.daily_session_id)
    .map((row) => `${row.id} (${row.session_date ?? "no-session-date"})`);
  if (missingReviewSessionLinks.length > 0) {
    issues.push({
      id: "missing-review-session-links",
      severity: "warning",
      message: "Review attempts without a linked daily session were found.",
      details: missingReviewSessionLinks,
    });
  }

  const impossibleSessionStates = bundle.sessions.flatMap((session) => {
    const reasons: string[] = [];
    if (session.stage === "flashcards" && (session.reading_done || session.listening_done)) {
      reasons.push("stage is flashcards after later-stage completion");
    }
    if (session.stage === "reading" && session.listening_done && !session.reading_done) {
      reasons.push("listening is done before reading is done");
    }
    if (session.stage === "complete" && !session.completed) {
      reasons.push("stage is complete but completed=false");
    }
    if (session.completed && !session.completed_at) {
      reasons.push("completed=true but completed_at is missing");
    }
    if (session.completed && !session.reading_done) {
      reasons.push("completed session is missing reading_done=true");
    }
    if (session.listening_asset_id && session.completed && !session.listening_done) {
      reasons.push("completed session with listening asset is missing listening_done=true");
    }
    if (
      session.flashcard_completed_count > session.assigned_flashcard_count &&
      session.assigned_flashcard_count >= 0
    ) {
      reasons.push("flashcard_completed_count exceeds assigned_flashcard_count");
    }
    if (
      session.flashcard_new_completed_count + session.flashcard_review_completed_count >
      session.flashcard_completed_count
    ) {
      reasons.push("new/review completion counts exceed total flashcard completions");
    }
    if (session.reading_done && !session.reading_completed_at) {
      reasons.push("reading_done=true but reading_completed_at is missing");
    }
    if (
      session.listening_asset_id &&
      session.listening_done &&
      !session.listening_completed_at
    ) {
      reasons.push("listening_done=true with asset but listening_completed_at is missing");
    }
    if (reasons.length === 0) {
      return [];
    }
    return [`${session.session_date} (${session.id}): ${reasons.join("; ")}`];
  });
  if (impossibleSessionStates.length > 0) {
    issues.push({
      id: "impossible-session-states",
      severity: "error",
      message: "Daily sessions include impossible or incomplete state combinations.",
      details: impossibleSessionStates,
    });
  }

  const impossibleReviewTiming = bundle.reviewEvents.flatMap((row) => {
    const reasons: string[] = [];
    if (row.ms_spent < 0) {
      reasons.push("negative ms_spent");
    }
    if (row.ms_spent > MAX_REVIEW_MS_SPENT) {
      reasons.push("ms_spent exceeds 30 minutes");
    }
    if (row.shown_at && row.submitted_at && row.shown_at > row.submitted_at) {
      reasons.push("shown_at is after submitted_at");
    }
    if (row.retry_scheduled_for && row.submitted_at && row.retry_scheduled_for < row.submitted_at) {
      reasons.push("retry_scheduled_for is before submitted_at");
    }
    if (reasons.length === 0) {
      return [];
    }
    return [`${row.id}: ${reasons.join("; ")}`];
  });
  if (impossibleReviewTiming.length > 0) {
    issues.push({
      id: "impossible-review-timing",
      severity: "warning",
      message: "Review timing values fall outside the expected range.",
      details: impossibleReviewTiming,
    });
  }

  const sessionDateDrift = bundle.sessions.flatMap((session) => {
    const anchor = session.started_at ?? session.created_at ?? null;
    if (!anchor) {
      return [];
    }
    const derivedSessionDate = getAppSessionDate(new Date(anchor));
    if (derivedSessionDate === session.session_date) {
      return [];
    }
    return [`${session.id}: stored ${session.session_date}, derived ${derivedSessionDate}`];
  });
  if (sessionDateDrift.length > 0) {
    issues.push({
      id: "session-date-drift",
      severity: "warning",
      message: "Some session dates do not match the configured app session time zone.",
      details: sessionDateDrift,
    });
  }

  const brokenAnonymousIds = bundle.exportRuns
    .filter((row) => row.anonymized_user_id !== expectedAnonymousId)
    .map((row) => `${row.id}: ${row.anonymized_user_id}`);
  if (brokenAnonymousIds.length > 0) {
    issues.push({
      id: "broken-anonymous-ids",
      severity: "error",
      message: "Export runs contain an anonymized user ID that does not match the current export salt.",
      details: brokenAnonymousIds,
    });
  }

  const duplicateExports = new Map<string, number>();
  for (const row of bundle.exportRuns) {
    const minuteBucket = row.created_at.slice(0, 16);
    const key = `${row.format}:${row.dataset}:${row.date_from ?? ""}:${row.date_to ?? ""}:${minuteBucket}`;
    duplicateExports.set(key, (duplicateExports.get(key) ?? 0) + 1);
  }
  const duplicateExportDetails = Array.from(duplicateExports.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => `${key} (${count})`);
  if (duplicateExportDetails.length > 0) {
    issues.push({
      id: "duplicate-exports",
      severity: "warning",
      message: "Multiple identical exports were triggered within the same minute.",
      details: duplicateExportDetails,
    });
  }

  return issues;
}
