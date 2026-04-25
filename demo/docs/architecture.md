# Forest Repo Demo Architecture

## Overview

Forest Repo Demo is a single-command forest-health reporter. It accepts species
observations, filters out unusable entries, scores habitat value, and prints a
compact ecosystem summary. The project is deliberately modest so CanopyTag's
navigation layer stays easy to inspect.

## Components

- **CLI entry point** (`src/main.py`) owns argument parsing and output.
- **Configuration** (`src/config.py`) defines health and invasive-pressure thresholds.
- **Ecosystem helpers** (`src/utils.py`) normalize observations, score habitat
  value, and format the report.

## Data Flow

1. User passes a species-observation JSON file.
2. The CLI loads defaults and optional config overrides.
3. Species observations are normalized and validated.
4. Observations are sorted by habitat value.
5. A short forest-health summary is printed for the demo forest.

The architecture is stable, but the API guide is intentionally still draft.
That contrast lets CanopyTag show the difference between a standard, a draft,
and implementation files that sit between them.
