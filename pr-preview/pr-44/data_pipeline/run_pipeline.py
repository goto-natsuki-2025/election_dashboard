"""Dashboard data regeneration orchestrator."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
PROJECT_PARENT = ROOT.parent
DATA_DIR = ROOT / "data"
INTERMEDIATE_PATHS = [
    DATA_DIR / "election_summary.csv",
    DATA_DIR / "candidate_details.csv.gz",
    DATA_DIR / "party_compensation_summary_2020.csv",
    DATA_DIR / "party_compensation_yearly_2020.csv",
    DATA_DIR / "party_compensation_municipal_2020.csv",
]


def run_step(description: str, command: list[str]) -> None:
    print(f"[pipeline] start: {description}")
    process = subprocess.run(command, cwd=PROJECT_PARENT, check=False)
    if process.returncode != 0:
        print(f"[pipeline] failed: {description} (exit code {process.returncode})")
        raise SystemExit(process.returncode)
    print(f"[pipeline] done : {description}")


def cleanup_intermediate_files() -> None:
    removed: list[str] = []
    for path in INTERMEDIATE_PATHS:
        if path.exists():
            try:
                path.unlink()
            except OSError as error:  # noqa: PERF203 (we want explicit handling)
                print(f"[pipeline] warn : failed to remove {path.name}: {error}")
            else:
                removed.append(path.name)
    if removed:
        print(f"[pipeline] removed intermediates: {', '.join(removed)}")


def main() -> None:
    steps = [
        (
            "regenerate_static_data",
            [sys.executable, "-m", "election_dashboard.data_pipeline.regenerate_static_data"],
        ),
        (
            "generate_compensation_data",
            [sys.executable, "-m", "election_dashboard.data_pipeline.generate_compensation_data"],
        ),
        (
            "build_dashboard_data",
            [sys.executable, "-m", "election_dashboard.data_pipeline.build_dashboard_data"],
        ),
    ]
    for description, command in steps:
        run_step(description, command)
    cleanup_intermediate_files()
    print("[pipeline] all steps completed successfully")


if __name__ == "__main__":
    main()
