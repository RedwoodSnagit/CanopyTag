---
title: "How Agents Navigate Repos — and Where CanopyTag Fits"
summary: How agents actually explore codebases today (grep, glob, read), where that breaks down, and how CanopyTag supplements the workflow without replacing it.
authority_level: guideline
status: active
---

# How Agents Navigate Repos

## What Agents Already Do

Every coding agent — Claude Code, Cursor, Aider, Copilot — navigates repos the same way:

1. **Glob** for file patterns (`src/**/*.ts`, `**/auth*`)
2. **Grep** for keywords (`rg "handleAuth"`, `rg "TODO"`)
3. **Read** files that look relevant
4. **Build a mental model** from what they've read
5. **Repeat** until they have enough context to act

This works. It's how developers work too. The tools are fast, universal, and require zero setup.

## Where It Breaks Down

The breakdown isn't in finding files — it's in **interpreting what you found**.

An agent greps for `auth middleware` and gets 15 hits. Now what?

- Which hit is the canonical implementation vs. a deprecated experiment?
- Which is a test that's currently broken?
- Which is a doc that explains the design intent?
- Are any of these files related to each other?
- What order should I read them in?

The agent doesn't know. So it reads all 15, or guesses based on file path conventions, or picks the first match and hopes. In a 50-file repo this is fine. In a 500-file repo with years of history, it's expensive and error-prone.

**The problem isn't search. The problem is judgment about search results.**

## What CanopyTag Adds

CanopyTag doesn't replace grep or glob. It supplements them with pre-annotated judgment that agents can query after they've already found files.

The workflow becomes:

1. Agent **greps** for `auth middleware` → 15 hits
2. Agent asks CanopyTag: **"what do you know about these files?"**
3. CanopyTag returns, for each annotated file:
   - **Authority**: this is a specification (read first) vs. an idea (read if curious)
   - **Status**: active, deprecated, experimental, draft
   - **Summary**: one line explaining what the file does and why it exists
   - **Warnings**: "completeness 2/5 — this spec is incomplete, don't trust it fully"
   - **Relations**: "this file implements that spec, this test validates it"
   - **TODOs**: open work items with priority
4. Agent reads **3 files instead of 15**, in the right order, with calibrated trust
5. If two files conflict, agent runs `canopytag compare <file...>` to get an explicit trust order

The annotations are written once (by humans or agents) and queried many times. The cost is amortized across every future session.

## What CanopyTag Does NOT Do

- **Replace text search.** `rg "handleAuth"` is still the right way to find a function. CanopyTag can't do symbol search.
- **Auto-index the repo.** CanopyTag requires explicit annotation. It knows about files you've told it about. Unannotated files are invisible to it.
- **Parse code.** It doesn't understand ASTs, imports, or call graphs. Tools like tree-sitter, LSP servers, and Aider's repo map do that. CanopyTag captures *meaning*, not *structure*.
- **Scale without effort.** Annotation takes time. The bet is that the time saved navigating outweighs the time spent annotating — but that's only true for repos that get revisited often.

## The Questions Each Tool Answers

| Question | grep/glob | CanopyTag |
|---|---|---|
| Where does this symbol appear? | Yes | No |
| What files match this pattern? | Yes | No |
| What does this file do? | No (read it) | Yes (summary) |
| Is this file current or deprecated? | No (guess) | Yes (status) |
| Can I trust this file? | No (read + judge) | Partially (authority + scores + warnings) |
| Which of these files should win a conflict? | No | Yes (`compare` trust order) |
| What should I read first? | No | Yes (authority + relations) |
| What needs work? | No | Yes (TODOs + attention sort) |
| What's related to this file? | Grep imports (partial) | Explicit relations with types |

## How Agents Would Use It

### Orientation (start of session)
```
canopytag stats                    → what exists in this repo?
canopytag ls --sort attention      → what needs work?
canopytag context --feature auth   → give me the full picture of auth
```

### Mid-task lookup (after grepping)
```
rg "validateToken" → 8 hits
canopytag context src/auth/middleware.ts src/auth/tokens.ts
→ middleware.ts is spec/active, tokens.ts is guideline/experimental
→ read middleware.ts first, tokens.ts is unstable
```

In practice, use `rg -l` or copy only the file paths from search results. The
context command wants paths, not matched source lines:

```
rg -l "validateToken" src tests
canopytag context src/auth/middleware.ts src/auth/tokens.ts
canopytag compare src/auth/middleware.ts src/auth/tokens.ts docs/auth-spec.md
canopytag query --feature auth --detail 4
```

### Before committing
```
canopytag health --unreviewed      → any scores I should review?
canopytag todos --priority 2       → any P1/P2 work I'm missing?
```

## The Compound Effect

Each annotation is written once and read many times. A repo with 100 annotated files provides:

- 100 summaries (context without reading source)
- Feature groupings (navigate by concept, not directory)
- Authority levels (know what to trust)
- Status markers (know what's active vs. legacy)
- Priority-ranked TODOs (know what to work on)
- Related file links (know what to read together)
- Dimension warnings (know where quality is lacking)

This metadata compounds: each new annotation makes existing annotations more useful by strengthening the graph of relationships.

## When to Annotate

Not every file needs a CanopyTag entry. The rule:

**Would a 2-line summary help an agent that already has the file path?**

If the path tells you enough (`utils/unit_conversion.py`), skip it.
If the path doesn't tell you enough (`tire_pressure_v3.py` — is this active? deprecated?), annotate it.

Focus on:
- Specs, blueprints, and design docs (CanopyTag's sweet spot)
- Key domain files where status and authority matter
- Files with active TODOs
- Entrypoints that route to other files
- Anything an agent would waste time re-discovering each session

80 rich entries beat 300 thin ones.

## The Landscape

Other tools in this space take different approaches:

- **Aider's repo map**: tree-sitter AST + PageRank. Automated symbol-level indexing. Good at "what references what." No semantic understanding.
- **Cursor's indexing**: embeddings + vector DB. Automated similarity search. Good at "find similar code." Black box.
- **AGENTS.md / CLAUDE.md**: convention files with build steps and project rules. Good at "how to work in this repo." Single-file, doesn't scale to per-file metadata.
- **Serena (LSP via MCP)**: IDE-style symbol navigation for agents. Good at "find definition, find references." Structural, not semantic.

CanopyTag's niche is **curated semantic context** — authority, status, purpose, relationships, quality signals — that automated tools can't derive from code alone. The tradeoff is annotation effort vs. navigation efficiency.
