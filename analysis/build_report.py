#!/usr/bin/env python3
"""
Dissertation evaluation report builder.

Consumes the JSON export from /api/progress/export and produces:
  - Dissertation-ready figures in analysis/figures/
  - Summary tables in analysis/output/
  - A text summary report in analysis/output/summary.md

Usage:
    python analysis/build_report.py <path-to-export.json>

All outputs are deterministic and reproducible given the same input file.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")  # Non-interactive backend for reproducibility
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import pandas as pd

from load_export import ExportBundle, load_bundle, validate_bundle

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
FIGURES_DIR = SCRIPT_DIR / "figures"
OUTPUT_DIR = SCRIPT_DIR / "output"

FIGURE_DPI = 150
FIGURE_SIZE = (10, 4.5)
FIGURE_SIZE_WIDE = (12, 5)

# Matplotlib academic style
plt.rcParams.update({
    "figure.dpi": FIGURE_DPI,
    "figure.figsize": FIGURE_SIZE,
    "axes.titlesize": 13,
    "axes.labelsize": 11,
    "xtick.labelsize": 9,
    "ytick.labelsize": 9,
    "legend.fontsize": 9,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.3,
    "grid.linewidth": 0.5,
    "lines.linewidth": 1.5,
    "lines.markersize": 4,
    "font.family": "serif",
})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python build_report.py <path-to-export.json>")
        sys.exit(1)

    export_path = Path(sys.argv[1])
    bundle = load_bundle(export_path)

    # Validate
    errors = validate_bundle(bundle)
    if errors:
        print("Export validation FAILED. Cannot proceed.")
        for err in errors:
            print(f"  - {err}")
        sys.exit(1)

    if bundle.is_cohort:
        print(
            f"Loaded cohort export: {bundle.meta.get('cohort_key', 'unknown')} "
            f"({bundle.participant_count} participants), "
            f"{bundle.date_range[0]} to {bundle.date_range[1]}"
        )
    else:
        print(f"Loaded export: {bundle.date_range[0]} to {bundle.date_range[1]}")

    # Ensure output directories
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    da = bundle.daily_aggregates.copy()
    if da.empty:
        print("No daily aggregate data. Generating empty summary only.")
        _write_summary(bundle, da, [])
        return

    # For cohort exports, aggregate per-date across participants so that the
    # existing plotting functions work without modification.
    if bundle.is_cohort and "anonymous_user_id" in da.columns:
        # Save per-participant data for CSV export
        _write_per_participant_table(da)
        da = _aggregate_cohort_daily(da)

    # Convert session_date to proper datetime for plotting
    da["date"] = pd.to_datetime(da["session_date"])

    warnings: list[str] = []

    # Generate all figures
    _plot_sessions_started_vs_completed(da)
    _plot_session_completion_rate(da)
    _plot_flashcard_accuracy(da)
    _plot_new_card_attempts(da)
    _plot_review_card_attempts(da)
    _plot_total_attempts(da)
    _plot_retry_attempts(da)
    _plot_logged_active_time(da)
    _plot_reading_completions(da)
    _plot_listening_completions(da)
    _plot_saved_words(da)
    _plot_days_active_rolling(da)
    _plot_stage_completion(bundle)
    _plot_review_correctness_proxy(da)

    # Generate tables
    _write_summary_metrics_table(bundle, da)
    _write_daily_aggregates_table(da)
    _write_metric_definitions_table(bundle)

    # Data quality warnings
    warnings.extend(_check_data_quality(bundle, da))

    # Summary report
    _write_summary(bundle, da, warnings)

    # Chapter support summary with actual values filled in
    _write_chapter_support_summary(bundle, da, warnings)

    print(f"\nDone. Figures saved to {FIGURES_DIR}/")
    print(f"Tables and summary saved to {OUTPUT_DIR}/")


# ---------------------------------------------------------------------------
# Cohort aggregation helpers
# ---------------------------------------------------------------------------

def _aggregate_cohort_daily(da: pd.DataFrame) -> pd.DataFrame:
    """Aggregate per-participant daily rows into cohort-level daily totals.

    Sum-able columns are summed; rate columns are recomputed from the
    aggregated numerators/denominators.
    """
    sum_cols = [
        "session_started",
        "session_completed",
        "assigned_flashcard_count",
        "assigned_new_words_count",
        "assigned_review_cards_count",
        "flashcard_completed_count",
        "flashcard_new_completed_count",
        "flashcard_review_completed_count",
        "flashcard_attempts_count",
        "flashcard_retry_count",
        "reader_saved_words_count",
        "reading_completed",
        "listening_completed",
        "reading_time_seconds",
        "listening_time_seconds",
        "flashcard_time_seconds",
        "total_time_seconds",
        "workload_assigned_units",
        "workload_completed_units",
    ]
    # Only include columns that exist
    available_sum = [c for c in sum_cols if c in da.columns]

    # Convert booleans to int for summing
    for col in available_sum:
        if da[col].dtype == bool:
            da[col] = da[col].astype(int)

    agg = da.groupby("session_date", as_index=False)[available_sum].sum()

    # Recompute rate columns from totals
    agg["flashcard_accuracy"] = agg.apply(
        lambda r: None if r["flashcard_attempts_count"] == 0 else None, axis=1
    )
    # We need correct counts — not available after aggregation, so use a
    # weighted average from the per-participant data
    correct_by_date = (
        da.assign(
            _correct=da["flashcard_accuracy"].fillna(0) * da["flashcard_attempts_count"]
        )
        .groupby("session_date")["_correct"]
        .sum()
    )
    agg = agg.set_index("session_date")
    agg["flashcard_accuracy"] = (
        correct_by_date / agg["flashcard_attempts_count"].replace(0, float("nan"))
    )
    agg["review_correctness_proxy"] = None  # Cannot recompute without raw review events
    agg["days_active_flag"] = (
        (agg["flashcard_attempts_count"] > 0)
        | (agg["reader_saved_words_count"] > 0)
        | (agg["reading_completed"] > 0)
        | (agg["listening_completed"] > 0)
    )
    agg["workload_completion_rate"] = (
        agg["workload_completed_units"] / agg["workload_assigned_units"].replace(0, float("nan"))
    )

    return agg.reset_index()


def _write_per_participant_table(da: pd.DataFrame) -> None:
    """Write a per-participant summary CSV for cohort exports."""
    if "anonymous_user_id" not in da.columns:
        return

    summary_rows = []
    for pid, group in da.groupby("anonymous_user_id"):
        active_days = group[
            (group.get("flashcard_attempts_count", 0) > 0)
            | (group.get("reader_saved_words_count", 0) > 0)
            | (group.get("reading_completed", False).astype(bool))
            | (group.get("listening_completed", False).astype(bool))
        ]
        summary_rows.append({
            "participant_id": pid,
            "total_days": len(group),
            "active_days": len(active_days),
            "total_sessions_started": int(group["session_started"].sum()),
            "total_sessions_completed": int(group["session_completed"].sum()),
            "total_flashcard_attempts": int(group["flashcard_attempts_count"].sum()),
            "total_time_seconds": int(group["total_time_seconds"].sum()),
            "total_reader_saved_words": int(group["reader_saved_words_count"].sum()),
        })

    pd.DataFrame(summary_rows).to_csv(
        OUTPUT_DIR / "per_participant_summary.csv", index=False
    )
    print("  Wrote per_participant_summary.csv")


# ---------------------------------------------------------------------------
# Plotting functions
# ---------------------------------------------------------------------------

def _plot_sessions_started_vs_completed(da: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    ax.bar(
        da["date"], da["session_started"].astype(int),
        label="Sessions with recorded start", alpha=0.7, color="#4A90D9",
    )
    ax.bar(
        da["date"], da["session_completed"].astype(int),
        label="Sessions completed", alpha=0.9, color="#2E5A88",
    )
    ax.set_title("Daily sessions: started vs. completed")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Count (0 or 1 per day)")
    ax.legend()
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "sessions_started_vs_completed.png")
    plt.close(fig)


def _plot_session_completion_rate(da: pd.DataFrame) -> None:
    started = da[da["session_started"]].copy()
    if started.empty:
        return
    # Cumulative completion rate
    started = started.sort_values("date")
    started["cum_started"] = range(1, len(started) + 1)
    started["cum_completed"] = started["session_completed"].astype(int).cumsum()
    started["cum_rate"] = started["cum_completed"] / started["cum_started"]

    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    ax.plot(started["date"], started["cum_rate"], marker="o", color="#2E5A88")
    ax.set_title("Cumulative session completion rate (started sessions only)")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Completion rate")
    ax.set_ylim(-0.05, 1.05)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y:.0%}"))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "session_completion_rate.png")
    plt.close(fig)


def _plot_flashcard_accuracy(da: pd.DataFrame) -> None:
    with_attempts = da[da["flashcard_attempts_count"] > 0].copy()
    if with_attempts.empty:
        return
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    ax.plot(
        with_attempts["date"], with_attempts["flashcard_accuracy"],
        marker="o", color="#D4763A", label="All-queue accuracy",
    )
    if "review_correctness_proxy" in with_attempts.columns:
        has_reviews = with_attempts[with_attempts["review_correctness_proxy"].notna()]
        if not has_reviews.empty:
            ax.plot(
                has_reviews["date"], has_reviews["review_correctness_proxy"],
                marker="s", color="#8B4513", linestyle="--",
                label="Review-card correctness (retention proxy)",
            )
    ax.set_title("Flashcard attempt accuracy over time")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Accuracy")
    ax.set_ylim(-0.05, 1.05)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y:.0%}"))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    ax.legend()
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "flashcard_accuracy.png")
    plt.close(fig)


def _plot_new_card_attempts(da: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    ax.bar(da["date"], da["flashcard_new_completed_count"], color="#5B9BD5", alpha=0.8)
    ax.set_title("New-card main-queue attempts per day")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Attempts")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "new_card_attempts.png")
    plt.close(fig)


def _plot_review_card_attempts(da: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    ax.bar(da["date"], da["flashcard_review_completed_count"], color="#70AD47", alpha=0.8)
    ax.set_title("Review-card main-queue attempts per day")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Attempts")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "review_card_attempts.png")
    plt.close(fig)


def _plot_total_attempts(da: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    ax.bar(
        da["date"], da["flashcard_attempts_count"],
        color="#4A90D9", alpha=0.7, label="Total attempts (all queues)",
    )
    ax.bar(
        da["date"], da["flashcard_retry_count"],
        color="#E06040", alpha=0.9, label="Retry-queue attempts",
    )
    ax.set_title("Total flashcard attempts per day")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Attempts")
    ax.legend()
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "total_attempts.png")
    plt.close(fig)


def _plot_retry_attempts(da: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    ax.bar(da["date"], da["flashcard_retry_count"], color="#E06040", alpha=0.8)
    ax.set_title("Retry-queue attempts per day")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Retry attempts")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "retry_attempts.png")
    plt.close(fig)


def _plot_logged_active_time(da: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    minutes = da["total_time_seconds"] / 60.0
    ax.bar(da["date"], da["flashcard_time_seconds"] / 60.0,
           color="#4A90D9", alpha=0.7, label="Flashcard time")
    ax.bar(da["date"], da["reading_time_seconds"] / 60.0,
           bottom=da["flashcard_time_seconds"] / 60.0,
           color="#70AD47", alpha=0.7, label="Reading time")
    ax.bar(da["date"], da["listening_time_seconds"] / 60.0,
           bottom=(da["flashcard_time_seconds"] + da["reading_time_seconds"]) / 60.0,
           color="#ED7D31", alpha=0.7, label="Listening time")
    ax.set_title("Logged active time per day (stacked by modality)")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Minutes")
    ax.legend()
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "logged_active_time.png")
    plt.close(fig)


def _plot_reading_completions(da: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    ax.bar(da["date"], da["reading_completed"].astype(int), color="#70AD47", alpha=0.8)
    ax.set_title("Reading stage completions per day")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Completed (0 or 1)")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "reading_completions.png")
    plt.close(fig)


def _plot_listening_completions(da: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    ax.bar(da["date"], da["listening_completed"].astype(int), color="#ED7D31", alpha=0.8)
    ax.set_title("Listening stage completions per day")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Completed (0 or 1)")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "listening_completions.png")
    plt.close(fig)


def _plot_saved_words(da: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    ax.bar(da["date"], da["reader_saved_words_count"], color="#9B59B6", alpha=0.8)
    ax.set_title("Reader-saved words per day")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Words saved")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "saved_words.png")
    plt.close(fig)


def _plot_days_active_rolling(da: pd.DataFrame) -> None:
    da_sorted = da.sort_values("date").copy()
    # 7-day rolling count of active days
    da_sorted["active_int"] = da_sorted["days_active_flag"].astype(int)
    da_sorted["rolling_7d_active"] = (
        da_sorted["active_int"].rolling(window=7, min_periods=1).sum()
    )
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    ax.plot(da_sorted["date"], da_sorted["rolling_7d_active"],
            marker="o", color="#2E5A88")
    ax.set_title("Days with recorded activity (7-day rolling window)")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Active days in prior 7-day window")
    ax.set_ylim(-0.5, 7.5)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "days_active_rolling.png")
    plt.close(fig)


def _plot_stage_completion(bundle: ExportBundle) -> None:
    summary = bundle.summary
    stage_totals = summary.get("stage_totals", {})
    if not stage_totals:
        return

    stages = ["Started", "Flashcards\ncompleted", "Reading\ncompleted",
              "Listening\ncompleted", "Session\ncompleted"]
    counts = [
        stage_totals.get("started", 0),
        stage_totals.get("flashcards_completed", 0),
        stage_totals.get("reading_completed", 0),
        stage_totals.get("listening_completed", 0),
        stage_totals.get("completed", 0),
    ]

    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    colors = ["#4A90D9", "#5B9BD5", "#70AD47", "#ED7D31", "#2E5A88"]
    bars = ax.bar(stages, counts, color=colors, alpha=0.85)
    for bar, count in zip(bars, counts):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.1,
                str(count), ha="center", va="bottom", fontsize=10)
    ax.set_title("Sessions reaching each stage milestone")
    ax.set_ylabel("Sessions")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "stage_completion.png")
    plt.close(fig)


def _plot_review_correctness_proxy(da: pd.DataFrame) -> None:
    if "review_correctness_proxy" not in da.columns:
        return
    has_data = da[da["review_correctness_proxy"].notna()].copy()
    if has_data.empty:
        return
    fig, ax = plt.subplots(figsize=FIGURE_SIZE)
    ax.plot(has_data["date"], has_data["review_correctness_proxy"],
            marker="o", color="#8B4513")
    ax.set_title("Review-card correctness over time (retention proxy)")
    ax.set_xlabel("Session date")
    ax.set_ylabel("Correctness rate")
    ax.set_ylim(-0.05, 1.05)
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda y, _: f"{y:.0%}"))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.autofmt_xdate(rotation=45)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "review_correctness_proxy.png")
    plt.close(fig)


# ---------------------------------------------------------------------------
# Table generation
# ---------------------------------------------------------------------------

def _write_summary_metrics_table(bundle: ExportBundle, da: pd.DataFrame) -> None:
    """Write a summary metrics table as both CSV and Markdown."""
    s = bundle.summary
    rp = s.get("review_retention_proxy", {})

    total_started = s.get("total_sessions_started", 0)
    total_completed = s.get("total_sessions_completed", 0)
    completion_rate = s.get("daily_session_completion_rate")
    accuracy = s.get("flashcard_accuracy")

    rows = [
        ("Date range", f"{bundle.date_range[0]} to {bundle.date_range[1]}"),
        ("Sessions with recorded start", str(total_started)),
        ("Sessions completed", str(total_completed)),
        ("Session completion rate", _fmt_pct(completion_rate)),
        ("Days with recorded activity", str(s.get("days_active", 0))),
        ("Total flashcard attempts", str(s.get("total_flashcard_attempts", 0))),
        ("Total retry-queue attempts", str(s.get("total_flashcard_retries", 0))),
        ("Flashcard attempt accuracy (all queues)", _fmt_pct(accuracy)),
        ("Review-card correctness (retention proxy)", _fmt_pct(rp.get("review_accuracy"))),
        ("Mean inter-review interval (hours)", _fmt_num(rp.get("average_delta_hours"))),
        ("Total reader-saved words", str(s.get("total_reader_saved_words", 0))),
        ("Total reading stage completions", str(s.get("total_reading_completions", 0))),
        ("Total listening stage completions", str(s.get("total_listening_completions", 0))),
        ("Total logged active time (minutes)", _fmt_num(s.get("total_time_seconds", 0) / 60.0 if s.get("total_time_seconds") else None)),
    ]

    # CSV
    csv_lines = ["metric,value"]
    for label, value in rows:
        csv_lines.append(f'"{label}","{value}"')
    (OUTPUT_DIR / "summary_metrics.csv").write_text("\n".join(csv_lines), encoding="utf-8")

    # Markdown
    md_lines = ["| Metric | Value |", "|---|---|"]
    for label, value in rows:
        md_lines.append(f"| {label} | {value} |")
    (OUTPUT_DIR / "summary_metrics.md").write_text("\n".join(md_lines), encoding="utf-8")


def _write_daily_aggregates_table(da: pd.DataFrame) -> None:
    """Write the daily aggregates as a CSV for appendix use."""
    export_cols = [
        "session_date", "session_started", "session_completed",
        "assigned_flashcard_count", "flashcard_completed_count",
        "flashcard_new_completed_count", "flashcard_review_completed_count",
        "flashcard_attempts_count", "flashcard_retry_count",
        "flashcard_accuracy", "review_correctness_proxy",
        "reader_saved_words_count", "reading_completed", "listening_completed",
        "reading_time_seconds", "listening_time_seconds",
        "flashcard_time_seconds", "total_time_seconds",
    ]
    available = [c for c in export_cols if c in da.columns]
    da[available].to_csv(OUTPUT_DIR / "daily_aggregates.csv", index=False)


def _write_metric_definitions_table(bundle: ExportBundle) -> None:
    """Write a data dictionary table of metric definitions for appendix use."""
    defs = bundle.metric_definitions
    if not defs:
        return

    md_lines = [
        "| ID | Label | Description | Limitations |",
        "|---|---|---|---|",
    ]
    for metric_id, defn in sorted(defs.items()):
        label = defn.get("label", metric_id)
        desc = defn.get("description", "").replace("|", "\\|").replace("\n", " ")
        limits = (defn.get("limitations") or "None noted").replace("|", "\\|").replace("\n", " ")
        md_lines.append(f"| {metric_id} | {label} | {desc} | {limits} |")

    (OUTPUT_DIR / "metric_definitions.md").write_text("\n".join(md_lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# Data quality checks
# ---------------------------------------------------------------------------

def _check_data_quality(bundle: ExportBundle, da: pd.DataFrame) -> list[str]:
    warnings: list[str] = []

    # Check for days with attempts > assigned
    if not da.empty:
        over = da[da["flashcard_completed_count"] > da["assigned_flashcard_count"]]
        if not over.empty:
            warnings.append(
                f"{len(over)} day(s) where flashcard_completed_count > assigned_flashcard_count."
            )

    # Check for missing queue_kind on review events
    if not bundle.review_events.empty:
        missing_kind = bundle.review_events["queue_kind"].isna().sum()
        if missing_kind > 0:
            warnings.append(
                f"{missing_kind} review event(s) with missing queue_kind (pre-instrumentation rows)."
            )

    # Check for missing session links
    if not bundle.review_events.empty and "daily_session_id" in bundle.review_events.columns:
        missing_session = bundle.review_events["daily_session_id"].isna().sum()
        if missing_session > 0:
            warnings.append(
                f"{missing_session} review event(s) without a linked daily_session_id."
            )

    return warnings


# ---------------------------------------------------------------------------
# Summary report
# ---------------------------------------------------------------------------

def _write_summary(bundle: ExportBundle, da: pd.DataFrame, warnings: list[str]) -> None:
    s = bundle.summary
    rp = s.get("review_retention_proxy", {})

    lines = [
        "# Evaluation Summary Report",
        "",
        f"Generated from export: {bundle.meta.get('exported_at', 'unknown')}",
        f"Anonymous user ID: {bundle.anonymous_user_id}",
        f"Date range analysed: {bundle.date_range[0]} to {bundle.date_range[1]}",
        f"App session time zone: {bundle.meta.get('app_session_time_zone', 'unknown')}",
        f"Export format version: {bundle.meta.get('format_version', 'unknown')}",
        "",
        "## Key metrics",
        "",
        f"- Sessions with recorded start: {s.get('total_sessions_started', 0)}",
        f"- Sessions completed: {s.get('total_sessions_completed', 0)}",
        f"- Session completion rate: {_fmt_pct(s.get('daily_session_completion_rate'))}",
        f"- Days with recorded activity: {s.get('days_active', 0)}",
        f"- Total flashcard attempts: {s.get('total_flashcard_attempts', 0)}",
        f"- Total retry-queue attempts: {s.get('total_flashcard_retries', 0)}",
        f"- Flashcard attempt accuracy (all queues): {_fmt_pct(s.get('flashcard_accuracy'))}",
        f"- Review-card correctness (retention proxy): {_fmt_pct(rp.get('review_accuracy'))}",
        f"- Mean inter-review interval: {_fmt_num(rp.get('average_delta_hours'))} hours",
        f"- Total reader-saved words: {s.get('total_reader_saved_words', 0)}",
        f"- Total reading stage completions: {s.get('total_reading_completions', 0)}",
        f"- Total listening stage completions: {s.get('total_listening_completions', 0)}",
        f"- Total logged active time: {_fmt_num(s.get('total_time_seconds', 0) / 60.0 if s.get('total_time_seconds') else None)} minutes",
        "",
        "## Proxy and measurement notes",
        "",
        '- "Review-card correctness" is a behavioural proxy for retention derived from in-app review accuracy. It is not a direct measure of learning outcomes or long-term retention.',
        '- "Logged active time" sums submitted-attempt time, client-recorded reading time, and client-recorded listening time. It excludes idle time, navigation, and abandoned views.',
        '- "Flashcard attempt accuracy" includes both main-queue and retry-queue attempts in the denominator.',
        '- Reading and listening completions are binary flags per session, not measures of comprehension.',
        "",
    ]

    if warnings:
        lines.append("## Data quality warnings")
        lines.append("")
        for w in warnings:
            lines.append(f"- {w}")
        lines.append("")
    else:
        lines.append("## Data quality")
        lines.append("")
        lines.append("No data quality warnings detected.")
        lines.append("")

    stage_totals = s.get("stage_totals", {})
    stage_drop = s.get("stage_drop_off", {})
    if stage_totals:
        lines.append("## Stage progression")
        lines.append("")
        lines.append(f"- Started: {stage_totals.get('started', 0)}")
        lines.append(f"- Flashcards completed: {stage_totals.get('flashcards_completed', 0)}")
        lines.append(f"- Reading completed: {stage_totals.get('reading_completed', 0)}")
        lines.append(f"- Listening completed: {stage_totals.get('listening_completed', 0)}")
        lines.append(f"- Fully completed: {stage_totals.get('completed', 0)}")
        lines.append("")
        if stage_drop:
            lines.append("Drop-off between stages:")
            lines.append(f"- Before flashcards complete: {stage_drop.get('before_flashcards_complete', 0)}")
            lines.append(f"- Before reading complete: {stage_drop.get('before_reading_complete', 0)}")
            lines.append(f"- Before listening complete: {stage_drop.get('before_listening_complete', 0)}")
            lines.append("")

    lines.append("## Generated outputs")
    lines.append("")
    lines.append("### Figures (analysis/figures/)")
    lines.append("")
    lines.append("- sessions_started_vs_completed.png")
    lines.append("- session_completion_rate.png")
    lines.append("- flashcard_accuracy.png")
    lines.append("- new_card_attempts.png")
    lines.append("- review_card_attempts.png")
    lines.append("- total_attempts.png")
    lines.append("- retry_attempts.png")
    lines.append("- logged_active_time.png")
    lines.append("- reading_completions.png")
    lines.append("- listening_completions.png")
    lines.append("- saved_words.png")
    lines.append("- days_active_rolling.png")
    lines.append("- stage_completion.png")
    lines.append("- review_correctness_proxy.png")
    lines.append("")
    lines.append("### Tables (analysis/output/)")
    lines.append("")
    lines.append("- summary_metrics.csv / summary_metrics.md")
    lines.append("- daily_aggregates.csv")
    lines.append("- metric_definitions.md")
    lines.append("")

    (OUTPUT_DIR / "summary.md").write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# Chapter support summary
# ---------------------------------------------------------------------------

def _write_chapter_support_summary(
    bundle: ExportBundle, da: pd.DataFrame, warnings: list[str]
) -> None:
    """
    Write a lightly templated chapter support file that fills in actual
    metric values from the export, leaving only figure/table numbers as
    placeholders.  This sits between the raw summary.md and the full
    results scaffold in docs/.
    """
    s = bundle.summary
    rp = s.get("review_retention_proxy", {})
    st = s.get("stage_totals", {})
    sd = s.get("stage_drop_off", {})

    date_from, date_to = bundle.date_range
    n_days = len(da)
    n_started = s.get("total_sessions_started", 0)
    n_completed = s.get("total_sessions_completed", 0)
    completion_rate = _fmt_pct(s.get("daily_session_completion_rate"))
    n_active = s.get("days_active", 0)
    total_attempts = s.get("total_flashcard_attempts", 0)
    total_retries = s.get("total_flashcard_retries", 0)
    accuracy = _fmt_pct(s.get("flashcard_accuracy"))
    review_correctness = _fmt_pct(rp.get("review_accuracy"))
    mean_delta = _fmt_num(rp.get("average_delta_hours"))
    total_saved = s.get("total_reader_saved_words", 0)
    total_reading = s.get("total_reading_completions", 0)
    total_listening = s.get("total_listening_completions", 0)
    total_time_s = s.get("total_time_seconds", 0) or 0
    total_time_min = _fmt_num(total_time_s / 60.0)

    # Per-modality time from daily aggregates
    fc_time_min = _fmt_num(da["flashcard_time_seconds"].sum() / 60.0) if not da.empty else "N/A"
    rd_time_min = _fmt_num(da["reading_time_seconds"].sum() / 60.0) if not da.empty else "N/A"
    ls_time_min = _fmt_num(da["listening_time_seconds"].sum() / 60.0) if not da.empty else "N/A"

    # Active-day averages
    active_days = da[da["days_active_flag"]].copy() if not da.empty else pd.DataFrame()
    n_active_days = len(active_days)
    avg_time = _fmt_num(active_days["total_time_seconds"].mean() / 60.0) if n_active_days > 0 else "N/A"
    avg_saved = _fmt_num(active_days["reader_saved_words_count"].mean()) if n_active_days > 0 else "N/A"

    # Reading/listening days
    n_reading_days = int(da["reading_completed"].sum()) if not da.empty else 0
    n_listening_days = int(da["listening_completed"].sum()) if not da.empty else 0

    warn_section = ""
    if warnings:
        warn_lines = "\n".join(f"- {w}" for w in warnings)
        warn_section = f"""
## Data quality notes

The following data quality observations were detected during analysis:

{warn_lines}

These should be acknowledged in the evaluation.
"""
    else:
        warn_section = """
## Data quality notes

No data quality warnings were detected during analysis.
"""

    content = f"""# Chapter Support Summary

Auto-generated from the export bundle. Figure and table numbers are left as
`[FIGURE_N]` / `[TABLE_N]` placeholders — fill these in to match the
dissertation's numbering.

---

## Overview

The evaluation covers **{date_from}** to **{date_to}** ({n_days} calendar days).
During this period, {n_started} daily sessions were opened (had a recorded start)
and {n_completed} were completed through all assigned stages. The user was active
on {n_active} of {n_days} days.

## Session completion

- Sessions with recorded start: **{n_started}**
- Sessions completed: **{n_completed}**
- Session completion rate: **{completion_rate}**

Stage progression:
- Started: {st.get('started', 0)}
- Flashcards completed: {st.get('flashcards_completed', 0)}
- Reading completed: {st.get('reading_completed', 0)}
- Listening completed: {st.get('listening_completed', 0)}
- Fully completed: {st.get('completed', 0)}

Drop-off:
- Before flashcards complete: {sd.get('before_flashcards_complete', 0)}
- Before reading complete: {sd.get('before_reading_complete', 0)}
- Before listening complete: {sd.get('before_listening_complete', 0)}

## Flashcard performance

- Total flashcard attempts: **{total_attempts}**
- Total retry-queue attempts: **{total_retries}**
- Flashcard attempt accuracy (all queues): **{accuracy}**
- Review-card correctness (retention proxy): **{review_correctness}**
- Mean inter-review interval: **{mean_delta} hours**

## Reading and listening

- Reading stage completions: **{total_reading}** (on {n_reading_days} days)
- Listening stage completions: **{total_listening}** (on {n_listening_days} days)

## Saved words

- Total reader-saved words: **{total_saved}**
- Mean saved words per active day: **{avg_saved}**

## Logged active time

- Total: **{total_time_min} minutes**
- Flashcard time: {fc_time_min} minutes
- Reading time: {rd_time_min} minutes
- Listening time: {ls_time_min} minutes
- Mean per active day: **{avg_time} minutes**
{warn_section}
## Proxy and measurement reminders

- "Review-card correctness" is a behavioural proxy for retention, not a direct
  measure of learning outcomes.
- "Logged active time" is a lower bound on engagement time.
- Stage completions are binary flags, not comprehension measures.
- Saved-word counts reflect capture behaviour, not vocabulary acquisition.

---

*Generated by `analysis/build_report.py` from the export bundle.*
"""

    (OUTPUT_DIR / "chapter_support_summary.md").write_text(content.strip(), encoding="utf-8")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fmt_pct(value: float | None) -> str:
    if value is None or not isinstance(value, (int, float)):
        return "N/A"
    return f"{value * 100:.1f}%"


def _fmt_num(value: float | None) -> str:
    if value is None or not isinstance(value, (int, float)):
        return "N/A"
    return f"{value:.1f}"


if __name__ == "__main__":
    main()
