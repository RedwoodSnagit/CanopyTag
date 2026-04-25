# CanopyTag

<p align="center">
  <img src="./src/frontend/assets/logo.png" alt="CanopyTag logo" width="80" />
</p>

<p align="center">
  <strong>Repo-local context for agents and humans.</strong>
</p>

CanopyTag is a local-first annotation layer for codebases. It stores brief,
structured metadata next to your code so agents and humans can quickly see what
a file does, how trustworthy it is, what depends on it, what needs review, and
where to look next.

It does not replace grep, your editor, or reading the source. It adds judgment
around those workflows: authority, freshness, quality scores, TODOs, comments,
relationships, agent activity, and lightweight repo visualizations.

## Status

CanopyTag is prerelease and currently installed from source. The package is not
published to npm yet.

The project is designed to be local-first:

- No cloud service
- No auth
- No source-file modification
- Repo annotations live in `canopytag/canopy.json`
- Local-only activity and identity files are git-ignored

## What It Gives You

- A web UI with Explorer, Table, Graph, Analytics, and Activity views
- A CLI for orientation, search-result enrichment, TODOs, health checks, and analytics
- An MCP server so agents can read and write repo context directly
- A review feed for agent-authored metadata changes
- A Claude Code analytics hook for recent file/search heat
- A small forest-themed demo repo that shows the full workflow

## Quick Start

Requires Node.js 18+.

```bash
git clone https://github.com/RedwoodSnagit/CanopyTag.git
cd CanopyTag
npm install
npm link
```

`npm link` makes the `canopytag` command available from other repos on the same
machine. If you do not want a global link, run commands from this checkout with
`node bin/canopytag.mjs <command>`.

Start the web UI:

```bash
npm run dev
```

Open:

- Frontend: http://localhost:5180
- Backend: http://localhost:3100

When run from the CanopyTag checkout, the app starts on the bundled demo repo.
Use `Switch Repo` in the header to point the UI at another local folder.

## Try The Demo

The bundled demo is `forest_repo_demo`, a tiny forest-ecosystem Python project.
The code is intentionally small; the interesting layer is the CanopyTag metadata
around it.

In the demo, try these views:

- `Explorer` for file summaries, scores, TODOs, comments, and freshness
- `Table` for sortable repo-wide metadata
- `Graph` for feature clusters and related-file navigation
- `Analytics` for recent agent/search heat
- `Activity` for agent-authored changes waiting for human review

The demo is meant to show that CanopyTag complements source reading. It gives
agents brief queryable context and gives humans a fast visual map of the repo.

## Use It On Your Repo

Initialize a target repo:

```bash
canopytag init --repo /path/to/your/repo
```

This creates:

```text
your-repo/
  canopytag/
    canopy.json
    agent_manifest.json
    settings.json
    tags.json
    profile.local.json  # local identity, git-ignored
  src/
  tests/
```

The visible `canopytag/` directory is intentional. Agents discover it more
reliably than hidden metadata folders. Legacy `.canopytag/` repos still resolve
for backward compatibility.

Terminology note: **CanopyTag checkout** means this tool repository. **`canopytag/`
directory** means the metadata folder inside whatever repo you are annotating.
The shared name is deliberate: it makes the metadata folder obvious to agents,
while docs use "checkout" vs. "directory" to avoid ambiguity.

Point CLI commands at a repo with `--repo`:

```bash
canopytag stats --repo /path/to/your/repo
```

Or set `REPO_ROOT`:

```bash
export REPO_ROOT=/path/to/your/repo
canopytag stats
```

If you use npm scripts from the CanopyTag checkout, pass command arguments after
`--`:

```bash
npm run stats -- --repo /path/to/your/repo
```

## Agent Workflow

CanopyTag works best as a post-search judgment layer.

```bash
rg -l "validateToken" src tests
canopytag context src/auth/middleware.ts src/auth/tokens.ts
```

The intended loop is:

1. Use `stats` to orient before diving in.
2. Use `rg -l` or similar tools to find real source hits.
3. Use `context` to enrich those hits with summaries, authority, warnings, and relationships.
4. Use `compare` when deciding which of several files should win a conflict.
5. Use `query --feature ... --detail 4` when the hits cluster around a feature.
6. Let agents update `canopy.json` through MCP as they learn.
7. Review recent agent activity in the UI when practical.

## CLI Reference

For a shorter command flow, see the [CLI cheatsheet](./docs/cli-cheatsheet.md).

```bash
canopytag init --repo /path/to/repo       # initialize canopytag metadata

canopytag stats                          # orient: counts, authority, TODOs
canopytag stats --feature core           # scoped overview

canopytag ls                             # top files by authority
canopytag ls --all --tag api             # filter by tag
canopytag ls --sort attention            # files needing attention

canopytag query --feature core           # progressive feature exploration
canopytag query --feature core --detail 4

canopytag context src/lib/api.ts         # compact file context
canopytag context hit1.ts hit2.md        # enrich grep hits
canopytag context --feature auth         # feature context

canopytag compare docs/spec.md src/api.ts # authority, quality, review, trust order

canopytag todos                          # open TODOs by priority
canopytag todos --priority 2             # P1 and P2

canopytag health                         # authority vs quality mismatches
canopytag analytics                      # recent agent/search heat
canopytag coverage                       # annotation coverage report
canopytag mcp --repo /path/to/repo       # write project-local MCP config
canopytag hook install                   # install Claude Code analytics hook
```

Every command accepts `--help`. Most commands accept `--repo <path>`.

## MCP Setup

CanopyTag exposes its read/write surface through MCP so compatible agents can
query and update repo context directly.

Preferred project-local setup:

```bash
canopytag mcp --repo /path/to/your/repo
```

This writes `/path/to/your/repo/.mcp.json` with a `canopytag` server entry that
points at this checkout and sets `REPO_ROOT` to the target repo.

Preview the merged config:

```bash
canopytag mcp --repo /path/to/your/repo --print
```

Replace an existing `canopytag` MCP entry:

```bash
canopytag mcp --repo /path/to/your/repo --force
```

After changing MCP config, restart the client/session and verify registration:

```bash
claude mcp list
```

### Manual MCP Config

If you prefer to edit config yourself, add this to `.mcp.json` at the repo root
or to a client settings file that supports `mcpServers`:

```json
{
  "mcpServers": {
    "canopytag": {
      "command": "node",
      "args": [
        "/absolute/path/to/CanopyTag/node_modules/tsx/dist/cli.mjs",
        "/absolute/path/to/CanopyTag/src/mcp/server.ts"
      ],
      "env": {
        "REPO_ROOT": "/path/to/target/repo"
      }
    }
  }
}
```

### MCP Tools

| Tool | Purpose |
|------|---------|
| `canopytag_stats` | Repo counts, authority distribution, open TODOs |
| `canopytag_ls` | List annotated files by score, authority, or attention |
| `canopytag_query` | Progressive repo exploration with relationships |
| `canopytag_context` | Compact context for files or features |
| `canopytag_compare` | Compare exact files by authority, quality, review, and trust order |
| `canopytag_todos` | Open TODOs across the repo |
| `canopytag_health` | Authority vs quality mismatch detection |
| `canopytag_tags` | Browse and consolidate tag vocabulary |
| `canopytag_manifest` | Inspect the agent activity/review feed |
| `canopytag_fan_in` | Reverse relationship graph |
| `canopytag_fan_out` | Forward relationship graph |
| `canopytag_annotate` | Update file metadata |
| `canopytag_add_comment` | Add observations, even on locked files |
| `canopytag_add_todo` | Log work items |
| `canopytag_rename_tag` | Consolidate duplicate tags |
| `canopytag_stage_suggestion` | Add sidecar-only suggestions or manual stale notes |

Agents write directly to `canopy.json` by default. `agent_manifest.json` acts as
the companion activity/review feed so humans can later agree, fix, or reject
agent-authored changes.

## Claude Code Analytics Hook

MCP support is general. The built-in analytics hook is Claude Code-specific.

From the target repo:

```bash
canopytag hook install
```

This merges a `PostToolUse` hook into `.claude/settings.json`. The hook records
Claude `Read`, `Edit`, `Write`, `Grep`, `Glob`, and Bash `rg`/`ripgrep` events
to `canopytag/.analytics.json`.

Search query strings are not stored. When tool output includes result paths,
CanopyTag records those files as search hits so they contribute to heat without
counting as opened files.

## Review And Attribution

Human UI writes use `canopytag/profile.local.json`. CanopyTag creates it from
`CANOPYTAG_AUTHOR_NAME`, Git `user.name`, or the OS username, and keeps it
git-ignored so cloned repos do not inherit another person's name.

MCP write tools accept optional `agent_name` and `agent_session` parameters. If
omitted, the server uses `CANOPYTAG_AGENT_NAME` and `CANOPYTAG_AGENT_SESSION`,
then falls back to a generic agent signature.

Agent-authored changes stay useful immediately. Human review is a confidence
layer, not a gate. The Activity view lets humans agree, request a fix, or reject
recent agent work.

## What Gets Annotated

Each file entry in `canopy.json` can include:

| Field | Meaning |
|-------|---------|
| `summary` | What the file does and why it matters |
| `validity`, `clarity`, `completeness`, `stability` | Quality scores from 1 to 5 |
| `authority_level` | Trust hierarchy from idea to standard |
| `status` | Active, draft, experimental, deprecated, superseded, or archived |
| `tags` | Filterable labels |
| `feature_id` | Feature or conceptual group |
| `todos` | Work items with priority, tags, difficulty, and author |
| `comments` | Human and agent observations with type and confidence |
| `related_files` | Typed file relationships with closeness from 1 to 5 |
| `io_metadata` | Inputs and outputs for scripts and entrypoints |

The top-level `features` map is intentionally lightweight. Use it to name a
concept, describe the boundary, and point agents toward a canonical starting
file. Keep detailed truth on file entries.

## Scoring Conventions

Quality dimensions use 1 to 5:

| Dimension | Question |
|-----------|----------|
| Validity | Does this match reality? Has it been tested or verified? |
| Clarity | Can humans and agents parse the intent without confusion? |
| Completeness | How much of the intended work is done? |
| Stability | How settled is this design? Will it change soon? |

Authority is hierarchy, not just quality:

| Level | Meaning |
|-------|---------|
| 1 - Idea | Exploratory notes, non-normative |
| 2 - Blueprint | Coherent design or in-work implementation |
| 3 - Guideline | Endorsed practice, useful but not hardened |
| 4 - Specification | Solid production-ready behavior or guidance |
| 5 - Standard | Canonical rules or files that should rarely change |

When two CanopyTag entries conflict, prefer the higher-authority source. Lower
authority can still be useful context, but it should be scrutinized before it
overrides higher authority.

Freshness is separate from status:

| Label | Meaning |
|-------|---------|
| `Fresh` | Reviewed and no drift signal detected |
| `Review Drift` | This file or a close related file changed after review |
| `Unknown` | No recorded review date |

`Stale` is currently a documented/manual concept. There is not yet a separate
persisted stale override editor, so UI, CLI, and MCP currently emit `Fresh`,
`Review Drift`, and `Unknown`.

## Design Boundaries

- Not an IDE: CanopyTag does not show or edit source code.
- Not a task board: TODOs are repo context, not a project-management system.
- Not a parser: Graph views visualize metadata relationships, not import graphs.
- Not a replacement for grep: Search first, then ask CanopyTag what matters.
- Local-first: Annotations travel with the repo, and local-only files stay ignored.

## Development

Useful commands:

```bash
npm run dev          # Vite frontend + Fastify backend
npm run build        # TypeScript + production frontend build
npm test -- --run    # Vitest suite
npm run test:e2e     # Optional Playwright smoke tests
```

Architecture at a glance:

- Frontend: React, Vite, TypeScript, Zustand, TanStack Table, react-arborist
- Backend: Fastify file-system API
- CLI: TypeScript scripts dispatched through `bin/canopytag.mjs`
- MCP: Stdio server reusing CLI builders
- Styling: Tailwind CSS, OKLCH forest palette, Manrope UI font, Plus Jakarta Sans wordmark
- Data: `canopytag/canopy.json` per target repo

CanopyTag respects `.gitignore` and `.ctagignore` when building the tree.
Common directories such as `node_modules`, `.git`, `__pycache__`, and `.venv`
are always excluded.

## More Reading

- [CanopyTag vs ripgrep](./docs/canopytag-vs-ripgrep.md)
- [CLI cheatsheet](./docs/cli-cheatsheet.md)
- [Roadmap](./docs/roadmap.md)
- [Agent analytics design](./docs/design/agent-analytics.md)
- [Agent guide](./AGENTS.md)
