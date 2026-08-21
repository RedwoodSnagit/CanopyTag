# Project Layer

**Date:** 2026-08-17
**Status:** thin CLI/MCP V1 implemented 2026-08-20; expanded control-plane
target and handoff accepted 2026-08-20; UI/API work pending
**Scope:** preserve the small implemented project umbrella while growing it
into a human- and agent-usable project context graph: tasks, dependencies,
milestones, resources, documentation, tools, attribution, and evidence

## Summary

CanopyTag began as file annotation. TODOs, comments, activity entries, scores,
and tags were all keyed by a file path. That remains the right primary key for
navigation and most annotations.

Before this layer, work that spanned files had nowhere honest to live.
`canopytag_add_todo` required `file`, so a TODO like "integrate Ride Parameter
Estimator V5 into Ride Analysis" had to be parked on an arbitrary pipeline file
or omitted. `AgentManifestEntry.file` had the same constraint, scattering the
record of a multi-file change across paths with nothing tying it together.

The implemented core adds `Project` as a top-level record that **links** to
features and files and may own TODOs whose natural scope is the multi-file body
of work. It does not take ownership of linked feature or file records and does
not move existing file TODOs.

That thin layer is a safe V1, not the final product boundary. Real dogfooding on
BikeCRT showed that a project must eventually connect its objective to the
ordered work, dependencies, milestones, tools, documentation, data/resources,
owners, agents, review, and completion evidence needed to carry it out. A fresh
agent should be able to open one project packet, know what is ready, and produce
an accountable handoff without reconstructing the surrounding conversation.

CanopyTag should provide that authored context and accountability spine. It
does not need to become a monolithic scheduler, execute agents, replace Git, or
copy every generated code edge into authored metadata. External task engines
and structural mappers may be adapters or overlays when they earn their place.

## Product boundary

The goal is **not** feature parity with Jira, Linear, Plane, or an autonomous
agent factory. It is enough project structure to preserve why work exists, how
it can proceed, and what evidence makes it complete.

In scope for the target layer:

- projects with explicit outcomes and accepted scope;
- tasks with stable IDs, status, ownership/claims, acceptance evidence, and
  typed dependency edges;
- milestones or timeline anchors when they convey a real constraint;
- typed resources: files, documentation, tools/procedures, data/artifacts,
  validation commands, and expected outputs;
- attribution and accountability from actor through action, review, and receipt;
- project, dependency, production-surface, and focused structural views for
  humans and compact context packets for agents;
- optional adapters to task systems and generated structural providers.

Still out of scope by default:

- payroll, capacity planning, notifications, chat, or enterprise permissions;
- treating estimates and due dates as mandatory fields;
- silently scheduling or dispatching agents;
- treating popularity, heat, or generated topology as authored product truth;
- ingesting every repository file into the rich annotation catalogue.

The existing project schema remains backward compatible while this target is
designed and implemented in bounded slices.

## Ontology

The vocabulary matters because two of these already exist and were being
conflated in earlier drafts.

| Concept | Meaning | Example | Status |
|---|---|---|---|
| **Feature** | A user-facing capability of the product | "Ride Analysis" | Exists, unchanged |
| **Project** | A body of work advancing one or more features | "Integrate Ride Parameter Estimator V5" | **New** |
| **Task / TODO** | A unit of work, future-focused | "Elliptical wind direction estimator passes a synthetic test" | Exists as `Todo`, gains a second home |
| **Action** | A record of what happened | `AgentManifestEntry` | Exists, gains an optional project link |
| **File** | The *where* — a location work touches | `bikecrt_core/physics/…` | Exists, unchanged |

`Feature.description` answers *what the user gets*. `Project.description`
answers *why we are doing this work*. These are different questions that
currently compete for one field, which is why "why" has been the weakest
dimension in the schema.

A project is not a feature and does not nest under one. A project **advances**
features, possibly several, and may also carry work (API, connectivity,
infrastructure) that maps to no feature at all.

## Target project packet

The durable handoff unit is a project packet, not an isolated description or a
pile of file TODOs.

```text
Product surface / objective
            |
         Project
       /     |       \
    Tasks  Milestones  Resources
      |        |       |- files and components
      |- blocks        |- canonical documentation
      |- depends_on    |- tools and procedures
      |- assigned_to   |- data and artifact keys
      |- acceptance    |- validation commands
      |                `- expected outputs
      `- actions and evidence
         |- actor/model/session
         |- claim and owned paths
         |- commit/change record
         |- tests, receipts, plots, or review
         `- accepted/fixed/rejected judgment
```

The minimum target entities are `Project`, `Task`, `ResourceRef`, `Milestone`,
and `ActionReceipt`; existing `Feature`, file records, `Author`, and manifest
actions remain reusable nodes. Prefer typed references and edges over adding
dozens of nullable properties to every record.

### Task readiness and timeline

Task dependencies should support at least `blocks`, `depends_on`,
`parent_child`, and `related`. Readiness is computed: a task is ready when its
required predecessors and decisions are satisfied and it is not actively
claimed elsewhere. A timeline is a view over dependency order, milestones,
optional estimates/dates, and actual actions. It must not require invented due
dates merely to draw a chart.

Each task should be self-contained enough for a fresh agent to execute or to
identify the exact missing decision. Required semantics are:

- objective and why now;
- status and priority;
- acceptance evidence;
- dependencies and blockers;
- owned paths and intentional exclusions when code work is involved;
- relevant resources and tools;
- accountable owner, current claimant, and reviewer where applicable;
- action/commit/test receipts and residual risk at completion.

### Resources are first-class references

A project should not rely on prose to hide the materials needed to perform it.
Resource references need a type and role, for example:

- `documentation` / `governs`;
- `file` or `component` / `implements`;
- `tool` or `procedure` / `use_for`;
- `dataset` or `artifact` / `input`;
- `command` or `test` / `validates`;
- `output` / `must_produce`.

Private or machine-local resources use logical keys and storage roles, never
committed workstation paths or copied sensitive bytes.

## Schema

### New: `Project`

```ts
export type ProjectStatus = 'active' | 'paused' | 'done';

export interface Project {
  id: string;                 // PRJ-001, stable, assigned on create
  name: string;
  description?: string;       // the WHY — why this work exists
  status?: ProjectStatus;     // default: 'active'
  owners?: Author[];
  featureIds?: string[];      // features this project advances
  files?: string[];           // repo-relative paths this project implicates
  todos?: Todo[];             // project-level TODOs with no natural file home
  openQuestions?: string[];
  createdAt: string;          // ISO-8601 UTC
  createdBy: Author;
  completedAt?: string;       // set when status → done
}
```

### Changed: `Canopy`

```ts
export interface Canopy {
  version: number;
  repoRoot: string;
  lastModifiedAt: string;
  agentNotes?: AgentNote[];
  files: Record<string, FileCanopy>;
  directories?: Record<string, DirectorySummary>;
  features: Record<string, Feature>;
  projects?: Record<string, Project>;   // NEW — keyed by project id
}
```

### Changed: `AgentManifestEntry`

```ts
projectId?: string;   // NEW — optional, links an action to a project
```

Manifest entries now require a meaningful subject in practice: a file-scoped
write records `file`, while a project-scoped write records `projectId`. `file`
is optional in the TypeScript schema so a project-owned TODO or project edit
does not need a fabricated representative path.

Nothing else changes. `FileCanopy`, `Todo`, `Feature`, `Comment`, and the tree
walker are untouched.

## Linkage Model

**Projects hold the references.** A project lists its `files[]`, `featureIds[]`,
and its own `todos[]`. Files do not carry a `projectId`.

Rationale: project membership is a property of the work, not of the file. A file
can be pulled into and dropped from a project without the file record changing.
It also keeps a project's scope legible in one place, which is what makes it
useful as a link to follow.

The cost is that "which projects touch this file?" requires scanning
`Object.values(canopy.projects)`. At realistic scale — dozens of projects
against a few hundred annotated files — this is a trivial in-memory filter, and
it happens on an already-loaded object.

### Inheritance is a view concern

A file's detail panel shows:

1. Its own `todos` (editable, as today).
2. TODOs from any project whose `files[]` includes that path — displayed
   read-only and visually distinct, with the project name as a follow-able link.

Nothing is copied, denormalized, or synced. Inheritance is a lookup at render
time. This is the whole reason the link direction above is safe: there is no
second copy to drift.

Tree badge counts continue to reflect only file-owned TODOs. Rolling inherited
TODOs into badge counts would make a single project TODO inflate the count of
every file it implicates, which is misleading. Revisit only if it proves wanted
in practice.

## Production surfaces and meaningful coverage

Whole-repository rich-annotation percentage is not a product-quality score.
Large repositories contain generated files, caches, vendored dependencies,
experiments, fixtures, compatibility shims, archives, and ordinary helpers that
do not all deserve authored cards.

CanopyTag needs named, reviewable scope sets such as:

- `production_candidate`;
- `alpha_critical`;
- `supported_research`;
- `experimental_inventory`.

A scope set identifies the components, entrypoints, canonical documents, tests,
and resources whose routing context should be complete for that purpose.
Coverage is then reported per scope, with whole-repo annotation only as a
neutral inventory statistic. A production report should be able to say, for
example, `92/104 production-candidate targets annotated`, not imply that
unannotated caches or ordinary helpers are debt.

Generated providers may propose membership. A Cartographer adapter can start
from trusted UI/API/engine entrypoints and discover structural dependencies;
exact-symbol tools can explain a focused path. Human review promotes the useful
candidate set into authored scope. Generated membership must carry provider,
artifact fingerprint, and freshness and cannot silently redefine the set.

Directory cards that intentionally summarize a production surface are not
orphans merely because their key is not a regular file. Coverage and doctor
must distinguish supported directory subjects from missing paths.

## Query and Navigation

This is where the layer earns its place for agents.

**Queryable.** `canopytag_query` has a `project` filter, accepting a project id
or a unique name substring. Direct results are the project's `files[]`; normal
detail-level relationship traversal may add connected files. The project's
`description` and `openQuestions` are included in the response header so an
agent gets the *why* without a second call.

**A link to follow, in both directions:**

- From a project → its features, files, TODOs, and (via `projectId`) the actions
  taken against it.
- From a file → the projects that implicate it, surfaced in `canopytag_context`
  and in the file detail panel.

`canopytag_context` for a file gains a `projects` section, listing each project
that includes the file along with its description and open questions. This is
context an agent cannot reconstruct from `grep`: the file itself contains no
evidence of the body of work it belongs to.

## MCP Surface

```
canopytag_projects        list/filter projects (read)
canopytag_project         full detail for one project: features, files,
                          TODOs, recent actions (read)
canopytag_add_project     create a project (write)
canopytag_update_project  edit fields; replace file/feature link lists (write)
```

Changes to existing tools:

- `canopytag_add_todo` — `file` becomes optional when a project is supplied.
  Exactly one of `file` or `project` is required; supplying both or neither is
  an error, because a TODO has one home and inheritance handles the rest. The
  separate directory proposal has not been folded into this shipped contract.
- `canopytag_query` — gains `project` filter.
- `canopytag_context` — gains a `projects` section for file lookups.

This slice creates project-owned TODOs but does not invent a project-only status
mutation tool. CanopyTag has no general MCP TODO-update tool today; project TODO
status changes therefore remain an intentional metadata edit until a reviewed,
scope-aware TODO update contract is designed for both file and project owners.

Project writes go through the same agent manifest review path as every other
agent write. Rejection is guarded: if a project field changed after the
reviewed write, CanopyTag stops rather than clobbering the later value.

## Attribution (prerequisite)

Project records are worthless if every `createdBy` reads `"agent"`.

`resolveAgentAuthor()` in `src/mcp/tools/writes.ts` already resolves a name from,
in order: the `agent_name` tool argument, `CANOPYTAG_AGENT_NAME`,
`MCP_CLIENT_NAME`, then the literal fallback `'agent'`. The `AuthorSignature`
type already carries `{ role, name, session }`. The mechanism is sound; nothing
populates it. All 32 manifest entries in the BikeCRT working repo fell through
to `'agent'`.

**Status: implemented 2026-08-17.** What shipped:

1. `agent_name` is **required** in the authored-metadata write schemas, described
   as model identity — `"Claude Opus 5"`, `"ChatGPT 5.6 Sol"` — explicitly not a
   role word. Required rather than env-driven because the calling model is the
   only party that reliably knows which model it is; a config can be reused by a
   different model than the one it names. Left optional on active-work claims,
   which are ephemeral local coordination rather than durable record, and whose
   renew/release flow matches on session rather than name.
2. `resolveAgentAuthor()` no longer falls back to the string `'agent'`. Role
   words resolve to `UNATTRIBUTED_AGENT_NAME`, so a missing attribution stops
   looking like a real one. `isUnattributedAgentName()` and
   `isUnattributedAgent()` in `shared/types.ts` are the shared predicate.
3. `canopytag mcp --agent-name "<model>"` pins `CANOPYTAG_AGENT_NAME` in the
   generated `.mcp.json` env block. Not written by default: the per-call
   argument is the accurate source, and this exists for clients that cannot pass
   tool arguments.
4. `canopytag doctor` reports code `unattributed-agent`, aggregated across the
   repo rather than one finding per record — hundreds of identical findings
   would crowd out every other check.

Measured against the BikeCRT working repo on implementation: **34 agent-authored
records across 24 files** carry no model identity, against 20 that do
(`claude-opus`, `claude-opus-5`, `codex`, `gpt-5-codex`). The aggregate finding
sorts below per-file `review-drift` warnings and is therefore hidden at the
default `--limit 50`. Whether repo-level findings should outrank per-file ones
in doctor's sort order is left open rather than changed unilaterally.

The human side already works correctly via `profile.local.json` and needs no
change. This is specifically an agent-side gap.

Accountability, not just attribution: the manifest already models
`status: pending → agreed | fixed | rejected` with `reviewer`, `reviewedAt`, and
`reviewNote`. That loop is built and entirely unused — every BikeCRT entry is
`pending`. Model identity is what makes the loop worth running, because
"which model produced work I later had to fix" is only answerable once the name
is real.

## Required HTTP API and human surface

The CLI/MCP-only implementation is insufficient for a system intended to align
humans and agents. The frontend HTTP client and workspace store do not currently
load projects, so the UI cannot show project TODOs or context even though the
CLI can. API parity is the first implementation gate.

Minimum coherent human surface:

- **Projects lane** alongside Files / Scores / TODOs / Activity, with status,
  readiness, blocked/ready counts, milestones, owners/claimants, and recent
  evidence.
- **Project detail** for outcome, questions/decisions, tasks, dependency flow,
  milestones, resources, files/features, activity, and completion evidence.
- **Task detail or drawer** with bounded text, acceptance criteria, dependencies,
  resources, actor/reviewer, and receipts. Large task descriptions must not
  expand every table row to full length.
- **File detail `Implicated in` section** with linked projects and inherited
  read-only project tasks, including when the file has no rich file annotation.
- **Count and filter parity** across CLI, MCP, HTTP API, and UI. Project tasks
  cannot disappear from a human TODO count.
- **Safe mutation** with visible save state and confirmation or recoverable undo
  for deletion and relationship changes.

The file tree remains useful for known-path navigation, but a project-centric
view is now required rather than forbidden. Humans should not need to start from
a filename when the question is "what work is ready and why?"

## Visualization and structural overlays

One force-directed graph cannot simultaneously explain projects, dependencies,
product architecture, files, exact symbols, and activity. CanopyTag should offer
purposeful saved views with explicit layers:

1. **Work graph:** projects, tasks, milestones, dependencies, readiness.
2. **Product graph:** production scopes, features, components, UI/API/engine
   boundaries, and canonical documents.
3. **Resource graph:** tasks to files, tools, procedures, data, tests, outputs.
4. **Structural overlay:** provenance-bearing Cartographer or exact-symbol edges.
5. **Accountability overlay:** claims, actors, actions, reviews, and receipts.

Use human-preserved spatial layouts, directed dependency flow, cards, groups,
and labeled edges where they improve comprehension. Obsidian-style canvases are
a useful interaction reference; dependency-aware agent trackers, software
catalogues, and human PM systems are reference patterns rather than automatic
dependencies. Every generated edge needs an explanation and provenance, and
every saved view needs a bounded question it answers.

## Validation and Doctor Checks

- `readCanopy()` validates `projects` shape as it does other top-level keys.
- Referential integrity: warn on `featureIds` and `files[]` entries that do not
  resolve. Warn, not error — a file may be deleted while the project record is
  still meaningful history.
- `doctor` flags malformed projects, key/ID mismatches, missing file/feature
  references, duplicate IDs across file/project TODO scopes, empty umbrellas,
  completion timestamp inconsistencies, and unattributed agent records.
- Inactivity is not inferred yet. A deterministic "no activity in N days"
  check needs an explicit activity contract instead of guessing from unrelated
  file timestamps.

## Migration

None required. The change is purely additive: `projects` is optional, and a
canopy file without it is valid and behaves exactly as today. Existing
file-bound TODOs are not touched, moved, or rewritten.

## Migration and open design decisions

**Task storage.** The target requirements now justify evaluating a top-level
task collection referenced by projects and optional file/resource subjects.
Do not migrate existing TODOs until round-trip compatibility, stable IDs,
archive behavior, and guarded manifest undo are designed. File TODOs may remain
a lightweight annotation subtype if forcing every note into the project graph
would add friction.

**Project relations.** Typed project-to-project relations are useful for
`blocks`, `supports`, and `part_of`; unrestricted hierarchy is not required.
Task dependency graphs carry the operational ordering. Avoid deep nesting whose
only purpose is to mimic an enterprise tracker.

**History.** Completed projects, tasks, actions, and evidence are valuable
accountability records. Prefer retained, filterable history to destructive
sweeping. Any archive must use a real project/task subject rather than a fake
file path such as `project:PRJ-001`.

**External task engine.** Beads-like local dependency engines and Plane-like
human PM systems are candidates for adapters or comparative spikes. No external
system becomes authoritative merely because it has a mature UI. Require stable
export, local/private operation, API access, backups, actor attribution, and an
honest mapping to CanopyTag project/task/resource IDs.

**Canvas persistence.** Decide whether saved human layouts are CanopyTag-owned
views or interoperable JSON Canvas-style artifacts. Layout is a view; it must
not become a second source of project truth.

## Implementation Phases

1. **Attribution fix — implemented.** Meaningful `createdBy` is required for
   durable agent writes.
2. **Schema and persistence — implemented.** `Project`, optional
   `Canopy.projects`, snake/camel round trips, and ID allocation include project
   TODOs.
3. **CLI/MCP reads — implemented.** `projects`, `project`, project filters on
   `query`, project context, inherited read-only TODOs, and aggregate TODO scope.
4. **MCP writes/review — implemented.** Create/update, project-owned TODOs,
   manifest subjects, guarded undo. General TODO status mutation remains
   deferred rather than being hidden inside whole-project replacement.
5. **Doctor checks — implemented for deterministic integrity.**
6. **V1 UI — missing and now required.** Add HTTP API/store parity, project
   lane/detail, file backlinks, inherited project tasks, and count parity.
7. **Production scopes.** Define generic scope-set schema and coverage behavior;
   dogfood a reviewed production-candidate manifest in a large downstream repo.
8. **Task/dependency/resource design.** Freeze a minimal target schema with
   backward-compatible migration and deterministic readiness/doctor checks.
9. **Project execution UI.** Add task/resource/evidence views and one directed
   dependency/timeline view with saved human layout.
10. **Structural overlays.** Prototype one provenance-bearing generated overlay
    without copying structural truth into authored metadata.
11. **Comparative spike.** Reproduce one project in selected external reference
    tools and record what should be adopted, adapted, or rejected before adding
    broader PM machinery.

The shipped V1 remains useful for agent routing, but it is not a complete human
handoff surface and must not be described as the final project boundary.

## Fresh-agent handoff

Start here and run `canopytag projects PRJ-001` before editing. Preserve the
implemented V1 and advance one bounded slice; do not attempt the entire control
plane in one change.

Recommended next packet:

- **Objective:** make the existing project records visible and truthful in the
  HTTP API and UI before expanding the persisted schema.
- **Owned paths:** project HTTP routes, frontend API/store, Table project lane,
  project detail, file project backlinks, focused tests, and this design doc.
- **Intentional exclusions:** no agent dispatch, no external PM installation,
  no structural-graph ingestion, no deletion or migration of file TODOs, and no
  downstream product-source edits.
- **Acceptance:** all project files remain visible even without rich file cards;
  CLI/MCP/API/UI project and open-task counts agree; a human can open a project,
  follow every file, read its question/task, and see project context from a
  linked file; deletion remains recoverable or explicitly confirmed.
- **Downstream dogfood:** use a large repo with declared project records to
  verify scale, but keep downstream-specific taxonomy outside generic code.

The following packet should define production scope sets and meaningful
coverage. Task/dependency schema work follows after those two V1 usability gaps
are evidenced, so the existing tool remains usable throughout the migration.
