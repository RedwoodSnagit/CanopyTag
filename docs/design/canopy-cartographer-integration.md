# CanopyCartographer Integration

**Date:** 2026-06-26

**Updated:** 2026-08-02

**Status:** standalone Cartographer published; sidecar integration proposed

**Scope:** CanopyTag relationship to the standalone CanopyCartographer

The standalone project is published at
[`RedwoodSnagit/CanopyCartographer`](https://github.com/RedwoodSnagit/CanopyCartographer).
This document describes a target integration that is not yet implemented.
CanopyTag does not currently discover or render Cartographer sidecars, and its
current review feed does not automatically promote staged suggestions into
`canopy.json`.

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

CanopyTag now has a bounded local lexical catalogue search over authored paths,
titles, summaries, tags, feature metadata, open TODOs, active lifecycle reasons,
and selected review findings. That transparent layer is the baseline. Semantic
retrieval should be added only where held-out queries demonstrate vocabulary or
concept misses that the catalogue, fuzzy matching, and graph expansion do not
recover.

Useful first targets:

- embed CanopyTag titles, summaries, tags, comments, and TODO text;
- embed high-authority docs or doc headings only when the repo opts in;
- return IDs and signal scores, not large generated summaries;
- fuse semantic scores with lexical filters, authority, freshness, quality,
  centrality, and analytics heat.

Do not concatenate a whole file's metadata and source into one vector. A vector
should represent one retrievable idea. Candidate units are:

- one catalogue card: title plus concise summary;
- one open TODO, lifecycle reason, or high-confidence finding;
- one heading-bounded section from an opted-in document;
- one generated symbol synopsis from Cartographer, when provenance is exact.

Keep path, source range, feature, tags, authority, status, lifecycle state,
content fingerprint, producer, and generated time as structured metadata. Use
those fields for filtering and explanation instead of hoping an embedding
encodes them reliably.

The vector builder should therefore consume CanopyTag rather than replace it.
CanopyTag supplies compact semantic units and trustworthy filters;
CanopyCartographer supplies generated units and topology; a replaceable index
sidecar supplies similarity candidates.

The first vector experiment should be local, optional, provider-neutral, and
ignored by Git by default. No hosted embedding or repository upload should
occur without an explicit project decision. The store could be SQLite-based or
another lightweight local index, but the artifact contract matters more than
the engine.

## Dynamic Query Nodes And Emerging Vocabulary

An agent will not always know the canonical tag, and older documentation cannot
anticipate every future feature name. Exact tags provide precision but set too
low a recall ceiling on their own.

The proposed answer is an ephemeral query graph overlay:

1. Create a temporary query node containing the raw request, normalized terms,
   corpus scope, timestamp, and source/index fingerprints.
2. Attach candidate edges from exact path or symbol matches, authored tags and
   features, local lexical/fuzzy search, optional vector similarity, and
   Cartographer neighborhoods.
3. Preserve each signal separately: producer, algorithm/version, matched field
   or source range, raw score, and freshness. Do not collapse unlike scores into
   an unexplained confidence number.
4. Traverse only a bounded number of useful neighbors and return paths plus the
   reason each candidate appeared before loading full source.
5. Discard the query node after the task by default.

Repeated or unusually valuable inferred associations may be written to a
generated suggestions sidecar. They remain proposals until a deliberate review
promotes a feature alias, membership, tag, or relationship into authored
CanopyTag data.

Generated semantic clusters follow the same rule. A cluster needs a stable ID,
member weights, producer and version, input fingerprints, creation time, and an
invalidation policy. It is a view over evidence, not a new authority layer.

Useful first-stage ranking signals are BM25-style lexical relevance, conservative
edit-distance matching, tag or feature overlap, graph distance, source kind,
authority, lifecycle warnings, and optional embedding cosine similarity.
Cross-entropy, KL divergence, or Jensen-Shannon divergence are meaningful only
when comparing actual normalized distributions; they should not be used as
mathematical decoration for ordinary text similarity.

## Relevant Memory-System Lessons

This design overlaps with memory systems but serves a different primary job:
repository comprehension.

- [Open Brain (OB1)](https://github.com/NateBJones-Projects/OB1) demonstrates
  atomic semantic units, structured metadata filters, vector retrieval, and a
  small MCP interface. It is a personal-memory backend, not a code map.
- [Dr. Non's Second Brain OS](https://github.com/agentic-ai-research/second-brain-os)
  demonstrates linked Markdown views, maps of content, controlled tags, and
  automated checks for broken links, missing metadata, secrets, and drift. Its
  maintenance discipline is more transferable than its cognitive folder
  metaphor.
- [A-MEM](https://arxiv.org/abs/2502.12110) explores self-evolving,
  Zettelkasten-style memory in which new entries can create and revise links.
  The useful pattern is dynamic association; the risk is opaque or costly
  automatic mutation.
- [Graphiti](https://github.com/getzep/graphiti) separates source episodes from
  inferred entities and temporally valid facts while retaining provenance. Its
  episode/fact distinction maps well to source evidence versus generated
  suggestions.
- [Microsoft GraphRAG](https://github.com/microsoft/graphrag) is a later
  comparator for corpus-wide entity/community questions. Its LLM-heavy indexing
  is too expensive and opaque to be CanopyTag's foundation.

The suite should borrow the patterns, not absorb all five products. Crafted
metadata, generated topology, local recall, and explicit promotion are enough
to test the core hypothesis.

## Maintenance Contract For Recall

Semantic retrieval is only useful if its maintenance cost is lower than the
context it saves.

- Rebuild or incrementally update derived records from content fingerprints;
- invalidate stale records when source, catalogue metadata, producer version,
  or configuration changes;
- report artifact revision, dirty-tree state, age, and coverage on every query;
- keep authored and generated edges visibly distinct;
- never require humans or agents to write vector values;
- use automation for file kinds, hashes, headings, symbols, imports, tests, and
  freshness, while reserving meaning and trust judgments for review;
- retain the normal file tree, docs, and source search as the no-index fallback.

Before adopting embeddings, freeze a vocabulary-drift benchmark and compare an
ablation ladder: exact/filter, lexical/fuzzy, metadata expansion, graph
expansion, then optional embeddings and hybrid fusion. Measure graded retrieval
quality, wrong-corpus noise, prompt tokens, latency, explanation completeness,
and index maintenance. Keep the semantic layer only if it improves held-out
agent tasks.

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
- define and freeze the vocabulary-drift benchmark before choosing an embedding
  engine;
- keep `canopy.json` authored and portable.

CanopyTag remains useful without CanopyCartographer. CanopyCartographer becomes
more useful when CanopyTag can calibrate trust around its generated map.

## Design Rule

Crafted CanopyTag decides. Generated Cartographer discovers. Semantic search
recalls. Agents verify.
