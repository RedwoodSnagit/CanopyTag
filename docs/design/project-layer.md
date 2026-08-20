# Project Layer

**Date:** 2026-08-17
**Status:** CLI/MCP core implemented 2026-08-20; UI deferred
**Scope:** an additive project umbrella that links features, TODOs, and files,
plus the agent attribution fix it depends on

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
not move existing file TODOs. Projects are a queryable layer and a link to
follow, not a task tracker.

## Non-Goals

CanopyTag is annotation and context for agents at the level of the file and the
file tree. This proposal does not turn it into an issue tracker.

Specifically out of scope: sprints, assignees beyond the existing `Author`
model, due dates, burndown, boards, workflow states beyond a coarse project
status, notifications, and dependency graphs between tasks.

Also explicitly not done here: promoting `Todo` to its own top-level collection.
See "Deferred decisions".

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

## Deferred UI Surface

Minimum viable, consistent with the existing app:

- **Projects as a lane in the Table view**, alongside Files / Scores / TODOs /
  Activity. Columns: name, status, feature links, file count, open TODO count,
  owners, last activity.
- **Project detail panel** reusing the `FileDetail` layout conventions:
  description, open questions, linked features, linked files (each a link to
  follow into the tree), project TODOs, and recent actions.
- **File detail panel** gains an "Implicated in" section listing projects, and
  the read-only inherited TODOs described above.

Deliberately not proposed: a project-centric top-level view replacing the tree.
The tree stays the primary navigation surface.

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

## Deferred Decisions

**Promoting `Todo` to a top-level collection.** The clean end state is arguably
one `todos: Record<string, Todo>` with both files and projects referencing ids.
Deferred because `Todo` already carries stable ids, which makes that migration
cheap whenever it is wanted. Doing it now would be speculative restructuring
ahead of evidence that file-owned and project-owned TODOs actually diverge.

**Task as an entity distinct from TODO.** Currently treated as the same thing:
a task is a unit of work, and a TODO is that unit before it is done. `Todo`
already has `status`, so the distinction is a state, not a type. Revisit if
projects grow a need for tasks that are neither open work nor completed work.

**Rolling inherited TODOs into tree badge counts.** Excluded above; noted here
so the reasoning is not relitigated silently.

**Archiving completed project TODOs.** The existing archive record requires a
file path, so the shipped sweep leaves project-owned completed TODOs in the
project. A future archive change needs an explicit project subject; it must not
write a fake file path such as `project:PRJ-001` into `filePath`.

## Open Questions

1. Should a project be able to link another project (parent/child), or is one
   flat layer sufficient? Flat is proposed. Nesting invites the Jira drift this
   spec is trying to avoid.
2. Should `status: done` archive a project into `canopy_archive.json` the way
   completed TODOs are swept, or should projects remain visible indefinitely as
   history? Sweeping is consistent with existing behaviour; retention is more
   useful for the "why" record.
3. Should project detail get its own top-level view eventually, or is the Table
   lane the permanent home?

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
6. **UI — deferred.** A project lane/detail panel should follow only after the
   agent-facing shape is dogfooded and shown not to overload file navigation.

The shipped core is useful without UI: agents can author, review, query, and
follow a project while the existing tree remains the primary human surface.
