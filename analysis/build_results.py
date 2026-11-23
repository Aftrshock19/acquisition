#!/usr/bin/env python3
"""
Rebuild the engagement results tables from a dose analysis export.

engagement_profile.csv and engagement_outcome_associations.csv were published
in public/results/ without the code that produced them.  This script derives
both from a per-participant dose export (dose_analysis_export_v3.csv, or the
CSV produced by analysis/sql/dose_analysis_export.sql) plus the H1 outcome
scores in h1_participant_scores.csv.  Outputs go to analysis/output/
(gitignored), never to public/results/.

The per-participant tables were taken off the site after the study ended and
are no longer in the working tree.  `restore-published` copies all published
CSVs into analysis/data/published/ (gitignored), which is the default --scores
location and the directory to pass to --compare-dir.  Each file is taken from
--source-dir (default ~/acquisition-private, a private copy kept outside the
repo) when it is there, otherwise from git history (PUBLISHED_COMMIT).

Transformations (all reproduce the published v3-based files exactly):

  engagement_profile.csv
    - participants: those with H1 outcome scores (h1_participant_scores.csv),
      in that file's order
    - intervention_window_days = intervention_days (end - start + 1)
    - completion_percent = round_half_up(100 * sessions_completed /
      sessions_started), 0 when nothing was started
    - total_listening_time_minutes to 1 dp; other columns copied as integers

  engagement_outcome_associations.csv
    - same participants minus --exclude (default P083: engagement logs
      inconsistent with interview evidence of app use; see
      app/appendix/h2-sensitivity), so n = 9
    - each rate = count / intervention_days
    - Spearman rho (scipy.stats.spearmanr, average ranks for ties, two-sided
      t-approximation p), rho to 2 dp and p to 3 dp
    - n, the excluded participants and unrounded values go to
      engagement_outcome_associations_detail.csv

Correcting the completion definition: build the tables from the reference
dose file (v3) with only sessions_completed taken from the SQL export result,
via --completed-from.  Do not rebuild from the whole SQL CSV: its other
columns (days_active, new_cards_introduced, reading/listening completions)
are best-effort reconstructions that differ from v3 for reasons unrelated to
completion, and would silently change the other profile cells and
associations.  With --completed-from, only sessions_completed,
completion_percent and the Completed-loop association can change.

Usage:
    python analysis/build_results.py restore-published
    python analysis/build_results.py build <dose.csv> [--compare-dir analysis/data/published]
    python analysis/build_results.py build <dose.csv> --completed-from <sql_result.csv> \
        [--completed-column sessions_completed] [--compare-dir analysis/data/published]
    python analysis/build_results.py emit-sql <dose.csv>
    python analysis/build_results.py diff-dose <new_dose.csv> <reference_dose.csv>
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import pandas as pd
from scipy.stats import spearmanr

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_DIR = SCRIPT_DIR.parent
OUTPUT_DIR = SCRIPT_DIR / "output"
PUBLISHED_DIR = SCRIPT_DIR / "data" / "published"
# Private copy of the per-participant CSVs, outside the repo. First source for
# restore-published; git history is the fallback.
PRIVATE_DIR = Path.home() / "acquisition-private"
SQL_TEMPLATE = SCRIPT_DIR / "sql" / "dose_analysis_export.sql"

# Last commit with every published results CSV in public/results/.
PUBLISHED_COMMIT = "988806c"
PUBLISHED_FILES = [
    "h1_participant_scores.csv",
    "engagement_profile.csv",
    "h1_anchor_form_summary.csv",
    "engagement_outcome_associations.csv",
    "interest_enjoyment_ratings.csv",
    "corrected_imi.csv",
    "usability_scores.csv",
]

DEFAULT_EXCLUDE = ["P083"]

PROFILE_COLUMNS = [
    "participant",
    "intervention_window_days",
    "days_active",
    "sessions_started",
    "sessions_completed",
    "completion_percent",
    "total_reviews",
    "new_cards_introduced",
    "reading_passages_completed",
    "listening_tracks_completed",
    "total_listening_time_minutes",
    "repeat_review_count",
]

# (engagement_measure, dose numerator column, outcome_change, scores column)
ASSOCIATIONS = [
    ("Active-day rate", "days_active", "Total receptive gain", "total_difference"),
    ("Completed-loop rate", "sessions_completed", "Total receptive gain", "total_difference"),
    ("Flashcard-review rate", "total_reviews", "UoS gain", "uos_difference"),
    ("Reading-completion rate", "reading_passages_completed", "Reading gain", "reading_difference"),
    ("Listening-completion rate", "listening_tracks_completed", "Listening gain", "listening_difference"),
]


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

def load_dose(path: str | Path) -> pd.DataFrame:
    dose = pd.read_csv(path, dtype={"participant_id": str})
    dose["participant_id"] = dose["participant_id"].str.strip()
    return dose


def load_scores(path: str | Path) -> pd.DataFrame:
    scores = pd.read_csv(path, dtype={"participant": str})
    scores["participant"] = scores["participant"].str.strip()
    return scores


def _round_half_up(value: float) -> int:
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _with_scores(dose: pd.DataFrame, scores: pd.DataFrame) -> pd.DataFrame:
    """Dose rows for participants with outcome scores, in the scores order."""
    missing = sorted(set(scores["participant"]) - set(dose["participant_id"]))
    if missing:
        raise ValueError(f"Participants with scores but no dose row: {missing}")
    merged = scores.merge(
        dose, left_on="participant", right_on="participant_id", how="left", validate="one_to_one"
    )
    return merged


def splice_completed(
    dose: pd.DataFrame, source: pd.DataFrame, column: str = "sessions_completed"
) -> pd.DataFrame:
    """Copy of ``dose`` with sessions_completed replaced by ``column`` from
    ``source`` (matched on participant_id).  Every other dose column is kept,
    so only the completion-dependent outputs can change."""
    if column not in source.columns:
        raise ValueError(f"Completion source has no column {column!r}")
    if source["participant_id"].duplicated().any():
        raise ValueError("Completion source has duplicate participant_id rows")
    values = pd.to_numeric(source.set_index("participant_id")[column], errors="coerce")
    spliced = dose.copy()
    spliced["sessions_completed"] = dose["participant_id"].map(values).to_numpy()
    missing = spliced.loc[spliced["sessions_completed"].isna(), "participant_id"].tolist()
    if missing:
        raise ValueError(f"No {column} value in the completion source for: {missing}")
    spliced["sessions_completed"] = spliced["sessions_completed"].astype(int)
    return spliced


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

def build_engagement_profile(
    dose: pd.DataFrame,
    scores: pd.DataFrame,
    sessions_completed_column: str = "sessions_completed",
) -> pd.DataFrame:
    m = _with_scores(dose, scores)
    completed = m[sessions_completed_column].astype(int)
    started = m["sessions_started"].astype(int)
    profile = pd.DataFrame({
        "participant": m["participant"],
        "intervention_window_days": m["intervention_days"].astype(int),
        "days_active": m["days_active"].astype(int),
        "sessions_started": started,
        "sessions_completed": completed,
        "completion_percent": [
            _round_half_up(100 * c / s) if s > 0 else 0 for c, s in zip(completed, started)
        ],
        "total_reviews": m["total_reviews"].astype(int),
        "new_cards_introduced": m["new_cards_introduced"].astype(int),
        "reading_passages_completed": m["reading_passages_completed"].astype(int),
        "listening_tracks_completed": m["listening_tracks_completed"].astype(int),
        "total_listening_time_minutes": [
            f"{float(v):.1f}" for v in m["total_listening_time_minutes"].fillna(0)
        ],
        "repeat_review_count": m["repeat_review_count"].astype(int),
    })
    return profile[PROFILE_COLUMNS]


def build_associations(
    dose: pd.DataFrame,
    scores: pd.DataFrame,
    exclude: list[str],
    sessions_completed_column: str = "sessions_completed",
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return (published-format table, detail table with n and exclusions)."""
    m = _with_scores(dose, scores)
    excluded = [p for p in m["participant"] if p in set(exclude)]
    m = m[~m["participant"].isin(exclude)]
    days = m["intervention_days"].astype(float)

    published, detail = [], []
    for label, numerator, outcome_label, outcome_col in ASSOCIATIONS:
        column = sessions_completed_column if numerator == "sessions_completed" else numerator
        rate = m[column].astype(float) / days
        result = spearmanr(rate, m[outcome_col].astype(float))
        rho, p = float(result.statistic), float(result.pvalue)
        published.append({
            "engagement_measure": label,
            "outcome_change": outcome_label,
            "rho": f"{rho:.2f}",
            "p": f"{p:.3f}",
        })
        detail.append({
            "engagement_measure": label,
            "rate_definition": f"{column} / intervention_days",
            "outcome_change": outcome_label,
            "outcome_column": outcome_col,
            "n": len(m),
            "participants": "; ".join(m["participant"]),
            "excluded": "; ".join(excluded),
            "rho": rho,
            "p": p,
        })
    return pd.DataFrame(published), pd.DataFrame(detail)


def to_csv_text(df: pd.DataFrame) -> str:
    return df.to_csv(index=False, lineterminator="\n")


# ---------------------------------------------------------------------------
# Comparison with the published files
# ---------------------------------------------------------------------------

def compare_csv_text(generated: str, published: str) -> list[str]:
    """Cell-by-cell differences between two CSV texts (empty = identical)."""
    if generated == published:
        return []
    gen = [line.split(",") for line in generated.strip("\n").split("\n")]
    pub = [line.split(",") for line in published.replace("\r\n", "\n").strip("\n").split("\n")]
    diffs: list[str] = []
    if gen[0] != pub[0]:
        diffs.append(f"header differs: {gen[0]} vs {pub[0]}")
    header = pub[0]
    for i in range(max(len(gen), len(pub))):
        g = gen[i] if i < len(gen) else None
        p = pub[i] if i < len(pub) else None
        if g == p:
            continue
        if g is None or p is None:
            diffs.append(f"row {i}: generated={g} published={p}")
            continue
        for j, col in enumerate(header):
            gv = g[j] if j < len(g) else "<missing>"
            pv = p[j] if j < len(p) else "<missing>"
            if gv != pv:
                diffs.append(f"row {i} ({p[0]}), {col}: generated={gv} published={pv}")
    if not diffs:
        diffs.append("files differ only in whitespace/line endings")
    return diffs


# ---------------------------------------------------------------------------
# SQL helper and dose diff
# ---------------------------------------------------------------------------

def emit_sql(dose: pd.DataFrame, template: Path = SQL_TEMPLATE) -> str:
    """Fill the windows list of the dose export SQL from a dose export."""
    lines = template.read_text(encoding="utf-8").split("\n")
    begin = next(i for i, l in enumerate(lines) if l.strip() == "-- BEGIN WINDOWS")
    end = next(i for i, l in enumerate(lines) if l.strip() == "-- END WINDOWS")
    indent = lines[begin][: len(lines[begin]) - len(lines[begin].lstrip())]
    rows = [
        f"{indent}, ('{r.participant_id}', DATE '{r.intervention_start}', DATE '{r.intervention_end}')"
        for r in dose.itertuples()
    ]
    return "\n".join(lines[: begin + 1] + rows + lines[end:])


_MISSING = {"", "NULL", "nan", "None"}


def _norm(value: object) -> str:
    text = "" if pd.isna(value) else str(value).strip()
    if text in _MISSING:
        return ""
    try:
        number = float(text)
        return f"{number:g}"
    except ValueError:
        return text


def diff_dose(new: pd.DataFrame, reference: pd.DataFrame) -> list[str]:
    """Differences between two dose exports, plus which completion definition
    the reference's sessions_completed matches."""
    lines: list[str] = []
    new_ix = new.set_index("participant_id")
    ref_ix = reference.set_index("participant_id")
    only_ref = sorted(set(ref_ix.index) - set(new_ix.index))
    only_new = sorted(set(new_ix.index) - set(ref_ix.index))
    if only_ref:
        lines.append(f"only in reference: {only_ref}")
    if only_new:
        lines.append(f"only in new: {only_new}")
    shared_cols = [c for c in ref_ix.columns if c in new_ix.columns]
    for pid in sorted(set(ref_ix.index) & set(new_ix.index)):
        for col in shared_cols:
            a, b = _norm(new_ix.at[pid, col]), _norm(ref_ix.at[pid, col])
            if a != b:
                lines.append(f"{pid} {col}: new={a!r} reference={b!r}")

    candidates = [
        ("loop_completed (contract B)", "sessions_completed"),
        ("raw completed flag", "sessions_completed_raw_flag"),
        ("completed_at present", "sessions_completed_at_present"),
    ]
    common = sorted(set(ref_ix.index) & set(new_ix.index))
    if "sessions_completed" in ref_ix.columns and common:
        lines.append("")
        lines.append(f"reference sessions_completed matches, out of {len(common)} participants:")
        for label, col in candidates:
            if col not in new_ix.columns:
                continue
            same = sum(
                _norm(new_ix.at[pid, col]) == _norm(ref_ix.at[pid, "sessions_completed"])
                for pid in common
            )
            lines.append(f"  {label:30s} ({col}): {same}")
    return lines


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cmd_build(args: argparse.Namespace) -> int:
    dose = load_dose(args.dose)
    scores = load_scores(args.scores)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.completed_from:
        column = args.completed_column or "sessions_completed"
        spliced = splice_completed(dose, load_dose(args.completed_from), column)
        print(f"sessions_completed from {args.completed_from} ({column}); "
              f"all other columns from {args.dose}")
        changed = spliced["sessions_completed"].ne(dose["sessions_completed"].astype(int))
        for pid, old, new in zip(
            dose.loc[changed, "participant_id"],
            dose.loc[changed, "sessions_completed"],
            spliced.loc[changed, "sessions_completed"],
        ):
            print(f"  {pid}: sessions_completed {old} -> {new}")
        dose = spliced

    profile = build_engagement_profile(dose, scores)
    published, detail = build_associations(dose, scores, args.exclude)
    if args.completed_from:
        row = detail["engagement_measure"] == "Completed-loop rate"
        detail.loc[row, "rate_definition"] = (
            f"{column} from {Path(args.completed_from).name} / intervention_days"
        )
    outputs = {
        "engagement_profile.csv": to_csv_text(profile),
        "engagement_outcome_associations.csv": to_csv_text(published),
    }
    for name, text in outputs.items():
        (out_dir / name).write_text(text, encoding="utf-8")
    detail.to_csv(out_dir / "engagement_outcome_associations_detail.csv", index=False)

    first = detail.iloc[0]
    print(f"Wrote {', '.join(outputs)} and engagement_outcome_associations_detail.csv to {out_dir}")
    print(f"Associations: n = {first['n']}, excluded = {first['excluded'] or 'none'}")

    status = 0
    if args.compare_dir:
        compare_dir = Path(args.compare_dir)
        for name, text in outputs.items():
            published_path = compare_dir / name
            if not published_path.exists():
                print(f"  {name}: no published file at {published_path}")
                continue
            diffs = compare_csv_text(text, published_path.read_text(encoding="utf-8"))
            if not diffs:
                print(f"  {name}: identical to {published_path}")
            else:
                status = 1
                print(f"  {name}: {len(diffs)} difference(s) from {published_path}")
                for d in diffs:
                    print(f"    {d}")
    return status


def _cmd_restore_published(args: argparse.Namespace) -> int:
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    source_dir = Path(args.source_dir).expanduser()
    for name in PUBLISHED_FILES:
        private = source_dir / name
        if private.is_file():
            blob, source = private.read_bytes(), str(private)
        else:
            blob = subprocess.run(
                ["git", "-C", str(REPO_DIR), "show", f"{args.commit}:public/results/{name}"],
                check=True, capture_output=True,
            ).stdout
            source = f"git {args.commit}"
        (out_dir / name).write_bytes(blob)
        print(f"  {name}: from {source}")
    print(f"Restored {len(PUBLISHED_FILES)} published CSVs to {out_dir}")
    return 0


def _cmd_emit_sql(args: argparse.Namespace) -> int:
    sql = emit_sql(load_dose(args.dose))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(sql, encoding="utf-8")
    print(f"Wrote {out}")
    return 0


def _cmd_diff_dose(args: argparse.Namespace) -> int:
    lines = diff_dose(load_dose(args.new), load_dose(args.reference))
    print("\n".join(lines) if lines else "No differences.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build", help="build the engagement tables from a dose export")
    build.add_argument("dose", help="dose analysis export CSV")
    build.add_argument("--scores", default=str(PUBLISHED_DIR / "h1_participant_scores.csv"),
                       help="H1 outcome scores (default: run restore-published first)")
    build.add_argument("--exclude", nargs="*", default=DEFAULT_EXCLUDE,
                       help="participants left out of the associations (default: P083)")
    build.add_argument("--completed-from", default=None, metavar="CSV",
                       help="take sessions_completed from this CSV (e.g. the SQL export "
                            "result), matched on participant_id; every other column "
                            "still comes from <dose>")
    build.add_argument("--completed-column", default=None,
                       help="column of --completed-from to use (default sessions_completed, "
                            "i.e. loop_completed; or e.g. sessions_completed_raw_flag)")
    build.add_argument("--out-dir", default=str(OUTPUT_DIR))
    build.add_argument("--compare-dir", default=None,
                       help="directory with the published CSVs to compare against")
    build.set_defaults(func=_cmd_build)

    restore = sub.add_parser("restore-published",
                             help="copy the published results CSVs from the private "
                                  "copy, falling back to git history")
    restore.add_argument("--source-dir", default=str(PRIVATE_DIR),
                         help="checked first for each file (default ~/acquisition-private)")
    restore.add_argument("--commit", default=PUBLISHED_COMMIT,
                         help="git fallback for files not in --source-dir")
    restore.add_argument("--out-dir", default=str(PUBLISHED_DIR))
    restore.set_defaults(func=_cmd_restore_published)

    sql = sub.add_parser("emit-sql", help="fill the SQL windows list from a dose export")
    sql.add_argument("dose")
    sql.add_argument("--out", default=str(OUTPUT_DIR / "dose_analysis_export_filled.sql"))
    sql.set_defaults(func=_cmd_emit_sql)

    diff = sub.add_parser("diff-dose", help="compare two dose exports")
    diff.add_argument("new", help="e.g. the CSV from analysis/sql/dose_analysis_export.sql")
    diff.add_argument("reference", help="e.g. dose_analysis_export_v3.csv")
    diff.set_defaults(func=_cmd_diff_dose)

    args = parser.parse_args(argv)
    if args.command == "build" and args.completed_column and not args.completed_from:
        parser.error("--completed-column needs --completed-from")
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
