# Surprise-Based Navigation & Feature Traversal

**Date:** 2026-04-01
**Source:** Design thinking session — Shannon entropy applied to agent repo navigation

---

## Core Insight

Agents benefit more from knowing **where their assumptions are wrong** than from getting summaries of what exists. A good annotation should tell the agent what would change in its mental model, not just describe contents.

> "The math is standard; the systems use is not."

Surprise, cross-entropy, and KL divergence are foundational to how LLMs train and evaluate. But using expectation-violation as an explicit inter-agent communication primitive over a repo tree is a novel composition, not a stock pattern. The closest precedents are intrinsic-motivation RL and active-inference research — influential but not mainstream in deployed LLM agent stacks.

---

## Two Ideas

### 1. Feature-Based Path Traversal (Priority)

Agents don't explore repos by directory — they follow concerns. "I'm working on auth" should yield a cross-cutting path: `middleware/auth.ts` -> `models/user.ts` -> `tests/auth.spec.ts` -> `docs/auth-flow.md`. This is the repo equivalent of following a thread through a graph, not walking a tree.

CanopyTag's tag and feature system already enables this. The missing piece is a query mode that returns a **feature-organized path** rather than a flat file list.

Concrete shape:
- `canopytag query --feature auth --detail medium-high` returns files grouped by feature, ordered by authority and relevance
- Each file carries its role in the feature path (spec, implementation, test, config, doc)
- Related features surface as branches: "auth touches session management and RBAC"

This is the single most useful idea from the surprise discussion, because feature traversal IS expectation-relative navigation — the feature context shapes what's relevant and what's surprising.

### 2. Surprise Annotations (Lightweight)

Rather than building a probabilistic surprise engine, add a simple annotation mechanism for expectation violations:

**A "gotchas" field per file** — free-text or tags flagging where a file's role doesn't match what you'd guess from its name/location/context:
- "bypasses middleware despite being in the middleware directory"
- "naming suggests utility but this is the only place auth scope is enforced"
- "mutable global state in an otherwise pure module"
- "leaf-looking file is actually a hub with 15 inbound dependencies"

**Drift detection as automated surprise** — `canopytag audit --check drift` flags files where annotations diverge from observed structure. This is Gap 4 (semantic drift) reframed: drift IS surprise that nobody annotated yet.

**Progressive depth as surprise filtering** — quick depth already acts as "only tell me what breaks expectations." The surprise framing validates this design: silence means "matches schema," speech means "update needed."

---

## What NOT to Build

- **Formal probabilistic priors over file contents.** Agents don't have explicit probability distributions. Heuristics from naming, paths, and structure are sufficient.
- **Typed SurprisePacket inter-agent protocol.** Agents communicate through context windows. A well-written annotation with a gotchas field IS the surprise packet.
- **Task-weighted surprise vectors.** Defining weight profiles per task type adds design surface for uncertain value. Progressive query depth + feature filtering already handles task-shaping.
- **KL divergence or information bottleneck computations.** The math sounds precise but requires models we don't have. The heuristic version ("does this tell the agent something it wouldn't guess?") captures the same value.

---

## Connection to Existing Design

| Existing CanopyTag Feature | Surprise Interpretation |
|---|---|
| Authority levels | High authority in unexpected location = surprise signal |
| Stability scores | Low stability = "your model of this file may be wrong soon" |
| Status (active/deprecated) | Deprecated file still being imported = high surprise |
| Progressive query depth | Quick = "only surprises"; Full = "everything" |
| Related/Connected | Connected files reveal unexpected structural dependencies |
| Semantic drift detection (Gap 4) | Drift = surprise that hasn't been annotated yet |

---

## Open Questions

- How should feature paths handle files that belong to multiple features? (Intersection nodes are likely high-value surprise candidates)
- Should gotchas be agent-writable or human-only? Agent-written gotchas could propagate hallucinated surprises.
- What's the right granularity for feature traversal — file-level, export-level, section-level?
- Can feature paths be inferred from existing tags + connected relationships, or do they need explicit curation?
