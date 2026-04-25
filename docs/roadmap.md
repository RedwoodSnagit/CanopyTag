# CanopyTag Roadmap

This is the public roadmap and idea backlog. It keeps the useful parts of the
old internal TODO log without preserving every historical session note.

## Current Status

CanopyTag is prerelease but usable from source.

Working now:

- Web UI with Explorer, Table, Graph, Analytics, and Activity views
- Visible per-repo `canopytag/` metadata folder
- CLI: `init`, `stats`, `ls`, `query`, `context`, `compare`, `todos`, `health`,
  `analytics`, `coverage`, `mcp`, and `hook`
- MCP read/write tools for agent integration
- Agent activity/review feed in `agent_manifest.json`
- Local human profile in ignored `profile.local.json`
- Claude Code analytics hook for read/edit/search heat
- `forest_repo_demo` bundled demo repo
- CanopyTag dogfooding metadata in this repo's `canopytag/canopy.json`

## Before A Public Release

- Decide whether `package.json` should remain `"private": true` or prepare npm
  publishing metadata.
- Add a small screenshot or GIF to the README once the preferred visual is
  settled.
- Keep package dry-runs clean: no local screenshots, profiles, analytics,
  workspaces, or test outputs.
- Validate setup on a clean machine: clone, `npm install`, `npm link`,
  `npm run dev`, `canopytag init`, `canopytag mcp`, and `canopytag compare`.
- Keep `AGENTS.md`, README, and CLI cheatsheet aligned with current commands.
- Keep repo-local metadata discoverable for agents: visible `canopytag/`, clear
  `AGENTS.md` guidance, and one-command MCP setup.

## Near-Term Product Work

- Add a persisted manual `Stale` override/editor if the freshness workflow needs
  a human-confirmed stale state beyond `Review Drift`.
- Continue graph hardening on larger real repos: dense labels, edge priority,
  cluster heuristics, and saved graph presets only if repeated workflows emerge.
- Improve Activity review ergonomics for high-speed human review of agent writes.
- Add saved table filters if real workflows repeat often enough.
- Keep score/authority education clear in the UI so authority is understood as
  conflict precedence, not just a documentation label.
- Consider explicit `gotchas` or surprise annotations only if comments and tags
  do not cover expectation mismatches well enough.

## Agent Navigation Ideas

- Derive recommended reading order from relation types before adding a new field.
  A likely sequence is canon/spec docs, blueprints, implementation, tests, then
  changelogs or update notes.
- Consider explicit `reading_order` only if relation-derived order is not enough.
- Explore target scores separately from current quality scores if score inflation
  or aspiration-vs-reality confusion persists.
- Use `canopytag compare` as the basic trust arbiter before inventing a heavier
  scoring system.
- Explore weighted search/ranking only after `query`, `context`, and `compare`
  reveal a concrete navigation gap.

## Analytics And Benchmarking

- Keep query/context/compare telemetry lightweight and private.
- Improve analytics only where it changes human or agent decisions.
- Build a repeatable benchmark that compares agent navigation with and without
  CanopyTag metadata: files read, wrong turns, time-to-answer, and correctness.
- Use the demo repo or another purpose-built repo as the first benchmark target.

## Multi-Repo And Ecosystem

- Design workspace-level config that lists multiple target repo roots.
- Let future CLI/MCP queries prefix results with repo name when spanning roots.
- Keep each repo's own `canopytag/` as source of truth; avoid a central metadata
  store unless a real workflow forces it.

## Structural Data And Cartography

CanopyTag answers "what does this mean?" Structural tools answer "what depends
on what?" They should stay complementary.

Possible paths:

- Keep CanopyTag knowledge-only and accept structural data from optional tools.
- Add import/test/dependency ingestion as an optional plugin or command.
- Keep richer cartography outside the core until usage proves it belongs inside.

The key principle: CanopyTag should accept useful dependency information without
becoming a language-specific parser.

## Design Principles To Preserve

- Agent-readable output is a first-class feature.
- Compact summaries should supplement source reading, not replace it.
- Authority is declared hierarchy; scores validate quality.
- A well-connected relationship graph can reduce the need for fancy search
  ranking.
- External metadata should not modify source files.
- Annotation work should compound: each good entry makes future sessions faster.
- CanopyTag should complement existing docs such as `ARCHITECTURE.md`,
  CODEOWNERS, and ADRs rather than replacing them.
