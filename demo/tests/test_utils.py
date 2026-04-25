"""Tests for planning helpers."""

from demo.src.utils import format_report, habitat_value, summarize_habitat, valid_observation


def test_habitat_value_rewards_native_canopy_species():
    assert habitat_value({
        "species": "red oak",
        "count": 7,
        "native": True,
        "canopy_layer": "canopy",
        "threat_score": 1,
    }) == 11


def test_summarize_habitat_ignores_invalid_observations():
    report = summarize_habitat([
        {"species": "", "count": 5},
        {"species": "red oak", "count": 7, "native": True, "canopy_layer": "canopy"},
    ], target_health_score=8)
    assert [observation["species"] for observation in report["observations"]] == ["red oak"]


def test_valid_observation_requires_count():
    assert valid_observation({"species": "lichen", "count": 0}) is False


def test_format_report_summarizes_observations():
    result = format_report({
        "score": 11,
        "target": 25,
        "observations": [{"species": "red oak"}],
    }, title="Forest")
    assert result == "Forest: habitat score 11/25 from red oak"
