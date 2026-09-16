# CanopyTag CLI Cheatsheet

Use CanopyTag for compact authored catalogue discovery and after normal repo
search. `rg` finds source truth; CanopyTag helps find and prioritize candidate
files, then adds authority, freshness, lifecycle, quality, TODOs, and
relationship context.

## Start Here

```bash
canopytag stats --repo /path/to/repo
canopytag ls --sort attention --repo /path/to/repo
canopytag coverage --repo /path/to/repo
canopytag coverage --scope production_candidate --repo /path/to/repo
canopytag doctor --repo /path/to/repo
```

## Search Then Enrich

```bash
canopytag query --search "token validation"
canopytag query --search "token" --tag security --kind code
rg -l "validateToken" src tests
canopytag context src/auth/middleware.ts src/auth/tokens.ts
```

`query --search` searches only authored catalogue fields: path, title, summary,
tags, feature name/description, open TODO text/tags, active lifecycle reasons,
and finding/warning comments. It uses field-weighted prefix matching and typo
tolerance for longer terms, defaults to 10 direct results, and never returns
more than 100. Results show both matched fields and matched terms. Filters
compose with search. `related_files` are traversal edges and are not indexed as
search text.

Use `context` when you already have paths and want compact agent-ready context:
summary, authority, review status, lifecycle warnings, quality warnings, TODOs,
relations, and tags. Malformed lifecycle metadata is preserved and reported as
`INVALID` instead of being silently ignored.

## Compare Trust Between Files

```bash
canopytag compare docs/auth-spec.md src/auth/middleware.ts docs/auth-idea.md
```

Use `compare` when multiple files appear relevant and you need to decide which
one should win a conflict. It returns:

- Authority rank: conflict precedence from `1-Idea` to `5-Standard`
- Quality: validity + clarity + completeness + stability, out of 20
- Review freshness: `Fresh`, `Review Drift`, or `Unknown`
- Lifecycle state: `OPEN`, `REVIEW DUE`, `EXPIRED`, or `INVALID`; resolved marks
  are preserved but hidden from default reads
- Warning count and TODO pressure
- Trust order across the requested files

MCP equivalent:

```ts
canopytag_compare({ files: ["docs/auth-spec.md", "src/auth/middleware.ts"] })
```

## Explore A Feature

```bash
canopytag query --feature auth --detail 4
canopytag query --feature auth --relation implements
canopytag context --feature auth
```

Use `query` when you need authored catalogue discovery or the broader
neighborhood around a feature, tag, or relation. Use `context --feature` when
you want a compact prompt block.

## Review Work

```bash
canopytag todos --priority 2
canopytag todos --project PRJ-001
canopytag health
canopytag doctor
canopytag analytics --days 7
```

`todos` is the aggregate of Canopy-native file and project TODOs. It labels the
owning scope and does not claim to scan every Markdown backlog or inline source
marker.

`health` includes due and expired lifecycle marks, open `review_needed` marks,
and malformed lifecycle metadata alongside authority/quality findings.

`doctor` checks facts that can be automated safely: malformed nested metadata,
broken or unsafe paths, orphaned cards, duplicate TODO/comment/project IDs,
project references, authored scope-set members and subject kinds, Git-backed
review drift, feature entry points, portable
`repo_root` usage, and pending agent review. It does not rewrite summaries,
scores, authority, tags, or relationships. Use
`canopytag doctor --strict` when warnings should fail a local check or CI job;
use `--format json` for machine-readable output.

## Check Purposeful Coverage

```bash
canopytag coverage
canopytag coverage --scope production_candidate --detail
```

When `scope_sets` are present, the default report leads with each authored
scope and labels whole-repository percentage as informational. A selected scope
separates annotated, unannotated, missing/wrong-kind, file, and directory
subjects. Optional provider output at
`canopytag/generated/scope-membership.json` is shown with its fingerprint and
freshness deadline; proposals never change authored counts.

## Follow Multi-File Work

```bash
canopytag projects
canopytag projects PRJ-001
canopytag query --project PRJ-001 --detail 3
canopytag context --project PRJ-001
```

A project packet explains why the work exists, which features and files it
implicates, and which project-owned tasks are ready, blocked, or claimed.
Project tasks may add typed dependencies, milestones, owned/excluded paths,
resources, acceptance evidence, and retained action receipts. Readiness is
computed from authored task state plus live local work claims; it is never
persisted as a second truth. File context inherits project tasks read-only and
nothing is copied onto the file card. Projects are not boards, schedulers, or
autonomous dispatch systems.

## Coordinate Concurrent Edits

```bash
canopytag work check src/auth
canopytag work claim --path src/auth --summary "Repair token refresh" --ttl 2h --owner codex --session thread-123
canopytag work list --owner codex
canopytag work renew AW-... --ttl 2h --owner codex --session thread-123
canopytag work release AW-... --note "Focused tests passing" --owner codex --session thread-123
```

Claims are local, advisory, and expiring. They live in the git-ignored
`canopytag/.active_work.json`, may link to a TODO with `--todo-id` and
`--todo-file`, and never edit `canopy.json` or complete the TODO. Use a persistent
`in_progress` TODO or lifecycle/status metadata for unfinished repository work;
use `work` for who is editing a path now.

Active claims complement the heatmap without changing it: claims are declared
current intent, while analytics are observed recent activity.

Mutation commands require an owner from `--owner`, `CANOPYTAG_AGENT_NAME`, or
`MCP_CLIENT_NAME`; use a per-task session when agents can share an owner name.
Expired claims must be claimed again so conflicts are rechecked. End planned
directory paths with `/`. Local released/expired history is retained for seven
days, up to 500 records.

## Install Agent Hooks

```bash
canopytag mcp --repo /path/to/repo
canopytag hook install
```

MCP exposes `canopytag_active_work`, `canopytag_claim_work`,
`canopytag_renew_work`, and `canopytag_release_work` for the same check-in and
check-out loop. `mcp` writes project-local MCP config. `hook install` is Claude Code-specific
and records recent read/edit/search heat in `canopytag/.analytics.json`.

For public repos, review or keep local the generated `.mcp.json` and
`.claude/settings.json`; both may contain absolute paths from your machine. See
[repo-local data hygiene](./repo-local-data.md) for the shared vs local file
boundary.
