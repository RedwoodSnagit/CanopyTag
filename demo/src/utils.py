"""Ecosystem scoring helpers for the Forest Repo Demo sample."""

from typing import Any


def habitat_value(observation: dict[str, Any]) -> float:
    """Return a simple habitat value for one species observation."""
    count = float(observation.get("count") or 0)
    if count <= 0:
        return 0
    native_bonus = 2 if observation.get("native", True) else -2
    layer_bonus = 3 if observation.get("canopy_layer") == "canopy" else 1
    threat_penalty = float(observation.get("threat_score") or 0)
    return max(0, count + native_bonus + layer_bonus - threat_penalty)


def valid_observation(observation: dict[str, Any]) -> bool:
    """Check that a species observation has the fields needed for scoring."""
    return bool(observation.get("species")) and observation.get("count", 0) > 0


def summarize_habitat(observations: list[dict[str, Any]], target_health_score: int) -> dict[str, Any]:
    """Pick high-value observations until the health target is reached."""
    selected: list[dict[str, Any]] = []
    total = 0.0
    ranked = sorted(
        [observation for observation in observations if valid_observation(observation)],
        key=habitat_value,
        reverse=True,
    )
    for observation in ranked:
        if total >= target_health_score:
            break
        selected.append(observation)
        total += habitat_value(observation)
    return {
        "score": int(total),
        "target": target_health_score,
        "observations": selected,
    }


def format_report(report: dict[str, Any], title: str = "Forest Repo Demo") -> str:
    """Render a compact forest-health summary for terminal output."""
    observations = report.get("observations", [])
    if not observations:
        return f"{title}: no valid species observations found"
    species = ", ".join(observation["species"] for observation in observations)
    return f"{title}: habitat score {report['score']}/{report['target']} from {species}"
