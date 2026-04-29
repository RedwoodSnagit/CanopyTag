# CanopyTag Agent Guide

This file is for coding agents working in the CanopyTag checkout. It is a
compact operating guide, not a historical handoff log.

## First Read

- `README.md` - public overview, install, demo, CLI, MCP, and concepts
- `docs/cli-cheatsheet.md` - short command flow for agents
- `docs/repo-local-data.md` - shared metadata vs local-only files
- `docs/roadmap.md` - current roadmap and future ideas
- `canopytag/canopy.json` - CanopyTag dogfooding metadata for this repo

## Terminology

- **CanopyTag checkout** means this app/tool repository.
- **`canopytag/` directory** means the metadata folder inside a repo being
  annotated.
- The shared name is deliberate: visible `canopytag/` folders are easier for
  agents to discover than hidden metadata folders.

## Local Commands

```bash
npm install
npm run dev
npm run build
npm test -- --run
npm run test:e2e
```

`npm run test:e2e` is optional and requires Playwright browser dependencies.

## Architecture

```text
src/
  frontend/          React + Vite + TypeScript UI
  backend/           Fastify routes and filesystem libraries
  cli/               Agent-facing command builders and dispatch targets
  mcp/               Stdio MCP server and tool registration
  shared/            Types and case conversion utilities
canopytag/           Dogfood metadata for this checkout
demo/                forest_repo_demo target repo
docs/                Public design notes and roadmap
hooks/               Claude Code analytics hook
```

## Product Boundaries

- Not an IDE: CanopyTag does not show or edit source code.
- Not a task board: TODOs are repo context, not a project-management system.
- Not a parser: graph views visualize metadata relationships, not import graphs.
- Not a search replacement: use `rg` first, then ask CanopyTag what matters.
- Local-first: shared annotations live in `canopytag/canopy.json`; local-only
  identity, analytics, MCP, and hook config stay ignored or explicitly reviewed.

## Data Conventions

- On disk, JSON uses `snake_case`.
- TypeScript uses `camelCase`.
- Path-like keys are not case-transformed.
- New repos should use visible `canopytag/`.
- Legacy `.canopytag/` still resolves for backward compatibility.
- New `canopy.json` files should keep `repo_root` blank; use runtime repo
  selection (`--repo`, `REPO_ROOT`, cwd, or the web UI) instead of committed
  local absolute paths.
- Never commit `profile.local.json` or local `.analytics.json` files.
- Review `.mcp.json` and `.claude/settings.json` before committing; generated
  versions may contain local absolute paths.

## Agent Workflow

Start broad, then narrow:

```bash
canopytag stats --repo /path/to/repo
rg -l "keyword" src tests
canopytag context path/from/search.ts another/path.md
canopytag compare path/from/search.ts another/path.md
canopytag query --feature feature-id --detail 4
```

Use:

- `stats` to orient
- `context` to enrich known paths
- `compare` to decide which of several files should win a conflict
- `query` to explore a feature or tag neighborhood
- `todos`, `health`, and `analytics` before wrapping up

## MCP And Hooks

Preferred MCP setup for a target repo:

```bash
canopytag mcp --repo /path/to/repo
```

Claude Code analytics hook setup from the target repo:

```bash
canopytag hook install
```

The hook records reads, edits, writes, grep/glob, Bash `rg`/`ripgrep`, and
CanopyTag query heat. Query strings are intentionally not stored.

## Scoring And Trust

Quality scores are 1-5 for validity, clarity, completeness, and stability.

Authority is hierarchy:

1. Idea
2. Blueprint
3. Guideline
4. Specification
5. Standard

When two entries conflict, prefer the higher-authority source. Lower-authority
files can still be useful, but they should not override higher-authority files
without human judgment.

Freshness is separate from lifecycle status. The current operational labels are
`Fresh`, `Review Drift`, and `Unknown`. Manual `Stale` remains a future/pending
concept.

## When You Change The Repo

- Keep README, `docs/cli-cheatsheet.md`, and `docs/roadmap.md` aligned with new
  CLI/MCP surfaces.
- Add or update `canopytag/canopy.json` entries for important new files.
- Keep package hygiene in mind: local screenshots, profiles, analytics, output,
  workspace scratch data, and tests are excluded from npm artifacts.
- Run `npm run build` and `npm test -- --run` for code changes.
- Run `npm pack --dry-run --json` when changing packaging or root files.
