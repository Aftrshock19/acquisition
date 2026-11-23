import sys
from pathlib import Path

import pytest

ANALYSIS_DIR = Path(__file__).resolve().parent.parent
TESTS_DIR = Path(__file__).resolve().parent

# The pipeline scripts import each other as top-level modules.
for p in (ANALYSIS_DIR, TESTS_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import synthetic_export  # noqa: E402


@pytest.fixture
def cohort_export_path(tmp_path):
    return synthetic_export.write_json(
        synthetic_export.build_cohort_export(), tmp_path / "cohort.json"
    )


@pytest.fixture
def single_user_export_path(tmp_path):
    return synthetic_export.write_json(
        synthetic_export.build_single_user_export("P001"), tmp_path / "single.json"
    )


@pytest.fixture
def report_dirs(tmp_path, monkeypatch):
    """Redirect build_report outputs into tmp_path."""
    import build_report

    figures = tmp_path / "figures"
    output = tmp_path / "output"
    monkeypatch.setattr(build_report, "FIGURES_DIR", figures)
    monkeypatch.setattr(build_report, "OUTPUT_DIR", output)
    return figures, output
