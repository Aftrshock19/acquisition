# Results Scaffold

This document provides a results section scaffold with placeholders for the evaluation chapter. Replace all `[PLACEHOLDER]` values with actual numbers from the analysis outputs (`analysis/output/summary.md`, `analysis/output/summary_metrics.csv`, and the generated figures). Do not fabricate values.

Guidance notes in *[italics and brackets]* should be removed in the final version.

---

## X.1 Overview of the evaluation period

The evaluation covers the period from [START_DATE] to [END_DATE], a span of [N_DAYS] calendar days. During this period, [N_SESSIONS_STARTED] daily sessions were opened by the user (i.e., had a recorded `started_at` timestamp), of which [N_SESSIONS_COMPLETED] were completed through all assigned stages. [N_DAYS_ACTIVE] days had at least one recorded study activity (a submitted flashcard attempt, a saved word, or a completed reading or listening stage).

*[If this is a self-study evaluation with a single participant, state that explicitly here. If multiple participants were involved, adjust the wording and present per-participant summaries or aggregates as appropriate.]*

Table [TABLE_N] provides a summary of the key metrics for the evaluation period. Figure [FIGURE_N] shows the daily pattern of sessions started and completed across the period.

---

## X.2 Session completion and consistency

Of the [N_SESSIONS_STARTED] sessions with a recorded start, [N_SESSIONS_COMPLETED] reached the completed state, yielding a session completion rate of [COMPLETION_RATE]. *[Note: the denominator excludes auto-created sessions that were never opened. See the Measures section for the precise definition.]*

Figure [FIGURE_N] shows the cumulative session completion rate over time. *[Describe the trend: was the rate stable, improving, or declining over the period? Avoid causal claims about why any trend occurred.]*

The stage progression data (Figure [FIGURE_N], Table [TABLE_N]) shows that [N_FLASHCARDS_COMPLETED] sessions completed the flashcard stage, [N_READING_COMPLETED] completed the reading stage, [N_LISTENING_COMPLETED] completed the listening stage, and [N_FULLY_COMPLETED] completed all stages. The drop-off between stages was [DROP_FLASHCARDS] sessions before flashcard completion, [DROP_READING] before reading completion, and [DROP_LISTENING] before listening completion.

*[If drop-off is concentrated at a particular stage, note that descriptively. Do not claim that one stage was "harder" or "less engaging" without supporting evidence beyond the completion flag.]*

The user was active on [N_DAYS_ACTIVE] out of [N_DAYS] calendar days in the evaluation period. *[If a rolling-window figure is used, reference it here to describe consistency patterns.]*

---

## X.3 Flashcard performance

A total of [TOTAL_ATTEMPTS] flashcard attempts were submitted during the evaluation period, of which [TOTAL_RETRIES] were retry-queue attempts (re-presentations of incorrectly answered cards within the same session).

The overall flashcard attempt accuracy across all queues was [ACCURACY]. *[Note: this includes retry attempts in both the numerator and denominator. If main-queue-only accuracy is available and materially different, report it separately.]*

Figure [FIGURE_N] shows flashcard attempt accuracy over time. *[Describe the trajectory descriptively. Avoid claiming that accuracy "improved" in a way that implies learning occurred — the metric measures in-app response correctness, not retention or acquisition.]*

New-card main-queue attempts averaged [AVG_NEW_PER_DAY] per active day (Figure [FIGURE_N]). Review-card main-queue attempts averaged [AVG_REVIEW_PER_DAY] per active day (Figure [FIGURE_N]). *[These are attempt counts, not unique words. State this if the distinction matters for the argument.]*

Figure [FIGURE_N] shows total flashcard attempts per day, with retry-queue attempts overlaid. *[If the retry rate is notably high or low, note that descriptively.]*

---

## X.4 Reading and listening stage usage

Reading stage completions were recorded on [N_READING_DAYS] out of [N_DAYS_ACTIVE] active days (Figure [FIGURE_N]). *[Note: reading stage completion is a binary flag indicating that the user progressed through the reading stage. It does not measure comprehension, reading depth, or the amount of text read.]*

Listening stage completions were recorded on [N_LISTENING_DAYS] out of [N_DAYS_ACTIVE] active days (Figure [FIGURE_N]). *[Same caveat as reading: the flag indicates stage progression, not comprehension or the proportion of audio consumed.]*

*[If reading and listening time data is available and informative, include a sentence like:]*
The mean logged reading time on days with a reading completion was [AVG_READING_MINUTES] minutes. The mean logged listening time on days with a listening completion was [AVG_LISTENING_MINUTES] minutes. *[These are client-recorded active seconds and represent a lower bound on actual time spent.]*

---

## X.5 Saved words and vocabulary capture

A total of [TOTAL_SAVED_WORDS] words were saved from the interactive reader during the evaluation period, at a mean of [AVG_SAVED_PER_DAY] per active day (Figure [FIGURE_N]).

*[Saving a word indicates that the user chose to add it to their review deck. It does not indicate that the user has learned, retained, or can use the word. Avoid phrases like "the user learned N words" or "N words were acquired." Instead, describe this as "vocabulary capture behaviour."]*

---

## X.6 Logged active time

The total logged active time across the evaluation period was [TOTAL_TIME_MINUTES] minutes ([TOTAL_TIME_HOURS] hours), broken down as:

- Flashcard time: [FLASHCARD_MINUTES] minutes
- Reading time: [READING_MINUTES] minutes
- Listening time: [LISTENING_MINUTES] minutes

The mean logged active time per active day was [AVG_TIME_PER_DAY] minutes.

Figure [FIGURE_N] shows the daily logged active time stacked by modality.

*[Logged active time is a lower bound on engagement time. It excludes idle time, navigation between sections, and time on unsubmitted flashcard views. Refer to it as "logged active time" throughout, not "study time" or "time on task."]*

---

## X.7 Review-card correctness (retention proxy)

The review-card correctness rate across all review-card attempts was [REVIEW_CORRECTNESS]. The mean inter-review interval for review-card attempts was [MEAN_DELTA_HOURS] hours.

Figure [FIGURE_N] shows the trend in review-card correctness over time.

*[This metric is a behavioural proxy derived from in-app correctness on spaced-review cards. It is used as an indicator of retention under the assumption that higher review correctness correlates with better retention — an assumption that is plausible given the spaced repetition literature but has not been independently validated for this implementation. It does not measure recall outside the app, transfer to naturalistic contexts, or long-term retention beyond the SRS schedule.]*

*[When interpreting this trend, be cautious. An upward trend could reflect genuine retention improvement, but it could also reflect the user becoming more familiar with the app's question format, the SRS scheduling easier items more frequently, or a floor effect from the easiest words accumulating.]*

---

## X.8 Summary

*[This subsection should synthesise the descriptive findings above without overclaiming. Suggested structure:]*

The evaluation data covers [N_DAYS] days, during which [N_SESSIONS_STARTED] sessions were started and [N_SESSIONS_COMPLETED] were completed. The user was active on [N_DAYS_ACTIVE] days and submitted [TOTAL_ATTEMPTS] flashcard attempts with an overall accuracy of [ACCURACY]. Reading and listening stages were completed on [N_READING_DAYS] and [N_LISTENING_DAYS] days respectively. A total of [TOTAL_SAVED_WORDS] words were saved from the reader. The total logged active time was [TOTAL_TIME_MINUTES] minutes.

*[Then add one or two sentences of cautious interpretation, such as:]*

These results indicate that the application was used consistently over the evaluation period and that the daily learning loop was completed on the majority of started sessions. The review-card correctness proxy ([REVIEW_CORRECTNESS]) provides a behavioural indicator consistent with retention of reviewed vocabulary, although this cannot be confirmed without external assessment. The limitations of each measure, including the proxy nature of the review-correctness metric and the lower-bound nature of logged active time, are discussed in Section [THREATS_SECTION].

*[Do not claim fluency, mastery, acquisition, or comprehension unless supported by evidence beyond these metrics. The evaluation demonstrates usage patterns and behavioural indicators, not learning outcomes.]*

---

## Checklist before submitting

- [ ] All `[PLACEHOLDER]` values replaced with real numbers from `analysis/output/summary.md`
- [ ] All figure and table references point to actual figures/tables
- [ ] No metric is described with inflated wording (check against `docs/evaluation-metric-wording.md`)
- [ ] Review-card correctness is labelled as a proxy wherever it appears
- [ ] Logged active time is not called "study time" or "time on task"
- [ ] Stage completions are not described as comprehension evidence
- [ ] Saved words are not described as "learned words"
- [ ] Causal claims are absent or explicitly hedged
- [ ] The threats-to-validity section is referenced where appropriate
