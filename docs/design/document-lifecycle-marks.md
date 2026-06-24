# Document Lifecycle Marks

**Date:** 2026-06-24
**Status:** proposed
**Scope:** feature design only. No runtime behavior is implemented by this doc.

## Summary

CanopyTag already has file status, authority, quality scores, freshness, tags,
comments, TODOs, features, and related files. Those fields answer many trust and
navigation questions, but they do not cleanly express short-lived document
intent: "this is a temporary contract", "this depends on a launch phase or
external version", "this is an agent condensation artifact", "this doc is
provisional", "this doc has been superseded by another doc", or "this doc needs
review by a date".

This proposal adds a small, optional metadata side channel named
`lifecycle_marks` to file entries. It is docs-first but file-general. The field
lets query, context, compare, UI filters, and future RAG clients group and warn
on temporary, temporally dependent, or lifecycle-sensitive records without
overloading `status`, tags, or freshness.

## Problem Statement

Fast-moving repos accumulate documents with different kinds of truth:

- Stable standards and specifications that should win conflicts.
- Temporary alpha contracts that are intentionally valid for a narrow window.
- Docs whose truth depends on a launch phase, migration event, external API
  version, or release line.
- Agent-created condensation artifacts that help hand off context but should not
  become canon by accident.
- Provisional designs that are useful but not yet validated.
- Superseded docs that still contain history but should route readers elsewhere.
- Review-needed docs where humans know the content may be drifting.

Today CanopyTag can express some of this indirectly:

- `status` can say `draft`, `experimental`, `superseded`, or `archived`, but it
  is singular and broad.
- Tags can say `temporary` or `needs-review`, but tags do not carry reason,
  expiry, replacement docs, or review dates.
- Comments can explain nuance, but they are not first-class query facets.
- Freshness can detect git-review drift, but it cannot say "this contract was
  intentionally temporary until 2026-07-15".
- Stability can say "this design may change soon", but it cannot say which
  date, release, event, or version bounds the truth of the doc.

The gap is not search. `rg` can find the words. The gap is grouping, routing,
and trust calibration over lifecycle-sensitive docs.

## BikeCRT-Style Use Cases

These examples are motivated by sophisticated internal repos with many active
specs, experiments, and agent handoffs:

- A private-alpha contract is authoritative for two weeks, then must be reviewed
  before it can continue to steer implementation.
- A migration plan is valid until a cutover event completes, after which it
  should be historical context rather than current guidance.
- A vendor-integration note is valid only for API v2 beta and should warn agents
  once they are working on v3 or GA behavior.
- A context condensation artifact preserves decisions from a long agent session,
  but it should be retrieval support, not a canonical source.
- A physiology V1 design is provisional while tests and product scope are still
  settling.
- An older unit-boundary doc is historically useful but superseded by a newer
  standard.
- A markdown doc has not changed, but related code did, so a human wants an
  explicit review-needed marker that survives across sessions.
- A repo owner asks an agent to query all temporary contracts, all expired marks,
  or all docs that need review before public alpha.

## Proposed Metadata

Add an optional field to `FileCanopy`:

```ts
export type LifecycleMarkType =
  | 'temporary_contract'
  | 'condensation_artifact'
  | 'provisional'
  | 'superseded'
  | 'review_needed';

export type LifecycleMarkState = 'open' | 'resolved';

export type RetrievalTreatment =
  | 'normal'
  | 'include_with_warning'
  | 'deprioritize'
  | 'exclude_by_default';

export type TemporalDependence =
  | 'none'
  | 'date_bound'
  | 'event_bound'
  | 'release_bound'
  | 'version_bound';

export interface LifecycleMark {
  id: string;
  type: LifecycleMarkType;
  state?: LifecycleMarkState;
  reason: string;
  createdAt: string;
  createdBy: Author;
  reviewAfter?: string;
  expiresAt?: string;
  temporalDependence?: TemporalDependence;
  temporalNote?: string;
  resolvedAt?: string;
  supersededBy?: string[];
  sourceFiles?: string[];
  retrievalTreatment?: RetrievalTreatment;
}

export interface FileCanopy {
  lifecycleMarks?: LifecycleMark[];
}
```

On disk this follows existing CanopyTag conventions:

```json
{
  "files": {
    "docs/specs/example.md": {
      "status": "active",
      "authority_level": "specification",
      "lifecycle_marks": [
        {
          "id": "LM-001",
          "type": "temporary_contract",
          "reason": "Private alpha behavior until onboarding feedback is reviewed.",
          "created_at": "2026-06-24T16:00:00Z",
          "created_by": { "role": "human", "name": "jeff" },
          "review_after": "2026-07-08",
          "expires_at": "2026-07-15",
          "temporal_dependence": "date_bound",
          "temporal_note": "Private alpha window; review after onboarding feedback.",
          "retrieval_treatment": "include_with_warning"
        }
      ]
    }
  }
}
```

### Field Notes

- `id` should use the same lightweight style as TODOs and comments, for example
  `LM-001`.
- `type` is the queryable mark category.
- `state` defaults to `open`; resolved marks may be hidden by default but kept
  for auditability.
- `reason` is required because the mark is only useful if it explains the
  lifecycle risk in one sentence.
- `review_after` and `expires_at` are `YYYY-MM-DD` dates, not datetimes. Derived
  states such as due or expired should be computed at read time, not persisted.
- `temporal_dependence` is optional. Omitted means there is no known special
  time, phase, release, or version caveat. `none` is allowed when a repo wants
  to record that this was considered explicitly.
- `date_bound` should normally pair with `review_after` or `expires_at`.
  `event_bound`, `release_bound`, and `version_bound` should include
  `temporal_note` because CanopyTag should not guess external state.
- `temporal_note` should name the external clock, event, release phase, or
  version that changes how the mark should be interpreted.
- `superseded_by` points to replacement files. It is recommended for
  `superseded` and optional elsewhere.
- `source_files` names inputs used to create a condensation artifact, if known.
- `retrieval_treatment` gives retrieval clients a simple default without
  hardcoding policy from the mark type alone.

## Mark Semantics

`temporary_contract`

A short-lived rule, agreement, or product/engineering contract. It may be high
authority during its window. It should usually include `review_after` or
`expires_at`.

`condensation_artifact`

An agent or human compression of a longer thread, exploration, or context window.
It may be valuable for orientation, but should not silently outrank the source
docs it summarizes. It should usually include `source_files` or related files.

`provisional`

A plausible but unsettled explanation, design, or scope note. This differs from
`status: draft`: a doc can be active and still contain a provisional section of
truth. The mark should explain what is not validated.

`superseded`

A doc remains useful for history but should route readers to one or more
successor files. This can coexist with `status: superseded`, but the mark adds
reason and `superseded_by` links for query and RAG behavior.

`review_needed`

A known manual review need that is not fully captured by freshness. This can be
due to domain uncertainty, a pending product decision, or suspected drift that
is not detectable from git dates alone.

### Temporal Dependence

Temporal dependence is a modifier on a lifecycle mark, not a lifecycle mark type
by itself. It explains what outside clock or phase makes the caveat matter:

- `none` means the mark is explicitly not time, event, release, or
  version-bound.
- `date_bound` means CanopyTag can compute due or expired status from
  `review_after` or `expires_at`.
- `event_bound` means a human-known event changes interpretation, such as a
  migration cutover, vendor launch, or product decision.
- `release_bound` means the doc applies to a named product or package release
  phase.
- `version_bound` means the doc applies only while a dependency, API, data
  format, or internal protocol version remains in scope.

Non-date temporal dependence should stay warning-oriented unless a future client
has explicit external state. For example, CanopyTag can show "valid until
cutover", but it should not infer that the cutover happened.

## Query And Grouping Behavior

Lifecycle marks should become first-class filters once implemented:

```bash
canopytag ls --mark temporary_contract
canopytag ls --temporal date_bound
canopytag query --mark review_needed --detail 3
canopytag context --feature physiology --include-marks
canopytag compare docs/old.md docs/new.md
canopytag health --marks
```

Suggested behavior:

- `stats` shows counts by open mark type plus due, expired, and temporal
  dependence counts.
- `ls` supports `--mark <type>`, `--review-due`, `--expired`, and
  `--temporal <kind>`, plus `--include-resolved-marks`.
- `query` can group results by feature first, then by mark type when a mark
  filter is active.
- `context` shows open lifecycle marks and temporal notes near the file header,
  before comments and TODOs.
- `compare` includes mark and temporal warnings in the trust order. A
  high-authority doc with an expired temporary contract should still show as
  high authority, but its expired mark must be visible.
- `todos` does not need lifecycle-specific behavior unless a future workflow
  turns due marks into explicit TODOs.
- `tags --health` can warn when teams use tags such as `temporary`,
  `needs-review`, `superseded`, or `condensation` in place of structured marks.

The default result set should not hide marked documents. Hiding is dangerous for
agents because the only hit may be a marked doc. The safer behavior is to include
with visible warnings, except where a retrieval profile explicitly excludes
superseded records by default.

## RAG And Search Behavior

CanopyTag should not become a vector database to support this feature. The mark
fields should instead be available as metadata for RAG clients and future
retrieval adapters.

Recommended defaults:

- `temporary_contract`: include with warning before expiry; deprioritize or warn
  loudly after expiry.
- `condensation_artifact`: include for orientation; do not use as canonical
  evidence when source files are available.
- `provisional`: include with warning and lower confidence.
- `superseded`: exclude by default when `superseded_by` is available; include
  for history or if no successor is indexed.
- `review_needed`: include with warning; boost for maintenance and review
  queries.

Search and RAG clients should expose the mark text in the prompt context when
they include a marked document. The warning is part of the retrieval result, not
an afterthought.

Temporal dependence should also travel with retrieval results. `date_bound`
marks can compute due and expired labels from stored dates. `event_bound`,
`release_bound`, and `version_bound` marks should be included as explicit
warnings unless the retrieval client can verify the relevant external state.
CanopyTag should avoid pretending that it knows a migration completed, a release
shipped, or a vendor version changed unless that state is modeled elsewhere.

## Authority Interaction

Lifecycle marks are trust modifiers, not authority levels.

- `authority_level` remains the conflict-precedence hierarchy.
- Quality scores remain the validity, clarity, completeness, and stability
  assessment.
- Freshness remains the derived review-vs-git drift signal.
- Lifecycle marks explain time-bound, review-bound, or source-bound caveats.
- Temporal dependence names the date, event, release, or version boundary for a
  caveat; it does not lower authority by itself.

Examples:

- A `standard` file with an open `temporary_contract` mark can be authoritative
  inside the stated window, but agents should see the expiry.
- A `specification` with `temporal_dependence: release_bound` can remain the
  correct source for that release while warning agents not to apply it globally.
- A `specification` with `review_needed` still outranks an `idea`, but compare
  should report the review caveat.
- A `guideline` with `superseded` should route agents to `superseded_by` even if
  the successor has lower quality scores today.
- A `condensation_artifact` should rarely be promoted above its source files
  unless a human explicitly makes it canonical.

## Expiration And Review Dates

Lifecycle marks need date-aware behavior without background jobs:

- `review_after` means "show this as review-due on or after this date".
- `expires_at` means "show this as expired after this date".
- `resolved_at` records when the mark stopped being active.
- Due and expired states are computed when CLI, MCP, API, or UI code reads the
  metadata.
- CanopyTag should never auto-delete or auto-resolve marks.

Date filters should accept the same ISO date style as existing tagged/git date
filters.

Not every temporal dependency is date-aware. Event-, release-, and version-bound
marks remain open until they are resolved or updated by a human or agent with
relevant context. CanopyTag should surface those boundaries, not try to derive
their state from package versions, changelog text, or branch names in the first
version.

## Migration And Backward Compatibility

This should be a purely additive schema extension:

- Existing `canopy.json` files remain valid because `lifecycle_marks` is
  optional.
- Existing tools can ignore the field until they intentionally render or filter
  it.
- The current `status` enum should not be changed for the first version.
- Existing tags can continue to work, but structured marks should become the
  preferred representation for temporary, superseded, condensation, and
  review-needed intent.
- A future migration helper may suggest marks from common tags or comments, but
  the initial feature should not infer marks automatically.

Backward-compatible staged suggestions can use `agent_manifest.json` before
direct write support exists. For example, an agent can stage a suggestion that a
doc should receive a `review_needed` mark, then a human can accept or reject it.

## CLI, API, MCP, And UI Implications

Likely implementation surface, if this proposal is accepted:

- Types: add `LifecycleMark`, `TemporalDependence`, and
  `lifecycleMarks?: LifecycleMark[]` to `FileCanopy` and merged records.
- Persistence: preserve the field through snake/camel transforms and file meta
  writes.
- CLI: add mark and temporal-dependence filters to shared filter parsing and
  render lifecycle warnings in `ls`, `query`, `context`, `compare`, and
  `health`.
- MCP reads: expose the same warnings and filters in read tools.
- MCP writes: add a narrow mark write tool or extend `canopytag_annotate` after
  validation exists.
- API: either extend `/api/file/meta` for validated mark operations or add
  dedicated mark create/resolve endpoints.
- UI: show compact mark badges in Explorer and Table, add mark filters, and make
  due/expired marks part of the attention sort.
- Activity review: agent-authored mark changes should appear in
  `agent_manifest.json` with undo metadata like annotations, comments, and TODOs.

## Risks

- Mark sprawl: teams may create lifecycle marks for every small uncertainty.
- Taxonomy drift: users may keep inventing tags instead of using structured
  marks unless the UI makes the structured path easier.
- False suppression: hiding superseded or expired documents too aggressively can
  remove necessary historical context.
- Authority confusion: users may treat a mark as a new authority level unless
  docs and UI keep the distinction clear.
- Date rot: expired marks lose value if nobody reviews or resolves them.
- Temporal false precision: release-, event-, and version-bound docs may look
  machine-checkable before CanopyTag has real external state for them.
- Overfitting: the first version should support BikeCRT-style repos without
  hardcoding BikeCRT process language.

## Non-Goals

- A full document lifecycle management system.
- A project-management replacement for TODOs.
- A vector search or embedding implementation.
- Automatic LLM classification of docs into mark types.
- Section-level document parsing.
- Replacing `status`, `authority_level`, quality scores, or freshness.
- Structural dependency analysis. CanopyTag can consume relationship metadata,
  but this proposal does not turn it into a parser.
- Release management, package-version tracking, or migration-state inference.

## Open Questions

- Should the field be named `lifecycle_marks`, `document_marks`, or
  `trust_marks`?
- Should `temporary_contract` require `expires_at`, or only warn when it is
  absent?
- Should `condensation_artifact` require `source_files`, or allow free-form
  artifacts from thread summaries?
- Should resolved marks remain in `canopy.json`, move to `canopy_archive.json`,
  or remain in place until a retention policy exists?
- Should RAG behavior be encoded as `retrieval_treatment`, derived from mark
  type, or left entirely to clients?
- Should `temporal_dependence: none` exist as an explicit value, or should
  absence always mean "no known temporal boundary"?
- Should the CLI expose temporal filters as `--temporal`, `--time-bound`, or
  mark-specific flags?
- Should code files be allowed to carry lifecycle marks, or should the UI make
  the feature docs-first while keeping the schema file-general?
