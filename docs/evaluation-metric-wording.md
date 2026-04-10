# Evaluation Metric Wording Guide

This document provides precise definitions for every metric used in the dissertation evaluation.
Each definition specifies what is measured, the numerator and denominator (where applicable),
source tables, and known limitations. Use these definitions verbatim in the evaluation chapter
and appendices to ensure wording survives examiner scrutiny.

The canonical machine-readable source of truth is
[`lib/analytics/metricDefinitions.ts`](../lib/analytics/metricDefinitions.ts).

---

## Terminology conventions

| Term | Meaning in this project |
|---|---|
| **Attempt** | A single submitted flashcard response recorded in `review_events`. One attempt = one row. |
| **Main queue** | The primary flashcard queue presented during a session (`queue_source='main'`). |
| **Retry queue** | Incorrectly answered cards re-presented within the same session (`queue_source='retry'`). |
| **New card** | A flashcard attempt for a word being introduced for the first time (`queue_kind='new'`). |
| **Review card** | A flashcard attempt for a previously introduced word returning for spaced review (`queue_kind='review'`). |
| **Session date** | The calendar date in the configured app time zone (default `Europe/London`) to which a daily session belongs. |
| **Started session** | A daily session where `started_at IS NOT NULL`, indicating the user opened and interacted with the session. Auto-created sessions that were never opened are excluded. |
| **Completed session** | A daily session where `completed=true`, meaning all assigned stages were finished. |
| **Stage** | One phase of the daily learning loop: flashcards, reading, listening, complete. |
| **Logged active time** | The sum of client-recorded time components. Does not include idle time, navigation time, or abandoned views. |

---

## Core metrics

### 1. Daily session completion rate

- **Definition:** Proportion of started sessions that reached the completed state.
- **Numerator:** `count(daily_sessions WHERE completed = true)`
- **Denominator:** `count(daily_sessions WHERE started_at IS NOT NULL)`
- **Source:** `daily_sessions`
- **Limitations:** Auto-created sessions with no user interaction are excluded from the denominator. This means the rate reflects engagement among users who actively opened a session, not among all potential session slots.
- **Wording rationale:** Using "started" rather than "created" prevents inflating the denominator with sessions that were never seen by the user.

### 2. Flashcard attempt accuracy (all queues)

- **Definition:** Proportion of correct flashcard attempts across all submitted attempts, including both main-queue and retry-queue attempts.
- **Numerator:** `count(review_events WHERE correct = true)`
- **Denominator:** `count(review_events)`
- **Source:** `review_events`
- **Limitations:** Retry attempts are included. For main-queue-only accuracy, filter to `queue_source='main'`. This measures response correctness within the app, not learning or retention.

### 3. New-card main-queue attempts per day

- **Definition:** Count of submitted flashcard attempts from the main queue where `queue_kind='new'`, grouped by session date.
- **Formula:** `count(review_events WHERE queue_source='main' AND queue_kind='new')` per `session_date`
- **Source:** `review_events`
- **Limitations:** Counts submitted attempts, not unique words encountered or words retained. A word may generate multiple new-card attempts across different days if the SRS reschedules it.
- **Wording rationale:** The previous label "new words completed per day" was changed because (a) an attempt is not a completion, and (b) "words" implies unique vocabulary items when the metric counts attempt events.

### 4. Review-card main-queue attempts per day

- **Definition:** Count of submitted flashcard attempts from the main queue where `queue_kind='review'`, grouped by session date.
- **Formula:** `count(review_events WHERE queue_source='main' AND queue_kind='review')` per `session_date`
- **Source:** `review_events`
- **Limitations:** Counts submitted review attempts, not unique words reviewed. Retry-queue attempts are excluded.
- **Wording rationale:** Changed from "review cards completed per day" for the same reasons as metric 3.

### 5. Total flashcard attempts per day

- **Definition:** All submitted flashcard attempts on a given session date, including both main-queue and retry-queue attempts.
- **Formula:** `count(review_events)` per `session_date`
- **Source:** `review_events`

### 6. Retry-queue attempts per day

- **Definition:** Submitted flashcard attempts where `queue_source='retry'`, grouped by session date.
- **Source:** `review_events`
- **Limitations:** Counts submitted retry attempts only. Retries that were scheduled (`retry_scheduled_for` set) but never answered are not included.

### 7. Logged active time per day

- **Definition:** Sum of client-recorded active time across flashcard attempts, reading, and listening for a session date.
- **Formula:** `sum(review_events.ms_spent) / 1000 + daily_sessions.reading_time_seconds + daily_sessions.listening_time_seconds`
- **Source:** `review_events`, `daily_sessions`
- **Limitations:** Does not include idle time, time navigating between sections, or time on abandoned (unsubmitted) flashcard views. Reading and listening seconds are recorded by client-side timers and may under-count if the app is backgrounded.
- **Wording rationale:** Changed from "time on task" because that phrase implies comprehensive task-time measurement. "Logged active time" clarifies that only client-recorded active intervals are summed.

### 8. Reading stage completions per day

- **Definition:** Count of daily sessions where `reading_done=true`, per session date. Each session contributes at most one reading completion.
- **Source:** `daily_sessions`
- **Limitations:** Binary flag per session. Does not measure reading depth, comprehension, or the amount of text read.

### 9. Listening stage completions per day

- **Definition:** Count of daily sessions where `listening_done=true`, per session date. Each session contributes at most one listening completion.
- **Source:** `daily_sessions`
- **Limitations:** Binary flag per session. Does not measure listening comprehension or the proportion of audio content consumed.

### 10. Client-recorded listening time per day

- **Definition:** Active listening seconds recorded by the client-side listening player, stored in `daily_sessions.listening_time_seconds`.
- **Source:** `daily_sessions`
- **Limitations:** May under-count if the app is backgrounded. Represents playback time, not comprehension time.

### 11. Reader-saved words per day

- **Definition:** Count of words saved from the interactive reader into the user's manual deck on a given session date.
- **Formula:** `count(user_deck_words WHERE added_via='reader')` per `session_date`
- **Source:** `user_deck_words`
- **Limitations:** Append-only: duplicate saves of the same word are ignored after the first event.

### 12. Days with recorded activity

- **Definition:** Count of distinct session dates where at least one of the following occurred: a flashcard attempt was submitted, a word was saved from the reader, the reading stage was completed, or the listening stage was completed.
- **Source:** `daily_sessions`, `review_events`, `user_deck_words`
- **Previous label:** "Days active" — retained as shorthand but the full definition above should be used in formal writing.

### 13. Review-card correctness (retention proxy)

- **Definition:** Proportion of correct attempts among review-card attempts (`queue_kind='review'`), used as a behavioural proxy for retention.
- **Numerator:** `count(review_events WHERE queue_kind='review' AND correct = true)`
- **Denominator:** `count(review_events WHERE queue_kind='review')`
- **Source:** `review_events`
- **Limitations:** This is a behavioural proxy derived from in-app review correctness. It does not measure recall outside the app, transfer to naturalistic contexts, or long-term retention beyond the SRS schedule. The proxy assumes that higher review correctness correlates with better retention, which is plausible but unvalidated for this specific implementation.
- **Wording rationale:** Changed from "review retention proxy accuracy" to "review-card correctness (retention proxy)" to foreground what is actually measured (correctness) and relegate the interpretive claim (retention) to a parenthetical qualifier.

### 14. Sessions reaching each stage milestone

- **Definition:** Count of sessions that reached each milestone: started, flashcards completed, reading completed, listening completed, fully completed.
- **Source:** `daily_sessions`
- **Limitations:** Listening milestone is only counted for sessions where a listening asset was assigned.

### 15. Stage drop-off

- **Definition:** Number of sessions that reached a given stage milestone but did not reach the next one.
- **Source:** `daily_sessions`
- **Limitations:** Listening drop-off denominator uses sessions that completed reading AND had a listening asset assigned.

### 16. Workload units completed vs. assigned

- **Definition:** Ratio of completed workload units to assigned units for a session. Flashcards: one unit per card. Reading: one binary unit. Listening: one binary unit (only when a listening asset was assigned).
- **Source:** `daily_sessions`
- **Limitations:** Mixed granularity: flashcard units are per-card while reading/listening are binary per-session. Useful for workload adherence, not for comparing effort across modalities.

---

## Summary-level aggregates

| Metric | Definition |
|---|---|
| Total sessions with recorded start | `count(daily_sessions WHERE started_at IS NOT NULL)` in the selected range |
| Total sessions completed | `count(daily_sessions WHERE completed = true)` in the selected range |
| Total flashcard attempts | `count(review_events)` in the selected range |
| Total retry-queue attempts | `count(review_events WHERE queue_source='retry')` in the selected range |
| Total reader-saved words | `count(user_deck_words WHERE added_via='reader')` in the selected range |
| Total reading stage completions | `count(daily_sessions WHERE reading_done = true)` in the selected range |
| Total listening stage completions | `count(daily_sessions WHERE listening_done = true)` in the selected range |
| Total logged active time | Sum of `total_time_seconds` across all daily aggregates in the selected range |
| Mean inter-review interval | Mean of `delta_hours` across review-card attempts in the selected range |

---

## What these metrics do NOT claim

- **No learning-outcome claims:** Flashcard accuracy and review correctness measure in-app response behaviour. They do not directly measure vocabulary acquisition, comprehension, or transfer.
- **No retention claims:** The review-correctness proxy is labelled as such. It is a behavioural correlate, not a validated retention measure.
- **No time-on-task completeness:** Logged active time excludes idle time, navigation, and abandoned views. It is a lower bound on actual engagement time.
- **No comprehension claims:** Reading and listening completion flags indicate that the user progressed through the stage, not that they understood the content.
