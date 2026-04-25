# forest_repo_demo

Forest Repo Demo is a tiny forest-health CLI used to demonstrate CanopyTag.
It summarizes a small species-observation file and highlights the tradeoff
CanopyTag is built for: code search can find files, but annotations explain
which files are authoritative, risky, stale, or worth reading next.

## Quick Start

```bash
python -m demo.src.main sample-observations.json
```

## Structure

- `src/` - CLI, configuration, and ecosystem scoring helpers
- `docs/` - Architecture and draft species-import notes
- `tests/` - Small regression suite
- `canopytag/` - CanopyTag metadata for this demo

Open this folder in CanopyTag and start with the Graph or Activity tab. The
metadata is intentionally more interesting than the code: it includes reviewed
scores, agent findings, typed related files, TODOs, I/O metadata, and a small
agent activity feed for agree/fix/reject review.
