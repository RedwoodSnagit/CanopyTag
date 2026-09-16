# Project Pattern Comparison

**Status:** RT-017 completed on 2026-08-25  
**Scope:** One evidence-led desk comparison of `PRJ-001`, not an integration
or a migration. No external package, account, service, repository metadata, or
downstream repository was changed for this work.

## Decision

CanopyTag should retain the authored project packet in `canopytag/canopy.json`
as the source of project, task, resource, receipt, and decision truth. It can
adopt or adapt patterns from task trackers, PM systems, software catalogues,
and canvases, but none of those systems earns adapter status from this
comparison alone.

The valuable patterns are already compatible with the current boundary:

- typed blocking versus non-blocking task relationships and deterministic
  ready-work projection;
- concise, human-readable work cards and grouped project views;
- authored facts separated from generated/read-model projections with visible
  provenance; and
- a portable canvas *projection* for spatial layout, if repeated shared-layout
  workflows later justify it.

Scheduling, generic boards, automatic agent setup, foreign state sync, and
unattributed activity are explicitly outside the product boundary.

## Representative packet

The subject was CanopyTag's own `PRJ-001`: six retained project tasks, typed
dependencies, three milestones, 31 linked files, project resources, completion
receipts, browser-local graph positions, and one ready next task at the start
of this comparison. It was reproduced only as a mapping exercise:

| Native concern | Agent tracker pattern | Human PM pattern | Catalogue pattern | Canvas pattern |
| --- | --- | --- | --- | --- |
| Project outcome and linked files | Issue workspace/context | Project container | Discoverable component/system context | Group/title node |
| Task ordering | Typed issue dependencies + ready queue | Work-item links | Not operational work | Directed edges |
| Milestones | Optional grouping/template | Milestone/cycle-style grouping | Lifecycle only, not execution order | Visual group |
| Resources and receipts | Links/issue text, not verified as durable evidence | Work-item context, not a mapping target | Metadata/annotations and external links | File and URL nodes |
| Human layout | Not evaluated | Rich operational UI | Discovery/navigation UI | Native coordinates/groups/edges |

This makes the mismatch useful: no reference model simultaneously preserves
CanopyTag's small authored packet, fresh-agent read interface, source-adjacent
metadata, resource/receipt evidence, and bounded human graph.

## Evidence and fit

| Reference | What the official material establishes | Export / privacy / API / backup / attribution evidence | Fit for CanopyTag |
| --- | --- | --- | --- |
| [Beads](https://github.com/gastownhall/beads/blob/main/docs/index.md) | Dependency-aware issues, typed `blocks`, `parent-child`, `discovered-from`, and `related` edges, plus `bd ready` and JSON output for agents. | Beads documents human-readable JSONL export and a separate Dolt-native backup; its README is explicit that JSONL is interchange, not its source of truth or a backup. It is local/offline-oriented and provides JSON CLI/MCP access. This comparison did **not** establish a compatible immutable actor/receipt record for CanopyTag. | Excellent agent-execution reference; not a justified engine or adapter. |
| [Plane](https://developers.plane.so/) | A full PM system with work items, projects, cycles/modules, REST endpoints, webhooks, MCP, and self-hosting options. | The public docs advertise import/export, self-hosting, a REST API, and webhooks. Its self-host guide includes backup and restore for its service volumes. Self-hosting can improve deployment control, but introduces an operated service, credentials, and migrations. This spike did **not** verify stable export schema or receipt-grade actor retention for a particular edition/deployment. | Good human-UI reference; far broader than CanopyTag's bounded execution packet. |
| [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/creating-the-catalog-graph/) | Human-maintained, source-adjacent descriptors, directed relations, ownership, and a read model exposed to users and plugins. Backstage expressly treats the catalog as a cache/read model rather than the ultimate source of truth. | Descriptor files can live in version control; its catalog API is JSON REST and may require bearer authentication. Backup/privacy are an operator concern across descriptor repositories and the catalog database. Ownership is present, but task-action attribution and receipts are not its purpose. | Strong boundary and provenance reference; not a task tracker. |
| [JSON Canvas](https://jsoncanvas.org/spec/1.0/) | An open `.canvas` file format with positioned nodes, groups, file/URL links, labeled directed edges, and user-owned JSON data. | The file itself is portable and can use ordinary filesystem or Git backup. The specification defines no service API, authentication, actor identity, timestamps, or action receipts; that is an inference from the specified node/edge fields, not a limitation of every application that can render it. | A strong optional export/view format; unsuitable as project truth. |

### Source notes

- Beads' [core documentation](https://github.com/gastownhall/beads/blob/main/docs/index.md)
  establishes its ready queue and dependency types. Its
  [FAQ](https://github.com/gastownhall/beads/blob/main/docs/reference/faq.md)
  and [README](https://github.com/gastownhall/beads/blob/main/README.md) distinguish
  JSONL interchange from Dolt-native backup and storage.
- Plane's [developer documentation](https://developers.plane.so/) identifies
  self-hosting, REST, webhooks, MCP, and agents. The published
  [Community self-host guide](https://github.com/makeplane/plane/blob/preview/deployments/cli/community/README.md)
  documents its backup/restore flow. Feature and edition details are therefore
  not assumed to be stable without a pinned deployment check.
- Backstage's [catalog graph guidance](https://backstage.io/docs/features/software-catalog/creating-the-catalog-graph/)
  establishes the source/read-model distinction; its
  [catalog API documentation](https://backstage.io/docs/features/software-catalog/software-catalog-api/)
  establishes REST and processed-entity behavior.
- The [JSON Canvas v1 specification](https://jsoncanvas.org/spec/1.0/) is the
  sole source for format-level claims. It does not supply collaboration,
  backup, or attribution semantics beyond what an adopting application adds.

## Adopt, adapt, reject

| Classification | Decision | Product-boundary impact |
| --- | --- | --- |
| **Adopt** | Keep typed dependency semantics, deterministic readiness, and machine-readable project packets as the agent-facing baseline. This confirms the RT-015/RT-016 direction rather than adding a second task engine. | No new source of truth; dependencies remain authored inside the project task packet. |
| **Adopt** | Keep authored facts separate from derived or provider data, and require provider identity plus artifact fingerprint before showing structural overlays. | Directly reinforces the existing non-authoritative generated-sidecar and graph-overlay contract. |
| **Adapt** | If a repeated human workflow needs to share spatial layout, evaluate a one-way JSON Canvas export containing project/task aliases, groups, and directed relation labels. The export must name its CanopyTag project, generation time, and source fingerprint. | The `.canvas` file is a view artifact; import, task-status edits, and conflict resolution are out of scope until separately designed. |
| **Adapt** | Borrow PM readability: compact work cards, explicit status/readiness, contextual evidence, and small groupings. Do not borrow cycles, due dates, sprints, boards, or a generic workflow engine without a distinct user need. | Presentation may improve; project data does not expand into a scheduler. |
| **Reject** | Do not install Beads, Plane, Backstage, or a Canvas application in a downstream repository as part of CanopyTag's normal workflow. In particular, do not accept automatic agent-instruction setup, a hosted account, or a database service as an implied dependency. | Preserves local-first installation, privacy, and repository ownership. |
| **Reject** | Do not create bidirectional synchronization or treat any foreign issue/canvas/catalog record as authoritative. | Avoids ID collisions, ambiguous deletes, unreviewed writes, and loss of CanopyTag resource/receipt provenance. |
| **Reject** | Do not use JSON Canvas coordinates or Backstage's dynamic/read-model relations as authored project dependencies. | Keeps spatial and generated evidence visibly distinct from execution truth. |

## Gates before any future adapter

An adapter or export implementation needs a separate project task and all of
the following evidence at its pinned version:

1. A stable, loss-aware mapping for project/task/resource/receipt IDs, including
   how deleted or historical records behave.
2. A documented export and tested restore path that is independent of a UI
   session; a view/export is not automatically a backup.
3. Explicit local/self-hosted or privacy-reviewed deployment choices, credential
   ownership, and a proof that data is not silently sent to a third party.
4. Versioned API or file-format behavior, authenticated read/write scope, and
   a deliberate failure mode when the external service is unavailable.
5. Durable actor, reviewer, timestamp, and receipt attribution that maps to
   CanopyTag without inventing identity or overwriting later human work.
6. A one-way-first implementation plan and a human review/undo boundary. No
   bidirectional sync is presumed.

Until those gates are met, the current browser-local layout and the native
CLI/MCP/HTTP/UI packet are the deliberately simpler, safer design.
