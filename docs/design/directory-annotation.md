# Directory Annotation

**Date:** 2026-08-17
**Status:** proposed
**Scope:** directory evaluation comments, directory-scoped TODOs, directory
attribution, and one addition to the comment vocabulary

## Summary

Directories are the only annotation surface in CanopyTag that carries a single
untyped, unattributed field:

```ts
export interface DirectorySummary {
  summary?: string;
}
```

Files carry summaries, tags, scores, authority, comments, TODOs, related files,
I/O metadata, and full attribution. A directory carries one string with no
author and no date.

Three things are missing, and they are different from each other:

- **What the directory is** — the existing `summary`. Adequate.
- **What we think of it** — an evaluation. Cohesion, boundary, ownership,
  lifecycle. No home today.
- **What should happen to it** — TODOs scoped to the directory as a unit
  ("this package needs a README", "nothing in here has tests", "split this in
  two"). No home today; `canopytag_add_todo` requires a file.

This proposal adds evaluation comments, directory-scoped TODOs, and attribution
to directories, reusing the existing `Comment` and `Todo` types rather than
inventing directory-specific ones.

## Non-Goals

The original design deliberately kept tags, scores, authority levels, and
features on files. `DirectoryDetail.tsx` states the rationale in the UI itself:
detailed truth belongs on individual files where it can be verified.

That exclusion stands. This proposal does not give directories scores, tags,
authority, or feature membership.

Scoring directories is specifically rejected. The four file scores — validity,
clarity, completeness, stability — are assertions about a *document*. A
directory is not a document, and forcing the scale would produce numbers that
do not mean anything. Calibration is still available per-evaluation through the
existing comment `confidence` field.

## The Comment Vocabulary Gap

`CommentType` today is `finding | bug | improvement | note`. This is a
code-review vocabulary: every type except `note` presumes something is wrong or
could be better. Tested against real directory evaluations:

| Evaluation | Existing type | Fit |
|---|---|---|
| "These three modules should be one" | `improvement` | Good |
| "Ownership is unclear here" | `finding` | Loose |
| "A dumping ground with no coherent boundary" | `finding` | Poor — a structural judgment, not a defect |
| "Cohesive; should be the model for the other packages" | — | **None** |
| "Legacy, kept for reference only" | `note` | Flattens a lifecycle judgment into a shrug |

The gap is that there is no type for a **holistic judgment**, and in particular
none that can be positive. An evaluation vocabulary that can only express fault
is a defect log, not an evaluation.

### Addition: `assessment`

```ts
export type CommentType = 'finding' | 'bug' | 'improvement' | 'note' | 'assessment';
```

`assessment` — a considered judgment of the annotated thing as a whole. May be
positive, negative, or mixed.

One enum value, no new subsystem. It applies to files as well, where the same
gap exists: "this doc is the canonical reference and is in good shape" has
nowhere to go today either.

### Evaluation dimensions stay convention, not schema

For directories, the dimensions worth judging are **cohesion** (does this have
one clear purpose), **boundary** (is the scope right, should it split or merge),
**ownership** (who is responsible, or does nobody know), and **lifecycle**
(active, legacy, dead weight, candidate for removal).

These are documented as guidance in the agent instructions for what a good
directory assessment covers. They are deliberately **not** enum values. Prose
under a typed comment stays flexible; an enum locks in categories before there
is evidence they are the right four. Promote a dimension to schema only if it
proves load-bearing.

## Schema

### Changed: `DirectorySummary` → `DirectoryCanopy`

The name is changed because the record is no longer a summary. The on-disk key
`directories` is unchanged, so existing files round-trip without migration.

```ts
export interface DirectoryCanopy {
  summary?: string;              // what this directory IS
  comments?: Comment[];          // what we think of it — evaluation
  todos?: Todo[];                // what should happen to it
  createdBy?: Author;            // NEW — who authored the summary
  lastReviewedAt?: string;       // NEW — ISO-8601 UTC
  lastReviewedBy?: Author;       // NEW
}
```

All fields optional. A directory record containing only `summary` remains valid
and behaves exactly as today.

Attribution matters here for the same reason it matters on the manifest: an
attributed critique hanging off an unattributed description is half a record.
If a human wrote the summary in March and an agent revised it in August, that
must be recoverable.

### Changed: `Canopy`

```ts
directories?: Record<string, DirectoryCanopy>;   // type renamed, key unchanged
```

## TODO Homing

A TODO hangs on **exactly one** of `file`, `directory`, or `project`.

| Home | Meaning | Example |
|---|---|---|
| `file` | Work on this specific thing | "This function needs a null guard" |
| `directory` | Work on this area as a unit | "Nothing in here has tests" |
| `project` | Work defined by intent, spanning locations | "Integrate RPE V5 into Ride Analysis" |

File and directory are both *where*, at different granularity. Project is
*intent* — a set defined by what the work is for rather than where it lives.

There is precedent for directory as a first-class work location: the active-work
claim system already models `WorkClaimPathKind = 'file' | 'directory' |
'unknown'`. Annotation is the surface that never caught up.

### Amendment to the project layer spec

`docs/design/project-layer.md` states that `canopytag_add_todo` takes "exactly
one of `file` or `project`". That rule becomes:

> Exactly one of `file`, `directory`, or `project` is required. Supplying more
> than one is an error.

The reasoning is unchanged — a TODO has one home — and the inheritance rules
below handle everything else.

### Inheritance is a view concern

Consistent with the project layer: nothing is copied or synced.

- A **file** detail panel shows its own TODOs, plus read-only inherited TODOs
  from projects implicating it. It does **not** inherit from its parent
  directory — a directory TODO is about the directory as a unit, not about each
  file within it. "This package needs a README" is not a TODO for every module
  in the package.
- A **directory** detail panel shows its own TODOs, plus a rolled-up count of
  open TODOs on files beneath it. The rollup count already exists today
  (`openTodoCount` in the directory route) and is unchanged.

Tree badge counts continue to reflect file-owned TODOs only.

## MCP Surface

Changes to existing tools:

- `canopytag_add_todo` — accepts `directory` as a third homing option. Exactly
  one of `file` / `directory` / `project`.
- `canopytag_add_comment` — accepts `directory` as an alternative to `file`, so
  evaluations can be written by agents.
- `canopytag_annotate` — accepts `directory` for summary and attribution
  updates.
- `canopytag_context` — a directory lookup returns summary, evaluation comments,
  directory TODOs, and the file rollup.
- `canopytag_query` — directory records become searchable on summary and
  comment text, so "which areas did we flag as dumping grounds" is answerable.

Directory writes go through the agent manifest review path like every other
agent write. `AgentManifestEntry.file` is required today; it gains a sibling
`directory?: string`, with exactly one of the two set.

## UI Surface

`DirectoryDetail.tsx` currently renders a summary textarea, a file count, a TODO
rollup, and the "Why summary only?" explainer. It grows:

- An **Evaluation** section rendering `comments` via the existing `CommentList`
  component, with the type and confidence controls files already have.
- A **TODOs** section for directory-scoped TODOs, reusing `TodoList`.
- Attribution shown on the summary — who wrote it, when it was last reviewed.
- The "Why summary only?" explainer is rewritten. It is now inaccurate, and its
  replacement should state what directories deliberately still exclude (scores,
  tags, authority, features) and why, so the reasoning survives.

## Validation and Doctor Checks

- `readCanopy()` validates the extended `directories` shape.
- Directory TODO ids share the existing `CT-NNN` sequence — one id space across
  all homes, so a TODO can move between file, directory, and project without
  changing identity.
- Comment ids follow the existing `ensureCommentIds()` path.
- `doctor` flags: directory records whose path no longer exists on disk, and
  summaries with no `createdBy` once attribution ships (existing records are
  grandfathered, not reported as defects forever).

## Migration

None required. `DirectorySummary` → `DirectoryCanopy` is a type rename with an
unchanged on-disk key and all-optional new fields. Existing `directories`
entries load and save unchanged. The `assessment` comment type is additive to a
union.

Note that the BikeCRT working repo currently has **zero** directory entries
despite 209 annotated files, so there is no meaningful legacy data to preserve —
this is close to a greenfield surface in practice.

## Open Questions

1. Should directory evaluations roll up to a parent directory view, or does each
   directory stand alone? Standing alone is proposed; rollup risks the same
   inflation problem as badge counts.
2. Should `assessment` comments be distinguished in the UI from observation
   comments, or share one list sorted by date? Sharing is proposed for now.
3. Does `canopytag coverage` grow a directory dimension — "which directories
   have no evaluation" — alongside its file orphan detection?

## Implementation Phases

1. **Schema and persistence.** `DirectoryCanopy`, the `assessment` comment type,
   `readCanopy` validation, snake_case round-trip tests.
2. **Backend routes.** Extend `/api/directory` for comments and TODOs; extend
   the comment and TODO routes to accept a directory target.
3. **MCP surface.** Directory targets on annotate / add_comment / add_todo;
   directory results in context and query.
4. **UI.** Evaluation and TODO sections in `DirectoryDetail`, attribution
   display, rewritten explainer.
5. **Doctor checks and coverage.**

Phase 1 alone makes hand-authored directory evaluations valid input, which is
enough to start moving a spreadsheet into the repo by hand if wanted.
