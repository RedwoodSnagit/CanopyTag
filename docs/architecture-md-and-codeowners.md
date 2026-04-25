# ARCHITECTURE.md, CODEOWNERS, and Where CanopyTag Fits

**Date:** 2026-03-26
**Purpose:** Reference for positioning CanopyTag against existing code metadata conventions

---

## ARCHITECTURE.md

### What It Is

A top-level markdown file that gives contributors a map of the codebase. Popularized by **Aleksey Kladov** (matklad, creator of rust-analyzer) in a 2021 blog post. The key insight: README.md serves external users (what it does, how to install). ARCHITECTURE.md serves contributors (how the code is organized, where to look, what the moving parts are).

### What a Good One Contains

- **High-level structure** — major directories/packages and what each does
- **Data flow** — how a request or event moves through the system
- **Key abstractions** — the 3-5 most important types/interfaces and why they exist
- **Cross-cutting concerns** — error handling, logging, configuration strategy
- **Invariants** — things that must always be true ("the DB layer never imports from UI")
- **Non-obvious decisions** — why something is done a particular way

### Example (rust-analyzer style, abbreviated)

```markdown
# Architecture of rust-analyzer

## Overview
rust-analyzer implements the Language Server Protocol for Rust.

- `crates/` — the bulk of the code, as a cargo workspace
- `editors/` — editor-specific glue (VS Code extension, etc.)
- `docs/` — developer documentation

## Key Crates

### `crates/ide/`
Main entry point. Implements the IDE-facing API (completions, go-to-def).
Does NOT depend on LSP directly — speaks in terms of files, offsets, semantic info.

### `crates/hir/`
High-level intermediate representation. The "semantic model" of Rust code.

### `crates/syntax/`
Lossless concrete syntax tree. Every byte preserved. Foundation for everything else.

## Invariants
- `ide` never depends on `lsp-server` directly
- All file I/O goes through the `vfs` crate
- Analysis is demand-driven (lazy), not batch
```

### Strengths
- Zero tooling required — just a file
- Captures the *why* and the big picture that structured metadata can't
- Forces the author to think holistically
- Extremely low barrier

### Weaknesses
- Goes stale unless actively maintained
- Cannot be queried programmatically
- Doesn't scale to per-file granularity
- Quality depends entirely on the author

---

## .github/CODEOWNERS

### What It Is

A GitHub feature (GitLab and Bitbucket have equivalents). Maps file patterns to usernames/teams. When a PR modifies matching files, those owners are automatically added as reviewers. With branch protection enabled, PRs **cannot merge** without owner approval.

### Syntax

```
# Default owners for everything
*       @org/core-team

# Frontend
/src/pages/       @alice @bob
/src/components/  @alice

# Infrastructure
/terraform/       @org/platform-team

# The one person who understands the build
webpack.config.js @dave
```

### Strengths
- Directly integrated into PR workflow — has teeth (can block merges)
- Simple syntax, easy to understand
- Solves a real governance problem

### Weaknesses
- Platform-locked to GitHub/GitLab
- Only captures ownership, nothing else
- Pattern-based — can't express ownership of cross-cutting concerns
- No rationale (doesn't explain *why* someone owns a file)

---

## Other Lightweight Conventions

| Convention | What it does |
|---|---|
| **CLAUDE.md / AGENTS.md** | Instructions for AI coding agents — build commands, constraints, style preferences. Same category as ARCHITECTURE.md but audience is agents, not humans. |
| **ADRs** (Architecture Decision Records) | `docs/adr/0001-use-postgresql.md` — numbered docs capturing individual decisions (Status, Context, Decision, Consequences). Captures *why* decisions were made over time. |
| **.github/labeler.yml** | Auto-labels PRs based on which files changed. Organizational only, no enforcement. |
| **CONTRIBUTING.md** | Process docs for contributors. GitHub surfaces these in the UI. |
| **package.json / Cargo.toml** | Language-specific structured metadata (name, version, deps, scripts). Closest mainstream equivalent to structured JSON metadata, but scoped to package management. |

---

## Notion / Confluence / Wikis (The Closest Mainstream Comparison)

### What They Are

Notion, Confluence, and team wikis are where most teams actually put their structured knowledge about a codebase — file-by-file documentation, ownership tables, status tracking, quality notes. A typical Notion workspace for a dev team might have:

- A database of "modules" with properties: owner, status, last reviewed, tech debt score
- Linked pages with architecture notes per module
- Kanban boards tracking what needs refactoring
- Tags and filters for slicing by team, status, or priority

This is remarkably close to what CanopyTag does. The comparison matters because Notion is the incumbent for "structured knowledge about code."

### Where Notion Wins

- **Rich editing** — prose, tables, embeds, diagrams, comments, mentions. Far richer authoring than JSON fields.
- **Collaboration** — real-time multi-user editing, comments, @mentions, permissions. Built for teams.
- **Flexibility** — schema is user-defined. Add any property, view, or relation you want.
- **Adoption** — already in use at most companies. No new tool to introduce.
- **Search** — full-text search across all content, plus database filtering and sorting.

### Where Notion Fails (and CanopyTag's Opportunity)

| Problem | Detail |
|---|---|
| **Disconnected from the repo** | Notion pages are not version-controlled. They don't live next to the code. They can't be committed, branched, or diffed. When code moves, the Notion page doesn't know. |
| **Not machine-readable at the point of work** | An agent working in a codebase cannot query Notion mid-task without an API integration. There's no `notion query --file src/auth.ts`. The knowledge exists but is inaccessible at the moment it's needed. |
| **No agent attribution** | Notion tracks human edits. It has no concept of "Claude Opus wrote this annotation during session X." As agents become co-authors of project knowledge, this gap grows. |
| **Drift is invisible** | A Notion page about `auth.ts` doesn't know that `auth.ts` was refactored last week. There's no `lastReviewed` vs git-modification comparison. Staleness is silent. |
| **Schema isn't optimized for agent consumption** | Notion's data model (blocks, pages, databases) is designed for human browsing. Extracting structured data requires the Notion API, pagination, and block parsing. CanopyTag's flat JSON is one `fs.readFile` call. |
| **Doesn't travel with forks/clones** | When someone forks a repo, they get the code but not the Notion workspace. CanopyTag's `.canopytag/` directory is part of the repo. |

### The Real Comparison

Notion is a **team knowledge base that happens to be used for code documentation.**
CanopyTag is a **code metadata layer that happens to be browsable by humans.**

They serve different workflows:

| Workflow | Notion | CanopyTag |
|---|---|---|
| "I need to understand the auth system" | Open the Notion page, read the prose | `canopytag query --feature auth --detail full` |
| "Which files need attention?" | Filter the Notion database by status | `canopytag query --goal "what needs work"` |
| "An agent needs context before editing a file" | Not possible without API wiring | Agent reads canopy.json or calls MCP tool |
| "Who annotated this and when?" | Notion edit history (human only) | Author attribution with agent role + session |
| "Did this annotation go stale?" | Manual check | `lastReviewed` vs git modification, drift detection |

### Could They Coexist?

Yes. For teams already using Notion:

- **Notion** stays the human collaboration surface — architecture discussions, meeting notes, onboarding docs
- **CanopyTag** is the agent-facing metadata layer — per-file annotations that travel with the code and are queryable at the point of work
- A sync bridge (canopy.json -> Notion database, or vice versa) could keep them aligned, but it's not required. They serve different audiences at different moments.

---

## Where CanopyTag Fits

CanopyTag is not competing with any of these. It fills a different role:

| Tool | Answers | Format | Audience | Lives in repo? |
|------|---------|--------|----------|----------------|
| ARCHITECTURE.md | "How does this system work?" | Prose | Human contributors | Yes |
| CODEOWNERS | "Who must approve changes here?" | Pattern rules | GitHub's review system | Yes |
| ADRs | "Why was this decision made?" | Prose (templated) | Future maintainers | Yes |
| CLAUDE.md / AGENTS.md | "How should agents behave here?" | Prose | AI agents | Yes |
| Notion / Confluence | "What do we know about this code?" | Rich docs + databases | Human teams | No |
| **CanopyTag** | "What is this file, how mature is it, what needs work?" | Structured JSON | Tooling, agents, dashboards | Yes |

### The Pitch

> ARCHITECTURE.md tells humans the big picture. CODEOWNERS tells GitHub who reviews what.
> CanopyTag tells agents what every file is, how mature it is, and what needs work —
> in a format they can query, filter, and act on.

### How They Work Together

The pragmatic stack for a mature project:

1. **ARCHITECTURE.md** — 10,000-foot narrative view
2. **CODEOWNERS** — review governance
3. **ADRs** — decision history
4. **AGENTS.md** — agent behavior constraints
5. **CanopyTag** — per-file structured metadata for tooling and agent navigation

CanopyTag could even *generate* a basic ARCHITECTURE.md from its annotations — aggregating feature summaries, high-authority files, and active TODOs into a narrative scaffold.

---

## Takeaway for CanopyTag's README

A "How CanopyTag fits with existing conventions" section should:

1. Acknowledge ARCHITECTURE.md and CODEOWNERS — don't position against them
2. Explain the gap: prose is great for humans, patterns are great for review routing, but neither is queryable by agents at per-file granularity
3. Recommend using CanopyTag alongside these conventions, not instead of them
4. Note the unique value: scoring dimensions, authority levels, agent attribution, progressive query depth — none of which exist in the prose/pattern world
