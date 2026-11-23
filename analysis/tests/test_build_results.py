"""Tests for build_results.py (engagement tables from a dose export)."""

from pathlib import Path

import pandas as pd
import pytest

import build_results as br

REPO = Path(__file__).resolve().parents[2]
DOSE_V3 = REPO / "dose_analysis_export_v3.csv"
PUBLISHED = br.PUBLISHED_DIR  # filled by `build_results.py restore-published`


def _dose(rows):
    cols = [
        "participant_id", "intervention_start", "intervention_end", "intervention_days",
        "sessions_started", "sessions_completed", "days_active", "total_reviews",
        "new_cards_introduced", "reading_passages_completed", "listening_tracks_completed",
        "total_listening_time_minutes", "repeat_review_count",
    ]
    return pd.DataFrame(rows, columns=cols)


def _scores(pids, total, uos=None, reading=None, listening=None):
    n = len(pids)
    return pd.DataFrame({
        "participant": pids,
        "total_difference": total,
        "uos_difference": uos or [0] * n,
        "reading_difference": reading or [0] * n,
        "listening_difference": listening or [0] * n,
    })


@pytest.fixture
def small_dose():
    return _dose([
        ["P001", "2026-04-01", "2026-04-10", 10, 8, 1, 8, 100, 20, 2, 3, 1.26, 80],
        ["P002", "2026-04-01", "2026-04-05", 5, 3, 2, 3, 40, 10, 1, 0, 0.0, 30],
        ["P003", "2026-04-01", "2026-04-20", 20, 0, 0, 0, 0, 1, 0, 0, 0.0, 0],
        ["P004", "2026-04-01", "2026-04-10", 10, 4, 4, 4, 60, 15, 4, 4, 2.0, 45],
        ["P009", "2026-04-01", "2026-04-10", 10, 9, 9, 9, 90, 9, 9, 9, 9.0, 81],  # no scores
    ])


def test_profile_transformations(small_dose):
    scores = _scores(["P001", "P002", "P003", "P004"], [5, 6, 7, 8])
    profile = br.build_engagement_profile(small_dose, scores)
    assert list(profile.columns) == br.PROFILE_COLUMNS
    # Only participants with outcome scores, in the scores order.
    assert profile["participant"].tolist() == ["P001", "P002", "P003", "P004"]
    assert profile["intervention_window_days"].tolist() == [10, 5, 20, 10]
    # 1/8 = 12.5 -> 13 (half up), 2/3 -> 67, nothing started -> 0, 4/4 -> 100
    assert profile["completion_percent"].tolist() == [13, 67, 0, 100]
    # Formatted to one decimal place.
    assert profile["total_listening_time_minutes"].tolist() == ["1.3", "0.0", "0.0", "2.0"]


def test_profile_can_use_an_alternative_completed_column(small_dose):
    dose = small_dose.assign(sessions_completed_raw_flag=[0, 0, 0, 2, 0])
    scores = _scores(["P001", "P004"], [1, 2])
    profile = br.build_engagement_profile(dose, scores, "sessions_completed_raw_flag")
    assert profile["sessions_completed"].tolist() == [0, 2]
    assert profile["completion_percent"].tolist() == [0, 50]


def test_associations_use_rates_per_intervention_day_and_report_exclusions(small_dose):
    scores = _scores(
        ["P001", "P002", "P003", "P004"], [5, 6, 7, 8],
        uos=[1, 3, 2, 4], reading=[2, 1, 3, 4], listening=[4, 3, 2, 1],
    )
    published, detail = br.build_associations(small_dose, scores, exclude=["P003"])
    assert list(published.columns) == ["engagement_measure", "outcome_change", "rho", "p"]
    assert published["engagement_measure"].tolist() == [a[0] for a in br.ASSOCIATIONS]
    assert set(detail["n"]) == {3}
    assert set(detail["excluded"]) == {"P003"}
    assert detail["participants"].iloc[0] == "P001; P002; P004"
    # Active-day rates 0.8, 0.6, 0.4 against gains 5, 6, 8: perfectly inverse.
    active = detail.set_index("engagement_measure").loc["Active-day rate"]
    assert active["rho"] == pytest.approx(-1.0)
    assert published.iloc[0]["rho"] == "-1.00"


def _sql_result(dose):
    """SQL-export-like CSV: new completion counts, and best-effort columns
    that differ from the reference for reasons unrelated to completion."""
    return dose.assign(
        sessions_completed=[8, 2, 0, 4, 9],
        sessions_completed_raw_flag=[0, 1, 0, 4, 9],
        days_active=dose["days_active"] - 1,
        new_cards_introduced=dose["new_cards_introduced"] + 5,
        reading_passages_completed=[0, 0, 0, 0, 0],
        listening_tracks_completed=[1, 1, 1, 1, 1],
    )


ASSOC_SCORES = dict(
    pids=["P001", "P002", "P003", "P004"], total=[5, 6, 7, 8],
    uos=[1, 3, 2, 4], reading=[2, 1, 3, 4], listening=[4, 3, 2, 1],
)


def _changed_profile_columns(a, b):
    return {c for c in a.columns if not a[c].equals(b[c])}


def _changed_association_rows(a, b):
    return set(a.loc[(a[["rho", "p"]] != b[["rho", "p"]]).any(axis=1), "engagement_measure"])


def test_splice_completed_changes_only_completion_outputs(small_dose):
    scores = _scores(**ASSOC_SCORES)
    sql = _sql_result(small_dose)
    spliced = br.splice_completed(small_dose, sql)
    assert spliced["sessions_completed"].tolist() == [8, 2, 0, 4, 9]
    other = [c for c in small_dose.columns if c != "sessions_completed"]
    pd.testing.assert_frame_equal(spliced[other], small_dose[other])

    ref_profile = br.build_engagement_profile(small_dose, scores)
    ref_assoc, _ = br.build_associations(small_dose, scores, exclude=["P003"])
    new_profile = br.build_engagement_profile(spliced, scores)
    new_assoc, _ = br.build_associations(spliced, scores, exclude=["P003"])
    assert _changed_profile_columns(ref_profile, new_profile) == {
        "sessions_completed", "completion_percent",
    }
    assert _changed_association_rows(ref_assoc, new_assoc) == {"Completed-loop rate"}

    # Rebuilding from the whole SQL CSV instead would also move unrelated cells.
    whole = br.build_engagement_profile(sql, scores)
    assert {"days_active", "new_cards_introduced"} <= _changed_profile_columns(ref_profile, whole)


def test_splice_completed_requires_every_participant(small_dose):
    sql = _sql_result(small_dose).iloc[:-1]
    with pytest.raises(ValueError, match="P009"):
        br.splice_completed(small_dose, sql)
    with pytest.raises(ValueError, match="no_such_column"):
        br.splice_completed(small_dose, _sql_result(small_dose), "no_such_column")


def test_build_completed_from_cli_changes_only_completion_cells(small_dose, tmp_path):
    dose_csv, sql_csv, scores_csv = tmp_path / "dose.csv", tmp_path / "sql.csv", tmp_path / "s.csv"
    small_dose.to_csv(dose_csv, index=False)
    _sql_result(small_dose).to_csv(sql_csv, index=False)
    _scores(**ASSOC_SCORES).to_csv(scores_csv, index=False)
    common = ["--scores", str(scores_csv), "--exclude", "P003"]

    assert br.main(["build", str(dose_csv), *common, "--out-dir", str(tmp_path / "ref")]) == 0
    status = br.main([
        "build", str(dose_csv), *common, "--out-dir", str(tmp_path / "new"),
        "--completed-from", str(sql_csv), "--completed-column", "sessions_completed_raw_flag",
        "--compare-dir", str(tmp_path / "ref"),
    ])
    assert status == 1  # differs from the reference tables, as intended

    def diffs(name):
        return br.compare_csv_text(
            (tmp_path / "new" / name).read_text(), (tmp_path / "ref" / name).read_text()
        )

    profile_diffs = diffs("engagement_profile.csv")
    assert profile_diffs and all(
        ", sessions_completed:" in d or ", completion_percent:" in d for d in profile_diffs
    )
    assoc_diffs = diffs("engagement_outcome_associations.csv")
    assert assoc_diffs and all("(Completed-loop rate)" in d for d in assoc_diffs)

    detail = pd.read_csv(tmp_path / "new" / "engagement_outcome_associations_detail.csv")
    loop = detail.set_index("engagement_measure").loc["Completed-loop rate", "rate_definition"]
    assert loop == "sessions_completed_raw_flag from sql.csv / intervention_days"

    with pytest.raises(SystemExit):
        br.main(["build", str(dose_csv), "--completed-column", "sessions_completed_raw_flag"])


def test_missing_dose_row_for_scored_participant_is_an_error(small_dose):
    with pytest.raises(ValueError, match="P077"):
        br.build_engagement_profile(small_dose, _scores(["P001", "P077"], [1, 2]))


def test_compare_csv_text_reports_cell_differences():
    published = "participant,a,b\nP1,1,2\nP2,3,4\n"
    assert br.compare_csv_text(published, published) == []
    diffs = br.compare_csv_text("participant,a,b\nP1,1,2\nP2,3,5\n", published)
    assert diffs == ["row 2 (P2), b: generated=5 published=4"]


def test_emit_sql_fills_the_windows_block(small_dose):
    sql = br.emit_sql(small_dose)
    assert ", ('P001', DATE '2026-04-01', DATE '2026-04-10')" in sql
    assert ", ('P009', DATE '2026-04-01', DATE '2026-04-10')" in sql
    assert "-- , ('P000'" not in sql  # placeholder replaced
    assert sql.count("-- BEGIN WINDOWS") == 1 and sql.count("-- END WINDOWS") == 1


def test_sql_is_a_single_read_only_select():
    sql = br.SQL_TEMPLATE.read_text(encoding="utf-8")
    code = "\n".join(line.split("--", 1)[0] for line in sql.splitlines()).upper()
    for keyword in ("INSERT ", "UPDATE ", "DELETE ", "DROP ", "ALTER ", "CREATE ", "TRUNCATE ", "GRANT "):
        assert keyword not in code, keyword
    assert code.strip().startswith("WITH")
    assert code.strip().endswith(";") and code.count(";") == 1


def test_diff_dose_identifies_completion_definition():
    reference = pd.DataFrame({
        "participant_id": ["P1", "P2"],
        "sessions_completed": [1, 0],
        "total_listening_time_minutes": ["1.0", "0.0"],
        "placement_last_attempt_date": ["NULL", "2026-04-01"],
    })
    new = pd.DataFrame({
        "participant_id": ["P1", "P2"],
        "sessions_completed": [3, 1],
        "sessions_completed_raw_flag": [1, 0],
        "sessions_completed_at_present": [2, 0],
        "total_listening_time_minutes": [1, 0],
        "placement_last_attempt_date": [None, "2026-04-01"],
    })
    lines = br.diff_dose(new, reference)
    assert "P1 sessions_completed: new='3' reference='1'" in lines
    assert not any("listening" in l or "placement" in l for l in lines)  # 1 == 1.0, NULL == None
    assert any("raw completed flag" in l and l.endswith(": 2") for l in lines)
    assert any("loop_completed" in l and l.endswith(": 0") for l in lines)


@pytest.mark.skipif(
    not DOSE_V3.exists() or not (PUBLISHED / "engagement_profile.csv").exists(),
    reason="needs local-only dose_analysis_export_v3.csv and `build_results.py restore-published`",
)
def test_reproduces_published_engagement_tables_exactly(tmp_path):
    status = br.main([
        "build", str(DOSE_V3),
        "--out-dir", str(tmp_path),
        "--compare-dir", str(PUBLISHED),
    ])
    assert status == 0
    for name in ("engagement_profile.csv", "engagement_outcome_associations.csv"):
        assert (tmp_path / name).read_bytes() == (PUBLISHED / name).read_bytes(), name
    detail = pd.read_csv(tmp_path / "engagement_outcome_associations_detail.csv")
    assert set(detail["n"]) == {9}
    assert set(detail["excluded"]) == {"P083"}
