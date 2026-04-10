# Threats to Validity

This document maps specific threats to validity onto the measures and evidence collected by the application. Each threat identifies which metrics are affected, how the current system mitigates the threat (if at all), and how the threat should be described honestly in the dissertation. This is intended as a support document for writing a Threats to Validity subsection in the evaluation chapter.

---

## 1. Single-participant / self-study design

**Threat:** If the evaluation is based on a single user (the developer), the results cannot be generalised to other learners. Motivation, prior knowledge, and familiarity with the application's internals differ fundamentally from those of a naive user.

**Metrics affected:** All metrics. Session completion rates, accuracy, and usage patterns may reflect the developer's specific behaviour rather than the behaviour of a typical language learner.

**Current mitigation:** The application anonymises user identifiers in exports and the analysis pipeline is structured to accept multi-user data if a cohort study is conducted later. However, no cohort export endpoint currently exists.

**How to describe it:** State explicitly that the evaluation was conducted as a self-study (if applicable) and that the results describe the usage patterns of a single participant who was also the developer. Acknowledge that this limits generalisability and that the evaluation demonstrates technical feasibility and data quality rather than user-study-grade evidence of effectiveness.

---

## 2. Novelty and motivation effects

**Threat:** Early usage patterns may reflect initial enthusiasm rather than sustained behaviour. Completion rates and activity levels during the first days of use may be artificially high.

**Metrics affected:** Session completion rate, days with recorded activity, logged active time, flashcard attempt counts.

**Current mitigation:** The analysis produces time-series plots and a rolling-window activity chart, making it possible to visually inspect whether usage declined over time. However, the system does not model or adjust for novelty effects.

**How to describe it:** Note that the evaluation period may include novelty effects, particularly in the early days. If a decline in activity or completion rates is visible in the time-series figures, describe it factually without attributing it solely to novelty (other explanations, such as schedule changes, are equally plausible).

---

## 3. Incomplete coverage of learning outcomes

**Threat:** The application measures in-app behavioural indicators (flashcard correctness, stage completion, saved words) but does not measure vocabulary acquisition, reading comprehension, listening comprehension, or transfer to real-world language use. An examiner may question whether the evaluation demonstrates anything about learning.

**Metrics affected:** All metrics, but especially flashcard attempt accuracy, review-card correctness, and stage completions.

**Current mitigation:** The metric wording has been hardened throughout the codebase and documentation to avoid learning-outcome claims. Review-card correctness is explicitly labelled as a behavioural proxy. Stage completions are described as progression flags, not comprehension measures. The evaluation documentation includes a "What these metrics do NOT claim" section.

**How to describe it:** Be explicit that the evaluation measures usage behaviour and in-app performance, not learning outcomes. Frame the review-card correctness metric as a behavioural proxy that is consistent with retention but does not confirm it. If possible, cite SRS literature supporting the plausibility of the proxy relationship, while acknowledging it has not been validated for this specific implementation.

---

## 4. Review-card correctness as a retention proxy

**Threat:** The review-card correctness metric may not accurately reflect retention. Correctness could be inflated by the SRS scheduling easier items more frequently, by the user becoming familiar with the question format rather than learning the vocabulary, or by a ceiling effect as the easiest words accumulate.

**Metrics affected:** Review-card correctness (retention proxy).

**Current mitigation:** The metric is explicitly labelled as a proxy throughout the codebase, documentation, and all generated outputs. The mean inter-review interval is reported alongside the correctness rate to provide context on the SRS scheduling.

**How to describe it:** Acknowledge that the proxy has known limitations: it assumes that in-app correctness on spaced-review cards correlates with retention, but this has not been validated externally. Note that the SRS scheduling algorithm may contribute to the observed correctness rate (e.g., well-retained items are reviewed less frequently, meaning the items being reviewed at any given time may skew toward those the user finds more difficult, or conversely toward those that are well-established).

---

## 5. Logged active time limitations

**Threat:** Logged active time under-counts actual engagement time because it excludes idle time, navigation between sections, time on abandoned flashcard views, and time when the app is backgrounded. It also cannot distinguish between focused attention and passive screen presence.

**Metrics affected:** Logged active time per day, total logged active time.

**Current mitigation:** The metric is labelled "logged active time" throughout (not "study time" or "time on task"). The limitations are documented in the metric definitions. The summary report includes a note that this is a lower bound.

**How to describe it:** State that logged active time is a lower bound on engagement time derived from client-recorded activity intervals. Note the specific exclusions (idle time, navigation, abandoned views, backgrounded app). Do not present it as total study time or time on task.

---

## 6. Stage completion does not imply comprehension

**Threat:** Reading and listening stage completions are binary flags set when the user progresses through a stage. They do not measure comprehension, the amount of content consumed, or the quality of attention during the stage.

**Metrics affected:** Reading stage completions, listening stage completions, session completion rate (which depends on stage completions).

**Current mitigation:** The metric definitions explicitly state that these are binary flags and do not measure comprehension. The figure captions include this caveat.

**How to describe it:** When reporting reading and listening completion rates, state that these indicate stage progression within the daily loop, not comprehension. If reading or listening time data is reported, note that it represents client-recorded active seconds, not a measure of comprehension or engagement quality.

---

## 7. Saved-word behaviour does not imply retention

**Threat:** Saving a word from the reader indicates a user decision to add the word to their review deck. It does not indicate that the user understood, learned, or can recall the word.

**Metrics affected:** Reader-saved words per day, total reader-saved words.

**Current mitigation:** The metric is described as "reader-saved words" (a save event), not "learned words" or "acquired vocabulary."

**How to describe it:** Describe saved words as vocabulary capture behaviour: the user identified a word they wanted to review later and saved it. Do not equate the count of saved words with vocabulary acquisition.

---

## 8. Abandoned flashcard views are not captured

**Threat:** If the user sees a flashcard but does not submit a response (e.g., they close the app or navigate away), this view is not recorded in `review_events`. This means the total number of card exposures may be under-counted, and accuracy may be biased if abandonments are non-random (e.g., if the user is more likely to abandon cards they find difficult).

**Metrics affected:** Flashcard attempt accuracy, total flashcard attempts, logged active time (which depends on submitted attempt times).

**Current mitigation:** This is a deliberate design choice documented in the known limitations. The `shown_at` timestamp is recorded for submitted attempts, but abandoned views are not persisted.

**How to describe it:** Note that flashcard metrics are based on submitted attempts only. Acknowledge that abandoned views are not captured and that this could introduce bias if abandonments are systematically related to card difficulty.

---

## 9. Current-user export limitation

**Threat:** The export endpoint currently supports only the authenticated user's own data. There is no admin or cohort export endpoint. If a multi-participant study were intended, the export infrastructure would need extension.

**Metrics affected:** All metrics in a multi-participant context.

**Current mitigation:** The export and analysis pipeline are structured so that multi-user data can be accommodated by concatenating single-user exports or by implementing a cohort export endpoint. Each exported row already includes an `anonymous_user_id` field.

**How to describe it:** If the evaluation is a single-user self-study, this limitation is not directly relevant but should be noted as a constraint on future work. If a multi-participant study is planned, note that the current export infrastructure supports only per-user export and that a cohort endpoint would need to be implemented.

---

## 10. Observational design — no causal claims

**Threat:** The evaluation is observational. There is no control group, no random assignment, and no pre/post testing. No causal claims can be made about whether the application caused any observed behaviour patterns.

**Metrics affected:** All metrics.

**Current mitigation:** None — this is a fundamental design constraint, not a technical limitation.

**How to describe it:** State that the evaluation is observational and descriptive. The results describe usage patterns and behavioural indicators recorded during the evaluation period. They do not support causal claims about the application's effect on learning, retention, or language proficiency. If comparisons to expectations or targets are made, frame them as descriptive observations, not as evidence of causal effects.

---

## 11. Pre-instrumentation data gaps

**Threat:** Review events and daily sessions created before the instrumentation migration (migration `20260410140000`) may lack full queue/source metadata (e.g., `queue_kind`, `queue_source`, `daily_session_id`). If the evaluation period overlaps with pre-instrumentation data, some metrics may be computed from incomplete records.

**Metrics affected:** New-card / review-card attempt breakdowns, retry-queue attempt counts, review-card correctness proxy, session linkage consistency.

**Current mitigation:** The data quality checks in the analysis pipeline detect review events with missing `queue_kind` metadata and report them as warnings. The consistency checks also detect review events without linked daily sessions.

**How to describe it:** If the analysis output reports data quality warnings about missing queue metadata or session links, note these in the results and indicate which proportion of events are affected. If the evaluation period starts after the instrumentation migration, this threat does not apply and can be omitted.

---

## Summary

| Threat | Severity | Metrics affected | Mitigated? |
|---|---|---|---|
| Single-participant self-study | High | All | Partially (analysis pipeline supports multi-user) |
| Novelty effects | Medium | Completion, activity, time | Partially (time-series plots available) |
| No learning-outcome measures | High | All | Yes (wording hardened, proxies labelled) |
| Correctness proxy limitations | Medium | Review correctness | Yes (labelled as proxy throughout) |
| Logged active time under-counting | Low | Time metrics | Yes (labelled as lower bound) |
| Stage completion ≠ comprehension | Medium | Stage completions | Yes (documented as binary flags) |
| Saved words ≠ retention | Low | Saved words | Yes (described as save events) |
| Abandoned views not captured | Low | Accuracy, attempts, time | Partially (documented limitation) |
| Current-user export only | Low | All (multi-user) | Partially (extension path documented) |
| No causal design | High | All | No (fundamental constraint) |
| Pre-instrumentation data gaps | Low | Attempt breakdowns | Yes (detected by quality checks) |
