"""
Load and validate the JSON export bundle produced by /api/progress/export.

Usage:
    from load_export import load_bundle, validate_bundle

The loader returns a dict with typed pandas DataFrames for each dataset.
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


def load_bundle(path: str | Path) -> ExportBundle:
    """Load a JSON export bundle from disk and return an ExportBundle."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Export file not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        raw: dict[str, Any] = json.load(f)

    datasets = raw.get("datasets", {})

    daily_aggregates = _to_df(datasets.get("daily_aggregates", []))
    sessions = _to_df(datasets.get("sessions", []))
    review_events = _to_df(datasets.get("review_events", []))
    saved_words = _to_df(datasets.get("saved_words", []))
    reading_events = _to_df(datasets.get("reading_events", []))
    listening_events = _to_df(datasets.get("listening_events", []))

    # Parse dates
    if not daily_aggregates.empty and "session_date" in daily_aggregates.columns:
        daily_aggregates["session_date"] = pd.to_datetime(
            daily_aggregates["session_date"]
        ).dt.date

    if not sessions.empty and "session_date" in sessions.columns:
        sessions["session_date"] = pd.to_datetime(sessions["session_date"]).dt.date

    if not review_events.empty and "session_date" in review_events.columns:
        review_events["session_date"] = pd.to_datetime(
            review_events["session_date"]
        ).dt.date

    if not saved_words.empty and "session_date" in saved_words.columns:
        saved_words["session_date"] = pd.to_datetime(
            saved_words["session_date"]
        ).dt.date

    if not reading_events.empty and "session_date" in reading_events.columns:
        reading_events["session_date"] = pd.to_datetime(
            reading_events["session_date"]
        ).dt.date

    if not listening_events.empty and "session_date" in listening_events.columns:
        listening_events["session_date"] = pd.to_datetime(
            listening_events["session_date"]
        ).dt.date

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

    if not bundle.meta.get("anonymous_user_id"):
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
    print(f"  Date range: {bundle.date_range[0]} to {bundle.date_range[1]}")
    print(f"  Daily aggregates: {len(bundle.daily_aggregates)} rows")
    print(f"  Sessions: {len(bundle.sessions)} rows")
    print(f"  Review events: {len(bundle.review_events)} rows")
    print(f"  Saved words: {len(bundle.saved_words)} rows")
    print(f"  Reading events: {len(bundle.reading_events)} rows")
    print(f"  Listening events: {len(bundle.listening_events)} rows")
