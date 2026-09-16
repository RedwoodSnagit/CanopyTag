# Project Layer

**Date:** 2026-08-17
**Status:** thin CLI/MCP V1 implemented 2026-08-20; HTTP/UI parity, authored
production scopes, and the backward-compatible task execution packet implemented
2026-08-21; bounded directed project visualization and the external-pattern
comparison implemented 2026-08-25
**Scope:** preserve the small implemented project umbrella while growing it
into a human- and agent-usable project context graph: tasks, dependencies,
milestones, resources, documentation, tools, attribution, and evidence

## Summary

CanopyTag began as file annotation. TODOs, comments, activity entries, scores,
and tags were all keyed by a file path. That remains the right primary key for
navigation and most annotations.

Before this layer, work that spanned files had nowhere honest to live.
`canopytag_add_todo` required `file`, so a TODO like "integrate Ranking Model
V5 into Search Ranking" had to be parked on an arbitrary pipeline file
or omitted. `AgentManifestEntry.file` had the same constraint, scattering the
record of a multi-file change across paths with nothing tying it together.

The implemented core adds `Project` as a top-level record that **links** to
features and files and may own TODOs whose natural scope is the multi-file body
of work. It does not take ownership of linked feature or file records and does
not move existing file TODOs.

That thin layer is a safe V1, not the final product boundary. Real dogfooding
on a private working repo showed that a project must eventually connect its
objective to the ordered work, dependencies, milestones, tools,
documentation, data/resources, owners, agents, review, and completion
evidence needed to carry it out. A fresh
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
| **Feature** | A user-facing capability of the product | "Search Ranking" | Exists, unchanged |
| **Project** | A body of work advancing one or more features | "Integrate Ranking Model V5" | **New** |
| **Task / TODO** | A unit of work, future-focused | "Tie-break scorer passes a synthetic test" | Exists as `Todo`, gains a second home |
| **Action** | A record of what happened | `AgentManifestEntry` | Exists, gains an optional project link |
| **File** | The *where* — a location work touches | `core/ranking/…` | Exists, unchanged |

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
  todos?: Task[];             // project TODOs; rich execution fields are additive
  milestones?: Milestone[];   // optional real timeline anchors, never required dates
  openQuestions?: string[];
  createdAt: string;          // ISO-8601 UTC
  createdBy: Author;
  completedAt?: string;       // set when status → done
}
```

### RT-015: project-only task execution packet

RT-015 keeps the existing storage and count contract: `Project.todos` remains
the single project-owned work collection, but its element type is now `Task`, a
strictly additive subtype of `Todo`. Every legacy project TODO is therefore a
valid task, every file-owned TODO remains the lightweight `Todo` type, and no
record is moved or duplicated.

Three storage shapes were evaluated:

1. adding execution fields to every `Todo`, rejected because ordinary file
   notes would inherit project workflow machinery and ambiguous archive rules;
2. a top-level normalized task graph, deferred because it requires two-record
   transactions, orphan handling, guarded undo, and a migration before one
   project has demonstrated the need;
3. the accepted project-only subtype, which preserves current CLI/MCP/API/UI
   counts and writes while giving project handoffs a typed execution packet.

The accepted camelCase TypeScript contract is below. Disk keys remain
snake_case and enum values remain unchanged.

```ts
type TaskDependencyType = 'blocks' | 'depends_on' | 'parent_child' | 'related';

interface TaskDependency {
  type: TaskDependencyType;
  taskId: string;
  reason?: string;
}

type ResourceKind =
  | 'file' | 'component' | 'documentation'
  | 'tool' | 'procedure'
  | 'dataset' | 'artifact'
  | 'command' | 'test' | 'output';

type ResourceRole =
  | 'implements' | 'governs' | 'use_for'
  | 'input' | 'validates' | 'must_produce' | 'reference';

interface ResourceRef {
  kind: ResourceKind;
  role: ResourceRole;
  ref: string;       // repo-relative path, command, tool name, or logical key
  label?: string;
}

interface ActionReceipt {
  id: string;
  kind: 'change' | 'commit' | 'validation' | 'output' | 'review' | 'decision';
  outcome: 'recorded' | 'passed' | 'failed' | 'accepted' | 'rejected';
  summary: string;
  actor: Author;
  recordedAt: string;
  resources?: ResourceRef[];
  residualRisk?: string;
}

interface Task extends Todo {
  whyNow?: string;
  acceptance?: string[];          // expected evidence, not a boolean checkbox
  dependencies?: TaskDependency[];
  milestoneId?: string;
  owners?: Author[];
  reviewers?: Author[];
  openQuestions?: string[];       // unresolved required decisions
  ownedPaths?: string[];          // repo-relative edit responsibility
  excludedPaths?: string[];       // intentional non-goals for safe handoff
  resources?: ResourceRef[];
  receipts?: ActionReceipt[];     // retained actual evidence
  residualRisks?: string[];
}

interface Milestone {
  id: string;
  name: string;
  description?: string;
  targetAt?: string;              // optional; never invented to draw a chart
  completedAt?: string;
}
```

Dependency direction is explicit. `A depends_on B` means B must be done before
A is ready. `A blocks B` expresses the same prerequisite from A's side.
`parent_child` and `related` add structure without changing readiness. Missing
references, self-edges, and cycles in the blocking subgraph are deterministic
doctor errors.

Readiness is a projection, never persisted state:

- authored `done`, `deferred`, and `in_progress` remain those states;
- an open task with an unsatisfied `depends_on`/incoming `blocks` edge, required
  decision, invalid reference, or blocking cycle is `blocked`;
- otherwise, an open task whose `ownedPaths` overlap a live local active-work
  claim is `claimed` and names the claimant/expiry;
- every other open task is `ready`.

This keeps durable intent in `canopy.json`, expiring coordination in
`.active_work.json`, and actual completion evidence in task receipts. Resource
refs use logical keys for private or machine-local material; they never make
absolute workstation paths portable metadata.

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
  projects?: Record<string, Project>;   // keyed by project id
  scopeSets?: Record<string, ScopeSet>; // authored purpose-specific coverage
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

RT-014 implements that boundary with this additive schema (snake_case on disk):

```ts
type ScopeSubjectKind = 'file' | 'directory';
type ScopeMemberRole =
  | 'component'
  | 'entrypoint'
  | 'canonical_document'
  | 'test'
  | 'resource';

interface ScopeSetMember {
  path: string;
  kind: ScopeSubjectKind; // explicit so directories are never inferred as files
  role?: ScopeMemberRole;
}

interface ScopeSet {
  name: string;
  description?: string;
  members: ScopeSetMember[]; // authored denominator
}
```

`canopytag coverage` lists all authored scope sets before the neutral repository
inventory. `canopytag coverage --scope <id>` and the MCP tool's `scope` argument
show the selected scope's file/directory counts, unannotated subjects, and
missing or wrong-kind subjects. A member counts as annotated only when the
subject exists with its declared kind and the corresponding `files` or
`directories` card exists.

Generated provider candidates use a separate optional
`canopytag/generated/scope-membership.json` artifact rather than a field inside
`canopy.json`. Version 1 requires `provider`, `artifact_fingerprint`,
`generated_at`, `fresh_until`, and explicit proposals containing
`scope_set_id`, path, and kind. Coverage labels each source fresh or stale,
shows its candidates separately, and never includes them in the authored
denominator. Promotion remains a future explicit review action; merely reading
a provider artifact cannot mutate the scope.

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
populates it. All 32 manifest entries in the working repo fell through
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

Measured against the working repo on implementation: **34 agent-authored
records across 24 files** carry no model identity, against 20 that do
(`claude-opus`, `claude-opus-5`, `codex`, `gpt-5-codex`). The aggregate finding
sorts below per-file `review-drift` warnings and is therefore hidden at the
default `--limit 50`. Whether repo-level findings should outrank per-file ones
in doctor's sort order is left open rather than changed unilaterally.

The human side already works correctly via `profile.local.json` and needs no
change. This is specifically an agent-side gap.

Accountability, not just attribution: the manifest already models
`status: pending → agreed | fixed | rejected` with `reviewer`, `reviewedAt`, and
`reviewNote`. That loop is built and entirely unused — every entry in that
repo is `pending`. Model identity is what makes the loop worth running, because
"which model produced work I later had to fix" is only answerable once the name
is real.

## Required HTTP API and human surface

The CLI/MCP-only implementation was insufficient for a system intended to align
humans and agents. **RT-013 implemented the first parity gate on 2026-08-21:**
the HTTP API and workspace store load count-bearing projects and complete detail
packets; the Table view has a Projects lane; project TODOs participate in the
aggregate TODO count; every linked path is visible even without a rich card;
and file detail resolves project backlinks and inherited read-only tasks.

Human project edits cover the existing thin card fields. Relationship removal
requires confirmation and sends the originally loaded file/feature lists as a
stale-write guard; deletion is deliberately not exposed. Project TODO lifecycle
remains read-only until one reviewed scope-aware mutation contract exists for
both file and project TODOs. RT-015 now projects computed readiness and compact,
expandable dependency/resource/evidence packets in the existing Projects tab;
task mutation and directed dependency visualization remain separate work.

Minimum coherent human surface:

- **Projects** remains a first-level global destination and a lane alongside
  Files / Scores / TODOs / Activity, with status, readiness, blocked/ready
  counts, milestones, owners/claimants, and recent evidence. Both entry points
  open the same project surface.
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

### RT-016: bounded directed project execution view

The existing Graph surface now has a **Project** mode for one project packet at
a time. It renders task cards in milestone swimlanes, places blocking
`depends_on` and `blocks` relationships as directed, labeled arrows, and keeps
non-blocking parent/related context visually subdued. Selecting a task expands
only that task's resources and retained receipts into a dedicated context lane,
so evidence remains inspectable without turning the surface into a generic
canvas or a task board.

Card positions save only in browser-local storage, keyed by repository and
project. They never write to `canopy.json` and therefore cannot become a second
project truth. Provider-backed structural edges have a separate long-dash style
and must include a provider name plus artifact fingerprint; no such artifact is
currently available, so the UI says so and draws no synthetic structural edge.
Task mutation and external-tool comparison remain outside this slice.

## Validation and Doctor Checks

- `readCanopy()` validates `projects` shape as it does other top-level keys.
- Referential integrity: warn on `featureIds` and `files[]` entries that do not
  resolve. Warn, not error — a file may be deleted while the project record is
  still meaningful history.
- `doctor` flags malformed projects, key/ID mismatches, missing file/feature
  references, duplicate IDs across file/project TODO scopes, empty umbrellas,
  completion timestamp inconsistencies, and unattributed agent records.
- Rich project tasks add deterministic checks for task/milestone identity,
  dependency references and cycles, safe owned/excluded paths, typed resources,
  receipt shape/attribution, and retained evidence on completed rich tasks.
- Inactivity is not inferred yet. A deterministic "no activity in N days"
  check needs an explicit activity contract instead of guessing from unrelated
  file timestamps.

## Migration

None required. The change is purely additive: `projects` is optional, every
existing project TODO satisfies `Task`, and a canopy file without rich fields
behaves exactly as today. Existing file-bound TODOs are not touched, moved, or
rewritten.

## Migration and open design decisions

**Task storage.** RT-015 deliberately keeps rich tasks inside `Project.todos`
as an additive `Task extends Todo` subtype. A top-level task collection remains
a future option only if cross-project tasks or adapters prove that two-record
transactions, orphan handling, stable global IDs, archive behavior, and guarded
undo are worth their cost. File TODOs remain the lightweight annotation type.

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

### RT-017: bounded external-pattern comparison

RT-017 completed one evidence-led comparison of `PRJ-001` against Beads,
Plane, Backstage, and JSON Canvas. The result is intentionally a boundary
decision, not an integration: retain CanopyTag's authored packet as truth;
adopt typed ready-work and authored-versus-derived patterns; adapt only a future
one-way JSON Canvas projection if real shared-layout use earns it; and reject
automatic foreign installs, task-engine replacement, bidirectional sync, and
external view state as project truth. The full evidence matrix, including
export, privacy, API, backup, and attribution gates, is in
[Project pattern comparison](./project-pattern-comparison.md).

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
6. **V1 UI — implemented.** HTTP API/store parity, project lane/detail, file
   backlinks, inherited project tasks, unannotated linked-file visibility,
   guarded relationship edits, and count parity shipped in RT-013.
7. **Production scopes — implemented in RT-014.** Generic authored scope sets,
   file/directory-aware coverage, deterministic doctor checks, CLI/MCP reads,
   non-counting provenance-bearing generated proposals, and a reviewed
   CanopyTag `production_candidate` manifest are shipped. Large downstream
   dogfooding remains optional and should not displace higher-priority repo work.
8. **Task/dependency/resource design — implemented in RT-015.** Additive rich
   project tasks, typed edges/resources/receipts, milestones, computed readiness
   with local claim context, deterministic doctor checks, CLI/MCP/API parity,
   and compact read-only packets in the existing Projects tab are shipped.
9. **Directed project execution UI — implemented in RT-016.** The existing
   Graph surface now provides a packet-scoped milestone flow with directed task
   arrows, selected-task resources/evidence, browser-local layouts, and an
   explicit no-provider structural-overlay state. A guarded task mutation
   surface remains a separate decision.
10. **Structural overlays.** Accept one provenance-bearing generated edge
    artifact without copying structural truth into authored metadata or
    substituting authored relationships for generated evidence.
11. **Comparative spike — implemented in RT-017.** The documented comparison
    confirms the native project packet and records export/privacy/API/backup/
    attribution gates for any future adapter. No external dependency or source
    of truth was introduced.

The shipped project packet is useful for human and agent routing and bounded
execution handoffs. It intentionally remains short of scheduling, task-board,
and autonomous dispatch machinery.

## Fresh-agent handoff

Start here and run `canopytag projects PRJ-001` before editing. Preserve the
implemented V1 and advance one bounded slice; do not attempt the entire control
plane in one change.

RT-017 is implemented. Before any future external adapter or shared-layout
export, start a new bounded packet and satisfy the comparison's mapping,
privacy, restore, API, attribution, review, and undo gates.

The Projects detail includes a direct handoff to the selected packet's Project
graph. When an active project has retained tasks but no open task, it reports
that all recorded work is complete and it is awaiting the next human decision;
this is deliberately not an automatic project-status mutation.
