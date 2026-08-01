# CanopyCartographer Integration

**Date:** 2026-06-26

**Status:** proposed architecture

**Scope:** CanopyTag relationship to the emerging standalone CanopyCartographer

This document describes a target integration. CanopyTag does not currently
discover or render Cartographer sidecars, and its current review feed does not
automatically promote staged suggestions into `canopy.json`.

## Summary

CanopyTag should remain the authored semantic layer of the Canopy Suite.
CanopyCartographer should become the generated map layer. The two should
interoperate through sidecar artifacts, not by merging generated structure
directly into `canopy.json`.

This keeps CanopyTag small, local-first, and reviewable while allowing richer
repo maps, adapter-specific structure, semantic recall, and future graph-based
retrieval.

## The Product Question

The goal is not to build a search layer for its own sake.

Search answers: where are the candidates?

CanopyTag answers: what does the repo owner or agent believe about these files,
how authoritative are they, what status are they in, and what should be trusted?

CanopyCartographer answers: what generated structure, centrality, semantic
recall, and adapter evidence can help an agent route through the repo faster?

The genuinely helpful product is a comprehension framework: a way to create a
small, explainable context pack that helps agents form a better working model
before they read or edit code. Search, vectors, graph traversal, and PageRank are
ingredients, not the product.

## Proposed Suite Boundaries

| Project | Owns | Boundary |
|---|---|---|
| CanopyTag | Crafted semantic metadata and UI | Should not become a parser or vector DB |
| CanopyCartographer | Generated graph artifacts, rankings, and suggestions | Should not define product truth |
| Project adapters | Stack- or domain-specific evidence | Should not live in the generic core |
| Symbol indexers | Exact-symbol graph extraction | Should not replace product/semantic context |

CanopyTag owns canonical feature IDs, feature descriptions, and accepted
feature membership. Cartographer and stack adapters may propose feature nodes,
aliases, or memberships as generated evidence, but they should not silently
rewrite that authored taxonomy.

## Sidecar Layout

CanopyTag should continue to treat `canopytag/canopy.json` as the crafted source
of truth. Generated artifacts should live under a separate sidecar directory:

```text
canopytag/
  canopy.json
  agent_manifest.json
  generated/
    cartography.json
    suggestions.json
    centrality.json
    semantic.sqlite
```

Small generated JSON artifacts may be committed when a repo wants shared
cartography. Larger local-only stores, especially vector indexes, should usually
be ignored and regenerated.

Every sidecar must declare its schema version, producer, source revision or
input fingerprint, generation time, and root-relative evidence paths. Local
SQLite, embedding, and cache artifacts should be ignored by default unless a
repository explicitly adopts a reviewed sharing policy.

## What CanopyTag Should Read

CanopyTag can safely consume generated cartography when it preserves provenance:

- generated relation edges with `source_tool`, `confidence`, and evidence;
- centrality or attention rankings with inspectable signals;
- suggestions that can be staged into `agent_manifest.json`;
- semantic recall results over Canopy summaries, docs, or file metadata.

CanopyTag should render these as generated hints. It should not silently convert
them into `related_files`.

## Promotion Flow

Generated edges are useful immediately as routing hints, but they become crafted
truth only through review.

Target candidate flow:

1. CanopyCartographer emits `suggestions.json`.
2. CanopyTag displays or exposes suggestions in CLI/MCP.
3. A human or agent accepts, fixes, or rejects a suggestion.
4. A future explicit promotion action updates `canopy.json` and records review
   history in `agent_manifest.json`.

Today, `agent_manifest.json` can stage suggestions and record review activity,
but it does not apply accepted suggestions to `canopy.json`. The existing
activity-feed pattern is still the intended foundation: review is a confidence
layer, not a hard gate, and promotion must remain an explicit operation.

## Semantic And Vector Search

Semantic search belongs in the suite as recall, not as authority.

Useful first targets:

- embed CanopyTag titles, summaries, tags, comments, and TODO text;
- embed high-authority docs or doc headings only when the repo opts in;
- return IDs and signal scores, not large generated summaries;
- fuse semantic scores with lexical filters, authority, freshness, quality,
  centrality, and analytics heat.

The first implementation should be local and optional. sqlite-vec is a plausible
experiment for the vector store, but CanopyTag should not require it.

## LangGraph And GraphRAG

LangGraph is a possible workflow runner, not the map. It may fit later for
long-running jobs such as scan, embed, propose, pause for review, and promote.
It should not be required for basic query or context commands.

GraphRAG-style extraction is a research path for large documentation bases. It
may propose communities, summaries, and relationships, but it is too heavy and
opaque to be the first foundation. If tested, its output should enter through
the same generated artifact contract and suggestion flow as every other
producer.

## CanopyTag Roadmap Implications

Near-term CanopyTag work should stay modest:

- document the sidecar contract;
- add generated artifact discovery without making it mandatory;
- expose generated hints in `context` or a future `guide` command;
- add suggestion review ergonomics before auto-promotion;
- keep `canopy.json` authored and portable.

CanopyTag remains useful without CanopyCartographer. CanopyCartographer becomes
more useful when CanopyTag can calibrate trust around its generated map.

## Design Rule

Crafted CanopyTag decides. Generated Cartographer discovers. Semantic search
recalls. Agents verify.
