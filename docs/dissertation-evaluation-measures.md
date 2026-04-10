# Evaluation Measures

This section describes the measures used to evaluate the language-learning application. Each measure is defined operationally, with explicit source tables, formulas, and limitations. The canonical machine-readable definitions are maintained in `lib/analytics/metricDefinitions.ts`; the precise wording rationale for each metric is documented in `docs/evaluation-metric-wording.md`. This document provides dissertation-chapter-ready prose that can be adapted directly into a Measures subsection.

---

## Overview

The application instruments user behaviour across four modalities within a guided daily learning loop: flashcard review (spaced repetition), interactive reading, audio listening, and vocabulary saving. All measures are derived from three canonical database tables (`daily_sessions`, `review_events`, `user_deck_words`) and are exported through a single analytics pipeline so that the progress page, export route, and analysis scripts all operate on identical derived values.

Measures fall into two categories:

- **Direct observations:** Counts and timestamps recorded by the application as the user interacts with it (e.g., number of submitted flashcard attempts, whether a stage was marked complete).
- **Derived proxies:** Values computed from direct observations that serve as behavioural indicators for constructs that cannot be measured directly within the application (e.g., review-card correctness as a proxy for retention).

No measure in this evaluation makes a direct claim about vocabulary acquisition, reading comprehension, listening comprehension, or long-term retention. Where a measure is used as a proxy for such a construct, this is stated explicitly.

---

## Session completion measures

### Daily session completion rate

The daily session completion rate is defined as the proportion of started sessions that reached the completed state. The numerator is the count of `daily_sessions` rows where `completed = true`. The denominator is the count of rows where `started_at IS NOT NULL`, meaning the user opened and interacted with the session at least once (e.g., by loading flashcards). Sessions that were created automatically by the system but never opened by the user are excluded from the denominator to avoid inflating the rate with unused session slots.

**Source table:** `daily_sessions`

**What this does not measure:** This metric does not distinguish between sessions completed quickly and sessions completed over multiple revisits within the same calendar day. It does not measure quality of engagement during the session.

### Sessions with recorded start / sessions completed

These are the raw counts behind the completion rate. "Sessions with recorded start" counts rows in `daily_sessions` where `started_at IS NOT NULL`. "Sessions completed" counts rows where `completed = true`. Both are scoped to the selected date range.

---

## Flashcard performance measures

### Flashcard attempt accuracy (all queues)

Flashcard attempt accuracy is defined as the proportion of correct submitted flashcard attempts out of all submitted attempts, including both main-queue and retry-queue attempts. The numerator is the count of `review_events` where `correct = true`. The denominator is the total count of `review_events`.

**Source table:** `review_events`

**What this does not measure:** This metric measures in-app response correctness. It does not measure whether the user has learned, retained, or can recall the word outside the application. Because retry attempts (re-presentations of incorrectly answered cards within the same session) are included in the denominator, accuracy may be lower than a main-queue-only calculation.

### New-card main-queue attempts per day

This measure counts the number of submitted flashcard attempts from the main queue where the queue kind was `new`, grouped by session date. Each row in `review_events` represents one submitted attempt, not a unique word. A word may appear as a new card on more than one day if the spaced repetition scheduler reschedules it.

**Source table:** `review_events` (filtered to `queue_source='main'` and `queue_kind='new'`)

**What this does not measure:** This is not a count of unique new words encountered or words learned. It is a count of attempt events.

### Review-card main-queue attempts per day

This measure counts the number of submitted flashcard attempts from the main queue where the queue kind was `review`, grouped by session date. As with new-card attempts, this counts attempt events, not unique words.

**Source table:** `review_events` (filtered to `queue_source='main'` and `queue_kind='review'`)

### Total flashcard attempts per day

All submitted flashcard attempts on a given session date, including both main-queue and retry-queue attempts. This provides the overall volume of flashcard interaction.

**Source table:** `review_events`

### Retry-queue attempts per day

Submitted flashcard attempts where the queue source was `retry`, grouped by session date. Retry attempts are re-presentations of incorrectly answered cards within the same session. Only submitted retries are counted; retries that were scheduled but never answered are not included.

**Source table:** `review_events` (filtered to `queue_source='retry'`)

---

## Stage completion measures

### Reading stage completions per day

This measure counts the number of daily sessions where the reading stage was marked complete (`reading_done = true`), per session date. Each session contributes at most one reading completion. The reading stage is marked complete when the user explicitly saves the reading step within the daily loop.

**Source table:** `daily_sessions`

**What this does not measure:** This is a binary completion flag per session. It does not measure reading depth, reading speed, comprehension, or the proportion of text that the user actually read. It indicates that the user progressed through the reading stage of the daily loop.

### Listening stage completions per day

This measure counts the number of daily sessions where the listening stage was marked complete (`listening_done = true`), per session date. Each session contributes at most one listening completion.

**Source table:** `daily_sessions`

**What this does not measure:** This is a binary completion flag. It does not measure listening comprehension, the proportion of audio content consumed, or whether the user attended to the audio.

### Sessions reaching each stage milestone

This measure counts the number of sessions that reached each of the following milestones: started (the user opened the session), flashcards completed (the assigned flashcard workload was finished), reading completed (`reading_done = true`), listening completed (`listening_done = true` with a listening asset assigned), and fully completed (`completed = true`). The listening milestone is only counted for sessions where a listening asset was assigned.

**Source table:** `daily_sessions`

### Stage drop-off

Stage drop-off measures the number of sessions that reached one stage milestone but did not reach the next. It is calculated as the difference between adjacent milestone counts. For the listening drop-off calculation, the denominator is sessions that completed reading and had a listening asset assigned, not all reading-completed sessions.

**Source table:** `daily_sessions`

---

## Saved-word measures

### Reader-saved words per day

This measure counts the number of words saved from the interactive reader into the user's manual deck on a given session date. The source is `user_deck_words` rows where `added_via = 'reader'`. The saved-word table is append-only: if the user attempts to save the same word twice, the duplicate is silently ignored, so this measure counts unique first-save events per word per deck.

**Source table:** `user_deck_words`

**What this does not measure:** Saving a word indicates that the user chose to add it to their review deck. It does not indicate that the user has learned, retained, or can use the word.

---

## Logged active time

### Logged active time per day

Logged active time is defined as the sum of three client-recorded time components for a given session date:

1. **Flashcard time:** The sum of `ms_spent` values across all submitted flashcard attempts for that date, converted to seconds. The `ms_spent` field records the interval between displaying a card and submitting a response.
2. **Reading time:** The `reading_time_seconds` value from `daily_sessions`, recorded by a client-side timer during the reading stage.
3. **Listening time:** The `listening_time_seconds` value from `daily_sessions`, recorded by the client-side listening player.

**Source tables:** `review_events`, `daily_sessions`

**What this does not measure:** Logged active time is a lower bound on the time the user spent interacting with the application. It does not include idle time, time spent navigating between sections, time on abandoned (unsubmitted) flashcard views, or time when the app was backgrounded. It should be referred to as "logged active time" rather than "time on task" or "study time" to avoid implying comprehensive coverage of all time spent with the application.

---

## Review correctness proxy

### Review-card correctness (retention proxy)

Review-card correctness is defined as the proportion of correct attempts among review-card attempts (`queue_kind = 'review'`). This metric is used as a behavioural proxy for retention under the assumption that higher correctness on spaced-review cards correlates with better retention of the reviewed vocabulary. This assumption is plausible given the spaced repetition literature but has not been independently validated for this specific implementation.

**Numerator:** `count(review_events WHERE queue_kind='review' AND correct=true)`
**Denominator:** `count(review_events WHERE queue_kind='review')`

**Source table:** `review_events`

**What this does not measure:** This metric does not measure recall outside the application, transfer to naturalistic language-use contexts, or long-term retention beyond the intervals managed by the spaced repetition scheduler. It is explicitly labelled as a proxy throughout the codebase and documentation.

---

## Activity and consistency measures

### Days with recorded activity

This measure counts the number of distinct session dates where at least one of the following occurred: a flashcard attempt was submitted, a word was saved from the reader, the reading stage was completed, or the listening stage was completed. It provides a coarse indicator of usage consistency across the evaluation period.

**Source tables:** `daily_sessions`, `review_events`, `user_deck_words`

**What this does not measure:** A day is counted as active if any qualifying event was recorded, regardless of the volume or duration of activity on that day. A day with a single flashcard attempt and a day with a full session completion both count equally.

### Workload units completed vs. assigned

This measure expresses the ratio of completed workload units to assigned units for each session. Flashcards contribute one unit per card. Reading and listening each contribute one binary unit per session (listening only when a listening asset was assigned). Because the granularity differs across modalities (per-card for flashcards, per-session for reading and listening), this metric is useful for assessing workload adherence but should not be used to compare effort or time across modalities.

**Source table:** `daily_sessions`

---

## Summary of measure types

| Measure | Type | Direct or proxy |
|---|---|---|
| Session completion rate | Proportion | Direct observation |
| Flashcard attempt accuracy | Proportion | Direct observation |
| New-card / review-card attempts | Count | Direct observation |
| Retry-queue attempts | Count | Direct observation |
| Reading stage completions | Binary flag | Direct observation |
| Listening stage completions | Binary flag | Direct observation |
| Reader-saved words | Count | Direct observation |
| Logged active time | Sum (seconds) | Direct observation (lower bound) |
| Days with recorded activity | Count | Direct observation |
| Review-card correctness | Proportion | Behavioural proxy for retention |
| Stage drop-off | Derived count | Direct observation |
| Workload completion ratio | Proportion | Direct observation (mixed granularity) |
