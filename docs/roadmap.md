# CanopyTag Roadmap

This is the public roadmap and idea backlog. It keeps the useful parts of the
old internal TODO log without preserving every historical session note.

## Current Status

CanopyTag is prerelease but usable from source.

Working now:

- Web UI with Explorer, Table, Graph, Analytics, and Activity views
- Visible per-repo `canopytag/` metadata folder
- CLI: `init`, `stats`, `ls`, `query`, `context`, `compare`, `projects`, `todos`,
  `health`, `doctor`, `work`, `analytics`, `coverage`, `mcp`, and `hook`
- Local bounded catalogue search across authored CanopyTag metadata, with field
  boosts, prefix matching, conservative typo tolerance, composable filters, and
  visible match evidence in CLI/MCP query results
- MCP read/write tools for agent integration
- Thin project context linking intent, features, files, project-owned TODOs,
  and reviewable activity without adding board/sprint machinery
- Agent activity/review feed in `agent_manifest.json`
- Read-only `doctor` checks for objective maintenance hazards, with bounded
  text/JSON output and optional strict exit behavior
- Read-only lifecycle marks with due/expired derivation and warnings in
  `context`, `compare`, and `health`
- Local human profile in ignored `profile.local.json`
- Claude Code analytics hook for read/edit/search heat, with automatic wildcard
  ignore protection and fail-open query tracking
- Local, expiring advisory work claims with file/directory overlap checks, TODO
  links, CLI/MCP check-in, renewal, and release
- `forest_repo_demo` bundled demo repo
- CanopyTag dogfooding metadata in this repo's `canopytag/canopy.json`

## Before A Public Release

- Decide whether `package.json` should remain `"private": true` or prepare npm
  publishing metadata.
- Add a small screenshot or GIF to the README once the preferred visual is
  settled.
- Keep package dry-runs clean: no local screenshots, profiles, analytics,
  active-work state, workspaces, or test outputs.
- Keep public-repo hygiene clear: shared `canopytag/` metadata should be
  reviewable, while `.mcp.json`, `.claude/settings.json`, profiles, analytics,
  active-work state, and local paths stay uncommitted or explicitly reviewed.
- Validate setup on a clean machine: clone, `npm install`, `npm link`,
  `npm run dev`, `canopytag init`, `canopytag mcp`, and `canopytag compare`.
- Keep `AGENTS.md`, README, and CLI cheatsheet aligned with current commands.
- Keep repo-local metadata discoverable for agents: visible `canopytag/`, clear
  `AGENTS.md` guidance, and one-command MCP setup.

## Near-Term Product Work

- Dogfood active-work claims in real concurrent sessions. Keep them separate
  from heat and persistent TODO state; add Beads/task-system adapters only if a
  repeated durable coordination workflow justifies them.
- If concurrent work across separate Git worktrees becomes routine, evaluate an
  explicit shared-store or coordinator adapter; the default checkout-local
  sidecar intentionally does not pretend to coordinate across worktrees.
- Add a persisted manual `Stale` override/editor if the freshness workflow needs
  a human-confirmed stale state beyond `Review Drift`.
- Complete the staged [document lifecycle marks](./design/document-lifecycle-marks.md)
  workflow with filters, reviewed writes/promotion, and UI support. The first
  read-only warning slice is implemented.
- Continue graph hardening on larger real repos: dense labels, edge priority,
  cluster heuristics, and saved graph presets only if repeated workflows emerge.
- Improve Activity review ergonomics for high-speed human review of agent writes.
- Dogfood the project CLI/MCP core before deciding whether a bounded project
  lane/detail panel earns UI space. Keep inherited project TODOs out of file
  badge counts and keep completed project archival deferred until usage is clear.
- If agents need to complete or revise TODOs through MCP, add one reviewed,
  scope-aware update contract for both file and project TODOs; do not hide TODO
  lifecycle mutation inside whole-project array replacement.
- Add saved table filters if real workflows repeat often enough.
- Keep score/authority education clear in the UI so authority is understood as
  conflict precedence, not just a documentation label.
- Consider explicit `gotchas` or surprise annotations only if comments and tags
  do not cover expectation mismatches well enough.

## Agent Navigation Ideas

Current measured priority order:

1. Treat the existing 23-query benchmark as consumed. Build a development set,
   then have an independent evaluator freeze and retain a separate holdout
   outside the public repo and outside the ranking implementer's tuning context.
   Record its hash, evaluator, category/count manifest, and evaluated commit;
   publish or rotate the holdout after its one-shot use.
2. Make reviewed tag aliases and canonical vocabulary participate in query
   normalization, while preserving the raw query and explaining expansions.
3. Improve multi-concept scoring and add explicit abstention or denial-evidence
   behavior instead of always filling the result limit.
4. Test bounded relationship-assisted reranking only after lexical changes have
   an ablation result; keep hops, closeness, relation types, and provenance
   visible.
5. Participate in a shared, provider-neutral interop envelope owned by the
   future router/Cartographer boundary. CanopyTag should emit authored semantic
   evidence; it should not quietly become the orchestrator for generated,
   exact-symbol, or optional semantic providers.

The calibrated 94-card catalogue reached 45.2% nDCG@10, 48.3% MRR@10, and
47.7% recall@10 on the consumed benchmark. It represented 51 of 54 judged
paths, so ranking and result composition now matter more than indiscriminate
card growth. An 8-9/10 claim requires a blind task benchmark showing lower
discovery cost and fewer wrong-file reads without a correctness regression.

- Derive recommended reading order from relation types before adding a new field.
  A likely sequence is canon/spec docs, blueprints, implementation, tests, then
  changelogs or update notes.
- Consider explicit `reading_order` only if relation-derived order is not enough.
- Explore target scores separately from current quality scores if score inflation
  or aspiration-vs-reality confusion persists.
- Use `canopytag compare` as the basic trust arbiter before inventing a heavier
  scoring system.
- Benchmark and tune the implemented catalogue ranking against real navigation
  tasks. Consider embeddings or semantic expansion only if measured misses
  remain after authored terminology and field weighting are improved.
- Build successor development queries for terminology absent from older
  annotations, and let an independent evaluator retain a hidden holdout. Test
  ephemeral query nodes and generated candidate edges without mutating authored
  relationships.
- If embeddings earn their place, build them from small CanopyTag cards, open
  work/review items, and opted-in document sections; keep the local index and
  inferred clusters replaceable, fingerprinted, and non-authoritative. See the
  [Cartographer integration design](./design/canopy-cartographer-integration.md).

## Analytics And Benchmarking

- Keep query/context/compare telemetry lightweight and private.
- Evaluate active-work usefulness by avoided overlap, abandoned-claim rate, and
  claim/release friction. Do not inflate attention heat merely because a path
  was claimed.
- Improve analytics only where it changes human or agent decisions.
- Build a repeatable benchmark that compares agent navigation with and without
  CanopyTag metadata: files read, wrong turns, time-to-answer, and correctness.
- Use the demo repo for deterministic smoke and regression tests, not for an
  8-9/10 quality claim. Evaluate public/general-tool tasks separately from
  private project tasks so neither corpus leaks into the other's tuning loop.

## Multi-Repo And Ecosystem

- Design workspace-level config that lists multiple target repo roots.
- Let future CLI/MCP queries prefix results with repo name when spanning roots.
- Keep each repo's own `canopytag/` as source of truth; avoid a central metadata
  store unless a real workflow forces it.

## Structural Data And Cartography

CanopyTag answers "what does this mean?" Structural tools answer "what depends
on what?" They should stay complementary.

See [CanopyCartographer integration](./design/canopy-cartographer-integration.md)
for the proposed Canopy Suite split: CanopyTag remains the crafted semantic
truth layer, while CanopyCartographer becomes the generated map layer that emits
sidecar artifacts, adapter output, semantic recall, rankings, and suggestions.

Possible paths:

- Keep CanopyTag knowledge-only and accept structural data from optional tools.
- Add import/test/dependency ingestion as an optional plugin or command.
- Keep richer cartography outside the core until usage proves it belongs inside.
- Read generated cartography sidecars from a standalone CanopyCartographer
  rather than merging generated structure directly into `canopy.json`.

The key principle: CanopyTag should accept useful dependency information without
becoming a language-specific parser.

## Design Principles To Preserve

- Agent-readable output is a first-class feature.
- Compact summaries should supplement source reading, not replace it.
- Authority is declared hierarchy; scores validate quality.
- A well-connected relationship graph complements catalogue search; neither
  should impersonate source-level structural truth.
- CanopyTag owns canonical feature IDs, descriptions, canonical files, and
  reviewed membership. Generated structural providers may propose aliases or
  membership, but cannot silently redefine the authored taxonomy.
- External metadata should not modify source files.
- Active-work claims expose ephemeral editing intent; they do not schedule
  agents, enforce file locks, or own a durable dependency graph.
- Annotation work should compound: each good entry makes future sessions faster.
- CanopyTag should complement existing docs such as `ARCHITECTURE.md`,
  CODEOWNERS, and ADRs rather than replacing them.
