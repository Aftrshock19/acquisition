"""
Load and validate JSON export bundles produced by /api/progress/export
(single-user) or /api/admin/progress/export (cohort).

Usage:
    from load_export import load_bundle, validate_bundle

The loader returns an ExportBundle with typed pandas DataFrames for each
dataset.  Cohort exports (identified by a top-level ``participants`` array)
are automatically merged into combined DataFrames with an
``anonymous_user_id`` column distinguishing participants.

Schema validation raises immediately if the export shape has changed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pandas as pd

# ---------------------------------------------------------------------------
# Expected column sets — kept in sync with lib/analytics/export.ts
# These are the MINIMUM required columns.  Extra columns are tolerated.
# ---------------------------------------------------------------------------

DAILY_AGGREGATES_REQUIRED = {
    "session_date",
    "session_started",
    "session_completed",
    "assigned_flashcard_count",
    "flashcard_completed_count",
    "flashcard_new_completed_count",
    "flashcard_review_completed_count",
    "flashcard_attempts_count",
    "flashcard_retry_count",
    "flashcard_accuracy",
    "review_correctness_proxy",
    "reader_saved_words_count",
    "reading_completed",
    "listening_completed",
    "reading_time_seconds",
    "listening_time_seconds",
    "flashcard_time_seconds",
    "total_time_seconds",
}

SESSIONS_REQUIRED = {
    "id",
    "session_date",
    "stage",
    "started_at",
    "completed",
}

REVIEW_EVENTS_REQUIRED = {
    "id",
    "session_date",
    "word_id",
    "queue_kind",
    "queue_source",
    "grade",
    "correct",
    "ms_spent",
    # SRS v2 fields (present in exports from 2026-04-10 onwards;
    # older exports may have these as null/missing — _check_columns
    # tolerates missing columns in empty DataFrames)
    "first_try",
    "retry_index",
    "scheduler_outcome",
}

SAVED_WORDS_REQUIRED = {
    "session_date",
    "word_id",
    "added_via",
}

READING_EVENTS_REQUIRED = {
    "session_date",
    "reading_done",
}

LISTENING_EVENTS_REQUIRED = {
    "session_date",
    "listening_done",
}


class ExportBundle:
    """Container for the loaded and validated export data."""

    def __init__(
        self,
        meta: dict[str, Any],
        daily_aggregates: pd.DataFrame,
        sessions: pd.DataFrame,
        review_events: pd.DataFrame,
        saved_words: pd.DataFrame,
        reading_events: pd.DataFrame,
        listening_events: pd.DataFrame,
        summary: dict[str, Any],
        metric_definitions: dict[str, Any],
    ):
        self.meta = meta
        self.daily_aggregates = daily_aggregates
        self.sessions = sessions
        self.review_events = review_events
        self.saved_words = saved_words
        self.reading_events = reading_events
        self.listening_events = listening_events
        self.summary = summary
        self.metric_definitions = metric_definitions

    @property
    def date_range(self) -> tuple[str, str]:
        r = self.meta.get("range", {})
        return r.get("from", ""), r.get("to", "")

    @property
    def anonymous_user_id(self) -> str:
        return self.meta.get("anonymous_user_id", "unknown")

    @property
    def is_cohort(self) -> bool:
        return self.meta.get("cohort_key") is not None

    @property
    def participant_count(self) -> int:
        return self.meta.get("participant_count", 1)

    @property
    def participant_ids(self) -> list[str]:
        if not self.is_cohort or self.daily_aggregates.empty:
            return [self.anonymous_user_id]
        return sorted(self.daily_aggregates["anonymous_user_id"].unique().tolist())


def load_bundle(path: str | Path) -> ExportBundle:
    """Load a JSON export bundle from disk and return an ExportBundle.

    Supports both single-user exports (from /api/progress/export) and
    cohort exports (from /api/admin/progress/export).  Cohort exports are
    identified by the presence of a top-level ``participants`` array and
    are automatically merged into combined DataFrames.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Export file not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        raw: dict[str, Any] = json.load(f)

    # Detect cohort export
    if "participants" in raw:
        return _load_cohort_bundle(raw)

    return _load_single_user_bundle(raw)


def _load_single_user_bundle(raw: dict[str, Any]) -> ExportBundle:
    """Load a single-user export bundle."""
    datasets = raw.get("datasets", {})

    daily_aggregates = _to_df(datasets.get("daily_aggregates", []))
    sessions = _to_df(datasets.get("sessions", []))
    review_events = _to_df(datasets.get("review_events", []))
    saved_words = _to_df(datasets.get("saved_words", []))
    reading_events = _to_df(datasets.get("reading_events", []))
    listening_events = _to_df(datasets.get("listening_events", []))

    _parse_session_dates(daily_aggregates, sessions, review_events, saved_words, reading_events, listening_events)

    meta = {
        "format_version": raw.get("format_version"),
        "exported_at": raw.get("exported_at"),
        "app_session_time_zone": raw.get("app_session_time_zone"),
        "anonymous_user_id": raw.get("anonymous_user_id"),
        "range": raw.get("range", {}),
    }

    return ExportBundle(
        meta=meta,
        daily_aggregates=daily_aggregates,
        sessions=sessions,
        review_events=review_events,
        saved_words=saved_words,
        reading_events=reading_events,
        listening_events=listening_events,
        summary=raw.get("summary", {}),
        metric_definitions=raw.get("metric_definitions", {}),
    )


def _load_cohort_bundle(raw: dict[str, Any]) -> ExportBundle:
    """Load a cohort export by merging per-participant data."""
    all_daily: list[pd.DataFrame] = []
    all_sessions: list[pd.DataFrame] = []
    all_reviews: list[pd.DataFrame] = []
    all_saved: list[pd.DataFrame] = []
    all_reading: list[pd.DataFrame] = []
    all_listening: list[pd.DataFrame] = []

    participants = raw.get("participants", [])
    metric_definitions: dict[str, Any] = {}

    for p in participants:
        datasets = p.get("datasets", {})
        pid = p.get("anonymous_user_id", "unknown")

        for ds_name, ds_rows in datasets.items():
            df = _to_df(ds_rows)
            if df.empty:
                continue
            # Ensure anonymous_user_id column is the participant_id
            df["anonymous_user_id"] = pid

            if ds_name == "daily_aggregates":
                all_daily.append(df)
            elif ds_name == "sessions":
                all_sessions.append(df)
            elif ds_name == "review_events":
                all_reviews.append(df)
            elif ds_name == "saved_words":
                all_saved.append(df)
            elif ds_name == "reading_events":
                all_reading.append(df)
            elif ds_name == "listening_events":
                all_listening.append(df)

        if not metric_definitions and p.get("metric_definitions"):
            metric_definitions = p["metric_definitions"]

    daily_aggregates = pd.concat(all_daily, ignore_index=True) if all_daily else pd.DataFrame()
    sessions = pd.concat(all_sessions, ignore_index=True) if all_sessions else pd.DataFrame()
    review_events = pd.concat(all_reviews, ignore_index=True) if all_reviews else pd.DataFrame()
    saved_words = pd.concat(all_saved, ignore_index=True) if all_saved else pd.DataFrame()
    reading_events = pd.concat(all_reading, ignore_index=True) if all_reading else pd.DataFrame()
    listening_events = pd.concat(all_listening, ignore_index=True) if all_listening else pd.DataFrame()

    _parse_session_dates(daily_aggregates, sessions, review_events, saved_words, reading_events, listening_events)

    if not metric_definitions:
        metric_definitions = raw.get("metric_definitions", {})

    meta = {
        "format_version": raw.get("format_version"),
        "exported_at": raw.get("exported_at"),
        "app_session_time_zone": raw.get("app_session_time_zone"),
        "cohort_key": raw.get("cohort_key"),
        "participant_count": raw.get("participant_count", len(participants)),
        "range": raw.get("range", {}),
    }

    # Build an aggregated summary across all participants
    summary: dict[str, Any] = {}
    per_participant_summaries = [p.get("summary", {}) for p in participants if p.get("summary")]
    if per_participant_summaries:
        summary = _merge_summaries(per_participant_summaries)

    return ExportBundle(
        meta=meta,
        daily_aggregates=daily_aggregates,
        sessions=sessions,
        review_events=review_events,
        saved_words=saved_words,
        reading_events=reading_events,
        listening_events=listening_events,
        summary=summary,
        metric_definitions=metric_definitions,
    )


def _merge_summaries(summaries: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge per-participant summaries into cohort-level totals."""
    merged: dict[str, Any] = {}
    sum_keys = [
        "total_sessions_started",
        "total_sessions_completed",
        "total_flashcard_attempts",
        "total_flashcard_retries",
        "total_reader_saved_words",
        "total_reading_completions",
        "total_listening_completions",
        "total_time_seconds",
        "days_active",
    ]
    for key in sum_keys:
        merged[key] = sum(s.get(key, 0) for s in summaries)

    # Compute cohort-level rates from totals
    if merged["total_sessions_started"] > 0:
        merged["daily_session_completion_rate"] = (
            merged["total_sessions_completed"] / merged["total_sessions_started"]
        )
    else:
        merged["daily_session_completion_rate"] = None

    if merged["total_flashcard_attempts"] > 0:
        correct = sum(
            round(s.get("flashcard_accuracy", 0) or 0 * s.get("total_flashcard_attempts", 0))
            for s in summaries
        )
        merged["flashcard_accuracy"] = correct / merged["total_flashcard_attempts"] if merged["total_flashcard_attempts"] else None
    else:
        merged["flashcard_accuracy"] = None

    merged["participant_count"] = len(summaries)
    return merged


def _parse_session_dates(*dataframes: pd.DataFrame) -> None:
    """Parse session_date columns to date objects in-place."""
    for df in dataframes:
        if not df.empty and "session_date" in df.columns:
            df["session_date"] = pd.to_datetime(df["session_date"]).dt.date


def validate_bundle(bundle: ExportBundle) -> list[str]:
    """
    Validate the export bundle schema.  Returns a list of error messages.
    An empty list means the bundle is valid.
    """
    errors: list[str] = []

    _check_columns(errors, "daily_aggregates", bundle.daily_aggregates, DAILY_AGGREGATES_REQUIRED)
    _check_columns(errors, "sessions", bundle.sessions, SESSIONS_REQUIRED)
    _check_columns(errors, "review_events", bundle.review_events, REVIEW_EVENTS_REQUIRED)
    _check_columns(errors, "saved_words", bundle.saved_words, SAVED_WORDS_REQUIRED)
    _check_columns(errors, "reading_events", bundle.reading_events, READING_EVENTS_REQUIRED)
    _check_columns(errors, "listening_events", bundle.listening_events, LISTENING_EVENTS_REQUIRED)

    if not bundle.meta.get("format_version"):
        errors.append("Missing format_version in export metadata.")

    if not bundle.is_cohort and not bundle.meta.get("anonymous_user_id"):
        errors.append("Missing anonymous_user_id in export metadata.")

    r = bundle.meta.get("range", {})
    if not r.get("from") or not r.get("to"):
        errors.append("Missing or incomplete date range in export metadata.")

    return errors


def _check_columns(
    errors: list[str],
    name: str,
    df: pd.DataFrame,
    required: set[str],
) -> None:
    if df.empty:
        # Empty datasets are valid — the user may simply have no data
        return
    missing = required - set(df.columns)
    if missing:
        errors.append(
            f"Dataset '{name}' is missing required columns: {sorted(missing)}"
        )


def _to_df(rows: list[dict[str, Any]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python load_export.py <path-to-export.json>")
        sys.exit(1)

    bundle = load_bundle(sys.argv[1])
    errors = validate_bundle(bundle)

    if errors:
        print("Validation FAILED:")
        for err in errors:
            print(f"  - {err}")
        sys.exit(1)

    print("Validation PASSED")
    print(f"  Format version: {bundle.meta['format_version']}")
    if bundle.is_cohort:
        print(f"  Cohort: {bundle.meta.get('cohort_key', 'unknown')}")
        print(f"  Participants: {bundle.participant_count}")
    else:
        print(f"  User: {bundle.anonymous_user_id}")
    print(f"  Date range: {bundle.date_range[0]} to {bundle.date_range[1]}")
    print(f"  Daily aggregates: {len(bundle.daily_aggregates)} rows")
    print(f"  Sessions: {len(bundle.sessions)} rows")
    print(f"  Review events: {len(bundle.review_events)} rows")
    print(f"  Saved words: {len(bundle.saved_words)} rows")
    print(f"  Reading events: {len(bundle.reading_events)} rows")
    print(f"  Listening events: {len(bundle.listening_events)} rows")
