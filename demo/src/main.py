"""CLI entry point for the Forest Repo Demo sample."""

import json
import sys
from pathlib import Path
from .config import load_config
from .utils import format_report, summarize_habitat


def main(args=None):
    """Load species observations and print a forest-health report."""
    args = list(args or [])
    config = load_config()
    observation_path = Path(args[0]) if args else None
    observations = []
    if observation_path and observation_path.exists():
        with observation_path.open(encoding="utf-8") as f:
            observations = json.load(f).get("observations", [])

    report = summarize_habitat(
        observations,
        target_health_score=config["target_health_score"],
    )
    print(format_report(report, title=config["name"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
