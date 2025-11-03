"""Dashboard data regeneration orchestrator."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def run_step(description: str, command: list[str]) -> None:
    print(f"[pipeline] start: {description}")
    process = subprocess.run(command, cwd=ROOT, check=False)
    if process.returncode != 0:
        print(f"[pipeline] failed: {description} (exit code {process.returncode})")
        raise SystemExit(process.returncode)
    print(f"[pipeline] done : {description}")


def main() -> None:
    steps = [
        ("regenerate_static_data.py", [sys.executable, "regenerate_static_data.py"]),
        ("generate_compensation_data.py", [sys.executable, "generate_compensation_data.py"]),
        ("build_dashboard_data.py", [sys.executable, "build_dashboard_data.py"]),
    ]
    for description, command in steps:
        run_step(description, command)
    print("[pipeline] all steps completed successfully")


if __name__ == "__main__":
    main()
