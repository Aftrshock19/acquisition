"""
Research metric definitions, applied at read time.

These mirror lib/analytics/service.ts (isFlashcardStageCompleted,
isLoopCompleted, isRetentionProxyEvent, buildAnalyticsSummary) so that exports
made before those definitions changed (format_version dissertation-metrics-v1,
which used the raw ``completed`` flag and counted same-session retries in the
retention proxy) are analysed the same way as current ones.  Keep the two in
sync.

    flashcards_stage_completed := flashcards_completed_at IS NOT NULL
                                  OR flashcard_attempts_count >= assigned_flashcard_count
    loop_completed := completed_at IS NOT NULL
                      OR (reading_done AND listening_done AND flashcards_stage_completed)
    retention proxy events := review_events WHERE queue_kind = 'review'
                                              AND queue_source = 'main'

Only columns present on historical daily_sessions rows are used, so the
definitions work on pilot data without any backfill.
"""

from __future__ import annotations

from typing import Any

import pandas as pd


# ---------------------------------------------------------------------------
# Column helpers (tolerate missing columns and null values)
# ---------------------------------------------------------------------------

def _flag(df: pd.DataFrame, col: str) -> pd.Series:
    """Boolean column; missing column or null -> False."""
    if col not in df.columns:
        return pd.Series(False, index=df.index)
    return df[col].eq(True)


def _present(df: pd.DataFrame, col: str) -> pd.Series:
    """True where a timestamp-like column is set."""
    if col not in df.columns:
        return pd.Series(False, index=df.index)
    values = df[col]
    return values.notna() & values.astype(str).ne("")


def _count(df: pd.DataFrame, col: str) -> pd.Series:
    """Integer column; missing column or null -> 0 (matches `?? 0` in TS)."""
    if col not in df.columns:
        return pd.Series(0, index=df.index)
    return pd.to_numeric(df[col], errors="coerce").fillna(0)


def _prefer_exported(df: pd.DataFrame, col: str, computed: pd.Series) -> pd.Series:
    """Use an exported boolean column where it is set, else the computed value."""
    if col not in df.columns:
        return computed.astype(bool)
    exported = df[col]
    return exported.where(exported.notna(), computed).eq(True)


# ---------------------------------------------------------------------------
# Session-level definitions
# ---------------------------------------------------------------------------

def flashcards_stage_completed(sessions: pd.DataFrame) -> pd.Series:
    """Flashcard stage done; retries count towards the target."""
    return _present(sessions, "flashcards_completed_at") | (
        _count(sessions, "flashcard_attempts_count")
        >= _count(sessions, "assigned_flashcard_count")
    )


def loop_completed(sessions: pd.DataFrame) -> pd.Series:
    """Research "daily loop completed".  Uses the exported ``loop_completed``
    column where present (v2 exports), otherwise computes it from the raw
    daily_sessions columns.  Never uses the raw ``completed`` flag, which
    "Do more flashcards" resets and which stayed false on pilot rows where the
    server counted only first attempts."""
    computed = _present(sessions, "completed_at") | (
        _flag(sessions, "reading_done")
        & _flag(sessions, "listening_done")
        & flashcards_stage_completed(sessions)
    )
    return _prefer_exported(sessions, "loop_completed", computed)


# ---------------------------------------------------------------------------
# Review-event definitions
# ---------------------------------------------------------------------------

def retention_proxy_mask(review_events: pd.DataFrame) -> pd.Series:
    """Main-queue review-card attempts.  Same-session retries follow a miss
    minutes earlier, so their correctness and delta_hours are not spaced
    recall."""
    if review_events.empty or not {"queue_kind", "queue_source"} <= set(review_events.columns):
        return pd.Series(False, index=review_events.index)
    return review_events["queue_kind"].eq("review") & review_events["queue_source"].eq("main")


def retention_proxy(review_events: pd.DataFrame) -> dict[str, Any]:
    events = review_events[retention_proxy_mask(review_events)]
    attempts = int(len(events))
    correct = int(_flag(events, "correct").sum())
    deltas = (
        pd.to_numeric(events["delta_hours"], errors="coerce").dropna()
        if "delta_hours" in events.columns
        else pd.Series(dtype=float)
    )
    return {
        "review_attempts": attempts,
        "correct_review_attempts": correct,
        "review_accuracy": correct / attempts if attempts > 0 else None,
        "average_delta_hours": float(deltas.mean()) if len(deltas) > 0 else None,
    }


# ---------------------------------------------------------------------------
# Bundle-level application
# ---------------------------------------------------------------------------

def _join_keys(*frames: pd.DataFrame) -> list[str]:
    keys = ["anonymous_user_id", "session_date"]
    if all("anonymous_user_id" in f.columns for f in frames):
        return keys
    return ["session_date"]


def annotate_sessions(sessions: pd.DataFrame) -> None:
    """Add flashcards_stage_completed and loop_completed in place."""
    if sessions.empty:
        return
    sessions["flashcards_stage_completed"] = flashcards_stage_completed(sessions)
    sessions["loop_completed"] = loop_completed(sessions)


def annotate_daily_aggregates(
    daily: pd.DataFrame,
    sessions: pd.DataFrame,
    review_events: pd.DataFrame,
) -> None:
    """Add research columns to the daily aggregates in place.

    - loop_completed: exported column if present, else from the session row
      for that participant-day (False when there is none).
    - flashcard_correct_count: correct attempts that day, counted from raw
      review events, so cohort accuracy is a ratio of summed counts.
    - review_proxy_attempts / review_proxy_correct and
      review_correctness_proxy: main-queue review cards only.

    ``sessions`` must already have been through annotate_sessions.
    """
    if daily.empty:
        return

    # loop_completed
    computed = pd.Series(False, index=daily.index)
    if not sessions.empty and "loop_completed" in sessions.columns and "session_date" in sessions.columns:
        keys = _join_keys(daily, sessions)
        lookup = (
            sessions.drop_duplicates(subset=keys, keep="last")
            .set_index(keys)["loop_completed"]
        )
        idx = pd.MultiIndex.from_frame(daily[keys]) if len(keys) > 1 else daily[keys[0]]
        computed = pd.Series(lookup.reindex(idx).to_numpy(), index=daily.index).eq(True)
    daily["loop_completed"] = _prefer_exported(daily, "loop_completed", computed)

    # Correct-attempt and retention-proxy counts from raw review events
    has_events = not review_events.empty and {"correct", "session_date"} <= set(review_events.columns)
    if has_events:
        keys = _join_keys(daily, review_events)
        events = review_events.assign(
            _correct=_flag(review_events, "correct").astype(int),
            _proxy=retention_proxy_mask(review_events).astype(int),
        )
        events["_proxy_correct"] = events["_correct"] * events["_proxy"]
        per_day = events.groupby(keys)[["_correct", "_proxy", "_proxy_correct"]].sum()
        idx = pd.MultiIndex.from_frame(daily[keys]) if len(keys) > 1 else daily[keys[0]]
        per_day = per_day.reindex(idx).fillna(0).astype(int)
        daily["flashcard_correct_count"] = per_day["_correct"].to_numpy()
        daily["review_proxy_attempts"] = per_day["_proxy"].to_numpy()
        daily["review_proxy_correct"] = per_day["_proxy_correct"].to_numpy()
    else:
        # No raw events to count: reconstruct from the exported daily rate.
        accuracy = (
            pd.to_numeric(daily["flashcard_accuracy"], errors="coerce")
            if "flashcard_accuracy" in daily.columns
            else pd.Series(float("nan"), index=daily.index)
        )
        attempts = _count(daily, "flashcard_attempts_count")
        daily["flashcard_correct_count"] = (accuracy * attempts).round().fillna(0).astype(int)
        daily["review_proxy_attempts"] = 0
        daily["review_proxy_correct"] = 0

    if has_events or review_events.empty:
        proxy_attempts = daily["review_proxy_attempts"]
        daily["review_correctness_proxy"] = (
            daily["review_proxy_correct"] / proxy_attempts.where(proxy_attempts > 0)
        )


def compute_summary(
    sessions: pd.DataFrame,
    review_events: pd.DataFrame,
    saved_words: pd.DataFrame,
    daily_aggregates: pd.DataFrame,
) -> dict[str, Any]:
    """Summary metrics from raw rows (mirror of buildAnalyticsSummary).

    Works for single-user and merged cohort frames alike; every rate is a
    ratio of summed counts, never an average of per-participant rates.
    """
    started = _present(sessions, "started_at")
    loop = loop_completed(sessions)
    flashcards_done = flashcards_stage_completed(sessions)
    reading_done = _flag(sessions, "reading_done")
    listening_done = _flag(sessions, "listening_done")
    has_listening_asset = _present(sessions, "listening_asset_id")

    total_started = int(started.sum())
    total_completed = int(loop.sum())
    total_attempts = int(len(review_events))
    correct_attempts = int(_flag(review_events, "correct").sum())

    stage_totals = {
        "started": total_started,
        "flashcards_completed": int(flashcards_done.sum()),
        "reading_completed": int(reading_done.sum()),
        "listening_completed": int((has_listening_asset & listening_done).sum()),
        "completed": total_completed,
    }
    listening_eligible = int((reading_done & has_listening_asset).sum())
    stage_drop_off = {
        "before_flashcards_complete": max(0, stage_totals["started"] - stage_totals["flashcards_completed"]),
        "before_reading_complete": max(0, stage_totals["flashcards_completed"] - stage_totals["reading_completed"]),
        "before_listening_complete": max(0, listening_eligible - stage_totals["listening_completed"]),
    }

    if "days_active_flag" in daily_aggregates.columns:
        days_active = int(daily_aggregates["days_active_flag"].eq(True).sum())
    elif not daily_aggregates.empty:
        days_active = int((
            (_count(daily_aggregates, "flashcard_attempts_count") > 0)
            | (_count(daily_aggregates, "reader_saved_words_count") > 0)
            | _flag(daily_aggregates, "reading_completed")
            | _flag(daily_aggregates, "listening_completed")
        ).sum())
    else:
        days_active = 0

    reader_saved = (
        int(saved_words["added_via"].eq("reader").sum())
        if "added_via" in saved_words.columns
        else 0
    )
    retries = (
        int(review_events["queue_source"].eq("retry").sum())
        if "queue_source" in review_events.columns
        else 0
    )

    return {
        "total_sessions_started": total_started,
        "total_sessions_completed": total_completed,
        "daily_session_completion_rate": total_completed / total_started if total_started > 0 else None,
        "flashcard_accuracy": correct_attempts / total_attempts if total_attempts > 0 else None,
        "review_retention_proxy": retention_proxy(review_events),
        "stage_totals": stage_totals,
        "stage_drop_off": stage_drop_off,
        "days_active": days_active,
        "total_flashcard_attempts": total_attempts,
        "total_flashcard_retries": retries,
        "total_reader_saved_words": reader_saved,
        "total_reading_completions": int(reading_done.sum()),
        "total_listening_completions": int(listening_done.sum()),
        "total_time_seconds": int(_count(daily_aggregates, "total_time_seconds").sum()),
    }
