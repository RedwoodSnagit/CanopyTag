# Repo-Local Data And Public Repo Hygiene

**Date:** 2026-04-29
**Status:** active guidance

CanopyTag is local-first. It reads and writes metadata in the target repository;
it does not upload repo contents to a CanopyTag service.

## Target Repo Metadata

These files live inside the target repo's visible `canopytag/` directory and are
intended to be reviewable project knowledge:

- `canopytag/canopy.json` - file summaries, authority, scores, relationships,
  TODOs, comments, feature groups, and related structured context.
- `canopytag/agent_manifest.json` - agent-authored activity and review records.
- `canopytag/settings.json` - repo-local CanopyTag settings.
- `canopytag/tags.json` - optional tag vocabulary.
- `canopytag/canopy_archive.json` - optional completed TODO/archive data.

Treat these like documentation. If the repo is public, review them before
committing or publishing.

`repo_root` in `canopy.json` is portable metadata only. New repos should keep it
blank. Runtime tools should use `--repo`, `REPO_ROOT`, the current working
directory, or the active web UI repo selection to find the target repo.

## Local-Only Files

These files are local operating state and should not be committed:

- `canopytag/profile.local.json` - local human identity for UI attribution.
- `canopytag/.analytics.json` - local agent read/edit/search heat.
- `canopytag/.active_work.json` - local, expiring advisory work claims for
  concurrent agents or humans. Claims may link to shared TODO IDs, but the claim
  state itself is not durable project status. The default file is shared by
  processes in one checkout, not across separate Git worktrees. Released and
  expired history is pruned after seven days and capped at 500 records.
- `.mcp.json` - MCP launch config; the generated file contains absolute local
  paths to this CanopyTag checkout and the target repo.
- `.claude/settings.json` when installed by `canopytag hook install` - may
  contain an absolute local path to `hooks/canopytag-analytics.mjs`.

`canopytag init` keeps `profile.local.json` ignored. The first active-work claim
keeps `.active_work.json` and its crash/temp siblings ignored. Analytics writes
and `canopytag hook install` keep `.analytics.json*` ignored. Query tracking is
best-effort: an ignore or write failure does not break retrieval. MCP config and
Claude settings are written where the host tools expect them; add project-local
ignore rules if your repo would otherwise track those files, or review them
before sharing.

## Encoding

CanopyTag writes JSON as UTF-8 without a byte order mark (BOM). Readers tolerate
a leading UTF-8 BOM because some Windows editors and cleanup tools add it
silently. If another tool fails on a CanopyTag JSON file, save it as UTF-8
without BOM.

## Agent Rule Of Thumb

Start with `AGENTS.md`, `README.md`, and this document for the top-down contract.
Use `canopytag stats`, `context`, `compare`, and `query` to route through
repo-local metadata, then verify against source code and canonical docs.
