"""Tests for the main entry point."""

from demo.src.main import main


def test_main_returns_zero():
    assert main([]) == 0
