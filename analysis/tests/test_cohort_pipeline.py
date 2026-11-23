"""End-to-end and definition tests for the export pipeline (load_export,
metrics, build_report) on the synthetic two-participant cohort export."""

import json

import pandas as pd
import pytest

import build_report
import synthetic_export as se
from load_export import load_bundle, validate_bundle
from metrics import loop_completed


def _sessions_by_id(bundle):
    return bundle.sessions.set_index("id")


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

def test_cohort_export_loads_and_validates(cohort_export_path):
    bundle = load_bundle(cohort_export_path)
    assert bundle.is_cohort
    assert bundle.participant_count == 2
    assert bundle.participant_ids == ["P001", "P002"]
    assert validate_bundle(bundle) == []
    assert len(bundle.review_events) == se.EXPECTED_TOTAL_ATTEMPTS
    # Exported per-participant summaries are kept, keyed by participant.
    assert set(bundle.exported_summary) == {"P001", "P002"}


def test_cohort_flashcard_accuracy_is_summed_correct_over_attempts(cohort_export_path):
    summary = load_bundle(cohort_export_path).summary
    assert summary["total_flashcard_attempts"] == se.EXPECTED_TOTAL_ATTEMPTS
    assert summary["flashcard_accuracy"] == pytest.approx(se.EXPECTED_ACCURACY)
    # The old merge computed round(acc or 0 * n) == 1 per participant,
    # i.e. participant_count / attempts.
    assert summary["flashcard_accuracy"] != pytest.approx(2 / se.EXPECTED_TOTAL_ATTEMPTS)


# ---------------------------------------------------------------------------
# Contract B: loop_completed
# ---------------------------------------------------------------------------

def test_loop_completed_is_computed_from_historical_columns(cohort_export_path):
    bundle = load_bundle(cohort_export_path)
    loop = _sessions_by_id(bundle)["loop_completed"]
    assert loop.to_dict() == {
        "s11": True,   # normal completion
        "s12": True,   # retries met target, server left completed=false
        "s13": True,   # "Do more flashcards" reset completed, completed_at kept
        "s21": False,  # reading/listening done but 2 < 5 flashcards
        "s23": True,
    }
    assert int(bundle.sessions["completed"].sum()) == se.EXPECTED_RAW_COMPLETED


def test_summary_uses_loop_completed_not_raw_flag(cohort_export_path):
    bundle = load_bundle(cohort_export_path)
    s = bundle.summary
    assert s["total_sessions_started"] == se.EXPECTED_SESSIONS_STARTED
    assert s["total_sessions_completed"] == se.EXPECTED_LOOP_COMPLETED
    assert s["daily_session_completion_rate"] == pytest.approx(4 / 5)
    assert s["stage_totals"] == {
        "started": 5,
        "flashcards_completed": 4,  # s12 counts: 5 attempts incl. retry >= 5
        "reading_completed": 5,
        "listening_completed": 5,
        "completed": 4,
    }
    assert s["stage_drop_off"] == {
        "before_flashcards_complete": 1,
        "before_reading_complete": 0,
        "before_listening_complete": 0,
    }
    # The v1 summaries in the export still carry the raw-flag numbers.
    exported_completed = sum(
        p["total_sessions_completed"] for p in bundle.exported_summary.values()
    )
    assert exported_completed == se.EXPECTED_RAW_COMPLETED


@pytest.mark.parametrize(
    "row, expected",
    [
        ({"completed_at": "2026-04-27T10:00:00Z"}, True),
        ({"reading_done": True, "listening_done": True,
          "flashcard_attempts_count": 5, "assigned_flashcard_count": 5}, True),
        ({"reading_done": True, "listening_done": True,
          "flashcards_completed_at": "2026-04-27T10:00:00Z",
          "flashcard_attempts_count": 1, "assigned_flashcard_count": 10}, True),
        ({"reading_done": True, "listening_done": True,
          "flashcard_attempts_count": 4, "assigned_flashcard_count": 5}, False),
        ({"reading_done": True, "listening_done": False,
          "flashcard_attempts_count": 5, "assigned_flashcard_count": 5}, False),
        # The raw flag alone never counts.
        ({"completed": True, "reading_done": False, "listening_done": False,
          "flashcard_attempts_count": 0, "assigned_flashcard_count": 5}, False),
        # Null counts behave like 0 (TS `?? 0`).
        ({"reading_done": True, "listening_done": True,
          "flashcard_attempts_count": None, "assigned_flashcard_count": None}, True),
    ],
)
def test_loop_completed_rule(row, expected):
    base = {
        "completed": False,
        "completed_at": None,
        "flashcards_completed_at": None,
        "reading_done": False,
        "listening_done": False,
        "flashcard_attempts_count": 0,
        "assigned_flashcard_count": 0,
    }
    df = pd.DataFrame([{**base, **row}])
    assert bool(loop_completed(df).iloc[0]) is expected


def test_exported_loop_completed_column_wins_where_set(tmp_path):
    payload = se.build_cohort_export()
    p001 = payload["participants"][0]["datasets"]
    for row in p001["sessions"]:
        # s12 exported as False overrides the computed True; s13 left null
        # falls back to the computed value.
        row["loop_completed"] = {"s11": True, "s12": False, "s13": None}[row["id"]]
    for row in p001["daily_aggregates"]:
        row["loop_completed"] = row["session_date"] != "2026-04-28"
    path = se.write_json(payload, tmp_path / "v2.json")

    bundle = load_bundle(path)
    loop = _sessions_by_id(bundle)["loop_completed"]
    assert bool(loop["s12"]) is False
    assert bool(loop["s13"]) is True
    assert bool(loop["s21"]) is False  # P002 has no exported column
    assert bundle.summary["total_sessions_completed"] == 3


def test_daily_aggregates_get_loop_completed_from_sessions(cohort_export_path):
    da = load_bundle(cohort_export_path).daily_aggregates
    got = {
        (r.anonymous_user_id, r.session_date.isoformat()): bool(r.loop_completed)
        for r in da.itertuples()
    }
    assert got == {
        ("P001", "2026-04-27"): True,
        ("P001", "2026-04-28"): True,
        ("P001", "2026-04-29"): True,
        ("P002", "2026-04-27"): False,
        ("P002", "2026-04-28"): False,  # no session row
        ("P002", "2026-04-29"): True,
    }


# ---------------------------------------------------------------------------
# Contract C: retention proxy from main-queue review cards only
# ---------------------------------------------------------------------------

def test_retention_proxy_excludes_same_session_retries(cohort_export_path):
    bundle = load_bundle(cohort_export_path)
    rp = bundle.summary["review_retention_proxy"]
    assert rp["review_attempts"] == se.EXPECTED_MAIN_REVIEW_ATTEMPTS
    assert rp["correct_review_attempts"] == se.EXPECTED_MAIN_REVIEW_CORRECT
    assert rp["review_accuracy"] == pytest.approx(5 / 7)
    assert rp["average_delta_hours"] == pytest.approx(se.EXPECTED_MAIN_REVIEW_MEAN_DELTA)

    # The v1 export counted the two review-card retries.
    exported = [p["review_retention_proxy"] for p in bundle.exported_summary.values()]
    assert sum(p["review_attempts"] for p in exported) == se.V1_REVIEW_ATTEMPTS


def test_daily_retention_proxy_is_recomputed_main_only(cohort_export_path):
    da = load_bundle(cohort_export_path).daily_aggregates.set_index(
        ["anonymous_user_id", "session_date"]
    )
    day = pd.Timestamp("2026-04-28").date()
    # P001 04-28: main r6 correct, r7 wrong; retry r10 correct (v1 gave 2/3).
    assert da.loc[("P001", day), "review_correctness_proxy"] == pytest.approx(0.5)
    assert da.loc[("P001", day), "review_proxy_attempts"] == 2
    # P002 04-27 has no review cards at all.
    assert pd.isna(da.loc[("P002", pd.Timestamp("2026-04-27").date()), "review_correctness_proxy"])


# ---------------------------------------------------------------------------
# build_report end to end
# ---------------------------------------------------------------------------

def _read_metrics(output_dir):
    df = pd.read_csv(output_dir / "summary_metrics.csv")
    return dict(zip(df["metric"], df["value"].astype(str)))


def test_build_report_cohort_end_to_end(cohort_export_path, report_dirs):
    figures, output = report_dirs
    build_report.main([str(cohort_export_path)])

    for name in [
        "sessions_started_vs_completed.png",
        "session_completion_rate.png",
        "stage_completion.png",
        "review_correctness_proxy.png",
    ]:
        assert (figures / name).exists(), name

    metrics = _read_metrics(output)
    assert metrics["Sessions with recorded start"] == "5"
    assert metrics["Sessions completed"] == "4"
    assert metrics["Session completion rate"] == "80.0%"
    assert metrics["Flashcard attempt accuracy (all queues)"] == "80.0%"
    assert metrics["Review-card correctness (retention proxy)"] == "71.4%"
    assert metrics["Mean inter-review interval (hours)"] == "35.1"

    daily = pd.read_csv(output / "daily_aggregates.csv").set_index("session_date")
    assert daily["session_started"].tolist() == [2, 1, 2]
    assert daily["loop_completed"].tolist() == [1, 1, 2]
    assert daily["session_completed"].tolist() == [1, 0, 1]  # raw flag, for contrast
    assert daily["flashcard_accuracy"].tolist() == pytest.approx([6 / 7, 0.8, 0.75])
    assert daily["review_correctness_proxy"].tolist() == pytest.approx([1.0, 0.5, 2 / 3])

    per_participant = pd.read_csv(output / "per_participant_summary.csv").set_index("participant_id")
    assert per_participant.loc["P001", "total_sessions_completed"] == 3
    assert per_participant.loc["P002", "total_sessions_completed"] == 1

    summary_md = (output / "summary.md").read_text(encoding="utf-8")
    assert "2 session(s) count as completed (loop_completed) but have completed=false" in summary_md
    assert "Stage progression" in summary_md
    assert "- Participant-days with recorded activity: 5" in summary_md
    assert metrics["Participant-days with recorded activity"] == "5"

    # Day counts and means are over participant-days (2 participants x 3
    # dates; P002 inactive on 04-28), not over the 3 per-date cohort rows.
    chapter = (output / "chapter_support_summary.md").read_text(encoding="utf-8")
    assert "(3 calendar days)" in chapter
    assert "recorded activity on 5 of 6 participant-days." in chapter
    assert "The user" not in chapter
    assert "- Reading stage completions: **5** (on 5 participant-days)" in chapter
    assert "- Listening stage completions: **5** (on 5 participant-days)" in chapter
    # 1 saved word / 5 active participant-days; 2160 s / 5 = 7.2 min.
    assert "- Mean saved words per active participant-day: **0.2**" in chapter
    assert "- Total: **36.0 minutes**" in chapter
    assert "- Mean per active participant-day: **7.2 minutes**" in chapter


def test_build_report_single_user_end_to_end(single_user_export_path, report_dirs):
    _, output = report_dirs
    build_report.main([str(single_user_export_path)])
    metrics = _read_metrics(output)
    assert metrics["Sessions with recorded start"] == "3"
    assert metrics["Sessions completed"] == "3"
    assert metrics["Session completion rate"] == "100.0%"
    # P001: 13 / 16 correct; main review cards r3 r4 r6 r7 r11 r12 -> 5 / 6.
    assert metrics["Flashcard attempt accuracy (all queues)"] == "81.2%"
    assert metrics["Review-card correctness (retention proxy)"] == "83.3%"
    assert metrics["Days with recorded activity"] == "3"

    chapter = (output / "chapter_support_summary.md").read_text(encoding="utf-8")
    assert "The user was active on 3 of 3 days." in chapter
    assert "- Reading stage completions: **3** (on 3 days)" in chapter
    # 1308 s over 3 active days.
    assert "- Mean per active day: **7.3 minutes**" in chapter


def test_build_report_handles_empty_cohort(tmp_path, report_dirs):
    payload = se.build_cohort_export()
    for p in payload["participants"]:
        p["datasets"] = {k: [] for k in p["datasets"]}
    path = tmp_path / "empty.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    _, output = report_dirs
    build_report.main([str(path)])
    assert (output / "summary.md").exists()
