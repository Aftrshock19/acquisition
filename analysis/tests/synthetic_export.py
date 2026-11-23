"""
Synthetic export bundles for the analysis tests.

The rows follow the shape of lib/analytics/export.ts (buildJsonExport) and
app/api/admin/progress/export/route.ts (cohort envelope).  By default the
derived parts (daily_aggregates, summary) are built the way the
dissertation-metrics-v1 export built them, i.e. what the pilot exports
contain: session_completed is the raw ``completed`` flag and the retention
proxy includes same-session retries.  The tests check that the pipeline
recomputes those at read time instead of trusting them.

Two participants over 2026-04-27 .. 2026-04-29:

P001
  04-27  s11  normal completion (stage=completed, completed=true)
  04-28  s12  retries met the target (5 attempts >= 5 assigned) but the server
              counted first attempts only, so it stayed stage=flashcards,
              completed=false after reading and listening were done
  04-29  s13  finished, then "Do more flashcards": completed=false,
              stage=flashcards, completed_at kept, target raised to 10
P002
  04-27  s21  reading and listening done but flashcards not (2 < 5, never
              skipped): NOT loop-completed
  04-28  (no session row)
  04-29  s23  normal completion

20 review events, 16 correct (80 %).  Main-queue review-card events: 7, 5
correct, delta_hours sum 246.  Two review-card retries (correct, delta_hours
0.05 and 0.1) must be excluded from the retention proxy.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

RANGE = {"from": "2026-04-27", "to": "2026-04-29"}
DATES = ["2026-04-27", "2026-04-28", "2026-04-29"]
TZ = "Europe/London"

# Expected values (hand-computed from the rows below).
EXPECTED_TOTAL_ATTEMPTS = 20
EXPECTED_TOTAL_CORRECT = 16
EXPECTED_ACCURACY = 0.8
EXPECTED_SESSIONS_STARTED = 5
EXPECTED_LOOP_COMPLETED = 4  # s11, s12, s13, s23
EXPECTED_RAW_COMPLETED = 2  # s11, s23
EXPECTED_MAIN_REVIEW_ATTEMPTS = 7
EXPECTED_MAIN_REVIEW_CORRECT = 5
EXPECTED_MAIN_REVIEW_MEAN_DELTA = 246 / 7
# What the v1 export (retries included) reported, for contrast.
V1_REVIEW_ATTEMPTS = 9
V1_REVIEW_CORRECT = 7


def _session(
    sid: str,
    date: str,
    *,
    stage: str,
    completed: bool,
    completed_at: str | None,
    flashcards_completed_at: str | None,
    assigned: int,
    attempts: int,
    main: int,
    retries: int,
    reading_done: bool,
    listening_done: bool,
) -> dict[str, Any]:
    ts = f"{date}T09:00:00.000Z"
    return {
        "id": sid,
        "session_date": date,
        "stage": stage,
        "started_at": ts,
        "last_active_at": f"{date}T09:30:00.000Z",
        "last_resumed_at": None,
        "resume_count": 0,
        "flashcards_completed_at": flashcards_completed_at,
        "reading_opened_at": ts if reading_done else None,
        "reading_completed_at": f"{date}T09:20:00.000Z" if reading_done else None,
        "reading_time_seconds": 300 if reading_done else 0,
        "listening_opened_at": ts if listening_done else None,
        "listening_playback_started_at": ts if listening_done else None,
        "listening_completed_at": f"{date}T09:25:00.000Z" if listening_done else None,
        "listening_time_seconds": 120 if listening_done else 0,
        "listening_max_position_seconds": 120 if listening_done else None,
        "listening_required_seconds": 100,
        "listening_transcript_opened": False,
        "listening_playback_rate": 1.0 if listening_done else None,
        "assigned_flashcard_count": assigned,
        "assigned_new_words_count": 2,
        "assigned_review_cards_count": max(0, assigned - 2),
        "daily_target_mode": "recommended",
        "flashcard_completed_count": main,
        "flashcard_new_completed_count": 0,
        "flashcard_review_completed_count": 0,
        "flashcard_attempts_count": attempts,
        "flashcard_retry_count": retries,
        "reading_done": reading_done,
        "reading_text_id": f"text-{sid}",
        "listening_done": listening_done,
        "listening_asset_id": f"audio-{sid}",
        "completed": completed,
        "completed_at": completed_at,
        "created_at": ts,
        "updated_at": f"{date}T09:30:00.000Z",
        "new_words_count": 2,
        "reviews_done": 0,
    }


def _review(
    rid: str,
    sid: str,
    date: str,
    kind: str,
    source: str,
    correct: bool,
    delta_hours: float | None = None,
    ms: int = 3000,
) -> dict[str, Any]:
    return {
        "id": rid,
        "daily_session_id": sid,
        "session_date": date,
        "word_id": f"w-{rid}",
        "queue_kind": kind,
        "queue_source": source,
        "card_type": "cloze",
        "grade": "good" if correct else "again",
        "correct": correct,
        "first_try": source == "main",
        "retry_index": 0 if source == "main" else 1,
        "scheduler_outcome": None,
        "ms_spent": ms,
        "shown_at": f"{date}T09:01:00.000Z",
        "submitted_at": f"{date}T09:01:03.000Z",
        "retry_scheduled_for": None,
        "client_attempt_id": f"cid-{rid}",
        "created_at": f"{date}T09:01:03.000Z",
        "delta_hours": delta_hours,
        "user_answer": "x",
        "expected": "x",
    }


def participant_rows() -> dict[str, dict[str, list[dict[str, Any]]]]:
    d1, d2, d3 = DATES
    p001_sessions = [
        _session("s11", d1, stage="completed", completed=True,
                 completed_at=f"{d1}T09:26:00.000Z",
                 flashcards_completed_at=f"{d1}T09:10:00.000Z",
                 assigned=4, attempts=5, main=4, retries=1,
                 reading_done=True, listening_done=True),
        _session("s12", d2, stage="flashcards", completed=False,
                 completed_at=None, flashcards_completed_at=None,
                 assigned=5, attempts=5, main=4, retries=1,
                 reading_done=True, listening_done=True),
        _session("s13", d3, stage="flashcards", completed=False,
                 completed_at=f"{d3}T09:26:00.000Z",
                 flashcards_completed_at=f"{d3}T09:10:00.000Z",
                 assigned=10, attempts=6, main=5, retries=1,
                 reading_done=True, listening_done=True),
    ]
    p001_reviews = [
        _review("r1", "s11", d1, "new", "main", True),
        _review("r2", "s11", d1, "new", "main", False),
        _review("r3", "s11", d1, "review", "main", True, 24.0),
        _review("r4", "s11", d1, "review", "main", True, 48.0),
        _review("r5", "s11", d1, "new", "retry", True),
        _review("r6", "s12", d2, "review", "main", True, 24.0),
        _review("r7", "s12", d2, "review", "main", False, 72.0),
        _review("r8", "s12", d2, "new", "main", True),
        _review("r9", "s12", d2, "new", "main", True),
        _review("r10", "s12", d2, "review", "retry", True, 0.05),
        _review("r11", "s13", d3, "review", "main", True, 24.0),
        _review("r12", "s13", d3, "review", "main", True, 24.0),
        _review("r13", "s13", d3, "new", "main", True),
        _review("r14", "s13", d3, "new", "main", False),
        _review("r15", "s13", d3, "new", "main", True),
        _review("r16", "s13", d3, "new", "retry", True),
    ]
    p002_sessions = [
        _session("s21", d1, stage="flashcards", completed=False,
                 completed_at=None, flashcards_completed_at=None,
                 assigned=5, attempts=2, main=2, retries=0,
                 reading_done=True, listening_done=True),
        _session("s23", d3, stage="completed", completed=True,
                 completed_at=f"{d3}T09:26:00.000Z",
                 flashcards_completed_at=f"{d3}T09:10:00.000Z",
                 assigned=2, attempts=2, main=1, retries=1,
                 reading_done=True, listening_done=True),
    ]
    p002_reviews = [
        _review("r17", "s21", d1, "new", "main", True),
        _review("r18", "s21", d1, "new", "main", True),
        _review("r19", "s23", d3, "review", "main", False, 30.0),
        _review("r20", "s23", d3, "review", "retry", True, 0.1),
    ]
    p002_saved = [
        {
            "session_date": d1,
            "daily_session_id": "s21",
            "text_id": "text-s21",
            "word_id": "w-saved",
            "added_at": f"{d1}T09:15:00.000Z",
            "added_via": "reader",
            "deck_id": "deck-1",
        }
    ]
    return {
        "P001": {"sessions": p001_sessions, "review_events": p001_reviews, "saved_words": []},
        "P002": {"sessions": p002_sessions, "review_events": p002_reviews, "saved_words": p002_saved},
    }


def _v1_daily_aggregates(pid: str, rows: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Mirror of the pre-fix (v1) buildDailyAggregates in lib/analytics/service.ts."""
    out = []
    for date in DATES:
        session = next((s for s in rows["sessions"] if s["session_date"] == date), None)
        events = [e for e in rows["review_events"] if e["session_date"] == date]
        main = [e for e in events if e["queue_source"] != "retry"]
        review_kind = [e for e in events if e["queue_kind"] == "review"]  # v1: retries included
        saved = [w for w in rows["saved_words"] if w["session_date"] == date and w["added_via"] == "reader"]
        fc_seconds = round(sum(max(0, e["ms_spent"]) for e in events) / 1000)
        reading_s = session["reading_time_seconds"] if session else 0
        listening_s = session["listening_time_seconds"] if session else 0
        attempts = len(events)
        out.append({
            "anonymous_user_id": pid,
            "session_date": date,
            "session_started": bool(session and session["started_at"]),
            "session_completed": bool(session and session["completed"]),
            "loop_completed_at_present": bool(session and session["completed_at"]),
            "stage": session["stage"] if session else None,
            "assigned_flashcard_count": session["assigned_flashcard_count"] if session else 0,
            "assigned_new_words_count": session["assigned_new_words_count"] if session else 0,
            "assigned_review_cards_count": session["assigned_review_cards_count"] if session else 0,
            "flashcard_completed_count": len(main),
            "flashcard_new_completed_count": len([e for e in main if e["queue_kind"] == "new"]),
            "flashcard_review_completed_count": len([e for e in main if e["queue_kind"] == "review"]),
            "flashcard_attempts_count": attempts,
            "flashcard_retry_count": len([e for e in events if e["queue_source"] == "retry"]),
            "flashcard_accuracy": (sum(e["correct"] for e in events) / attempts) if attempts else None,
            "review_correctness_proxy": (
                sum(e["correct"] for e in review_kind) / len(review_kind) if review_kind else None
            ),
            "reader_saved_words_count": len(saved),
            "reading_completed": bool(session and session["reading_done"]),
            "listening_completed": bool(session and session["listening_done"]),
            "reading_time_seconds": reading_s,
            "listening_time_seconds": listening_s,
            "flashcard_time_seconds": fc_seconds,
            "total_time_seconds": fc_seconds + reading_s + listening_s,
            "days_active_flag": bool(
                attempts or saved
                or (session and (session["reading_done"] or session["listening_done"]))
            ),
            "workload_assigned_units": (session["assigned_flashcard_count"] + 2) if session else 0,
            "workload_completed_units": (
                len(main) + int(session["reading_done"]) + int(session["listening_done"])
            ) if session else 0,
            "workload_completion_rate": None,
            "daily_target_mode": "recommended",
        })
    return out


def _v1_summary(rows: dict[str, list[dict[str, Any]]], daily: list[dict[str, Any]]) -> dict[str, Any]:
    """Mirror of the pre-fix (v1) buildAnalyticsSummary: raw completed flag,
    retention proxy including retries."""
    sessions = rows["sessions"]
    events = rows["review_events"]
    started = sum(1 for s in sessions if s["started_at"])
    completed = sum(1 for s in sessions if s["completed"])
    review_kind = [e for e in events if e["queue_kind"] == "review"]
    deltas = [e["delta_hours"] for e in review_kind if e["delta_hours"] is not None]
    return {
        "total_sessions_started": started,
        "total_sessions_completed": completed,
        "daily_session_completion_rate": completed / started if started else None,
        "flashcard_accuracy": sum(e["correct"] for e in events) / len(events) if events else None,
        "review_retention_proxy": {
            "review_attempts": len(review_kind),
            "correct_review_attempts": sum(e["correct"] for e in review_kind),
            "review_accuracy": (
                sum(e["correct"] for e in review_kind) / len(review_kind) if review_kind else None
            ),
            "average_delta_hours": sum(deltas) / len(deltas) if deltas else None,
        },
        "stage_totals": {
            "started": started,
            "flashcards_completed": sum(
                1 for s in sessions
                if s["flashcards_completed_at"]
                or s["flashcard_completed_count"] >= s["assigned_flashcard_count"]
            ),
            "reading_completed": sum(1 for s in sessions if s["reading_done"]),
            "listening_completed": sum(
                1 for s in sessions if s["listening_asset_id"] and s["listening_done"]
            ),
            "completed": completed,
        },
        "stage_drop_off": {
            "before_flashcards_complete": 0,
            "before_reading_complete": 0,
            "before_listening_complete": 0,
        },
        "days_active": sum(1 for d in daily if d["days_active_flag"]),
        "total_flashcard_attempts": len(events),
        "total_flashcard_retries": sum(1 for e in events if e["queue_source"] == "retry"),
        "total_reader_saved_words": sum(1 for w in rows["saved_words"] if w["added_via"] == "reader"),
        "total_reading_completions": sum(1 for s in sessions if s["reading_done"]),
        "total_listening_completions": sum(1 for s in sessions if s["listening_done"]),
        "total_time_seconds": sum(d["total_time_seconds"] for d in daily),
    }


def _participant_export(pid: str, rows: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    daily = _v1_daily_aggregates(pid, rows)
    with_pid = lambda items: [{"anonymous_user_id": pid, **item} for item in items]  # noqa: E731
    return {
        "format_version": "dissertation-metrics-v1",
        "exported_at": "2026-05-20T12:00:00.000Z",
        "app_session_time_zone": TZ,
        "anonymous_user_id": pid,
        "range": dict(RANGE),
        "metric_definitions": {},
        "summary": _v1_summary(rows, daily),
        "today": None,
        "datasets": {
            "daily_aggregates": daily,
            "sessions": with_pid(rows["sessions"]),
            "review_events": with_pid(rows["review_events"]),
            "reading_events": [],
            "listening_events": [],
            "saved_words": with_pid(rows["saved_words"]),
            "reading_question_attempts": [],
            "export_runs": [],
            "placement_runs": [],
            "placement_responses": [],
        },
    }


def build_cohort_export() -> dict[str, Any]:
    participants = [_participant_export(pid, rows) for pid, rows in participant_rows().items()]
    return {
        "format_version": "dissertation-metrics-v1",
        "exported_at": "2026-05-20T12:00:00.000Z",
        "app_session_time_zone": TZ,
        "cohort_key": "default",
        "range": dict(RANGE),
        "participant_count": len(participants),
        "metric_definitions": {
            "daily_session_completion_rate": {
                "id": "daily_session_completion_rate",
                "label": "Daily session completion rate",
                "description": "synthetic",
            }
        },
        "participants": participants,
    }


def build_single_user_export(pid: str = "P001") -> dict[str, Any]:
    return copy.deepcopy(_participant_export(pid, participant_rows()[pid]))


def write_json(payload: dict[str, Any], path: Path) -> Path:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path
