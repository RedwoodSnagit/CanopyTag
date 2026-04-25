"""Configuration loader for Forest Repo Demo."""

import json
from pathlib import Path

DEFAULT_CONFIG = {
    "name": "Forest Repo Demo",
    "version": "0.1.0",
    "target_health_score": 25,
    "max_invasive_pressure": 3,
}


def load_config(path: str | None = None) -> dict:
    """Load config from file, falling back to defaults."""
    if path and Path(path).exists():
        with open(path, encoding="utf-8") as f:
            return {**DEFAULT_CONFIG, **json.load(f)}
    return DEFAULT_CONFIG.copy()
