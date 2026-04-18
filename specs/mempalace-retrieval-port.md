# MemPalace Retrieval: Portability Assessment

**Status**: Exploratory / parking doc — not scheduled
**Created**: 2026-04-18
**Author**: Ivo (via Claude)
**Related**: `specs/001-phase1-mvp/` (current search implementation)

## Purpose

Evaluate whether [MemPalace](https://github.com/MemPalace/mempalace)'s memory
retrieval approach is worth porting into PostGram, and — if so — sketch what
that would actually look like on top of our PostgreSQL + pgvector stack.

This is a feasibility note. No implementation commitment.

## What MemPalace Actually Does (demystified)

MemPalace markets itself as a "memory palace" with Wings → Rooms → Halls →
Drawers → Closets → Tunnels, plus a `wake-up` command that returns critical
facts in ~170 tokens, AAAK compression at 30x, and a claimed 34% retrieval
improvement over flat semantic search.

After reading the code and independent benchmarks (see sources), the reality
is more modest:

1. **Spatial structure is metadata tags on ChromaDB vectors**, not separate
   collections or a novel index. `wing`, `room`, `hall`, `importance`, and
   `timestamp` are just fields filtered via ChromaDB's `where` clause before
   vector similarity ranking.
2. **Classification is deterministic regex + keyword scoring**, not LLM. Five
   memory types (decisions, preferences, milestones, problems, emotional
   moments) detected via ~116 patterns. Room assignment picks the highest
   keyword-count domain from the first 2,000 chars of a chunk.
3. **The "34% improvement"** is metadata filtering reducing candidate set
   size, not a smarter ranker. Independent LongMemEval runs: raw
   ChromaDB = 96.6% R@5, wing+room scoped = 94.8%, AAAK-compressed = 84.2%.
   Palace structure adds no ranking intelligence; compression actively hurts.
4. **`wake-up` is L0 (pinned identity facts in SQLite) + L1 (top-15 drawers
   by importance, grouped by room)**. Token budget varies 170–900 in
   practice because most drawers default to importance=3, so L1 is often
   an insertion-order slice rather than a curated set.
5. **AAAK compression** is lossy abbreviation (pipe-delimited structured
   English, 3-letter entity codes) decoded by an LLM at read time. Drops
   retrieval accuracy 12.4pp; the "lossless" claim has been walked back.
6. **Optional Claude Haiku reranking** over top-20 vector hits pushes R@5
   to ~98.4% at ~$0.001/query.

Sources:
- https://github.com/MemPalace/mempalace
- https://github.com/lhl/agentic-memory/blob/main/ANALYSIS-mempalace.md
- https://github.com/MemPalace/mempalace/issues/39 (benchmarks)
- https://github.com/MemPalace/mempalace/issues/422 (AAAK analysis)

## What Maps Cleanly to PostGram

PostGram already has:

- Typed entities (`type`, `tags`, `visibility`, `owner`, `metadata` JSONB).
- Chunks with pgvector embeddings and HNSW indices.
- Hybrid BM25 + vector ranking with recency weighting.
- Typed edges for graph expansion.
- Async enrichment pipeline.

So the MemPalace mechanics fall into three buckets:

### Bucket 1 — Already Covered

| MemPalace feature | PostGram equivalent |
|---|---|
| Wing/Room/Hall metadata filter | `tags`, `type`, `owner`, `visibility`, `metadata` JSONB + filter-before-vector search |
| Verbatim preservation | Entities store original content, chunks preserve segments |
| Cross-wing "tunnels" | Typed edges (`related_to`, `mentioned_in`) with graph expansion |
| Knowledge graph (triples in SQLite) | `edges` table with confidence scores |
| Local/offline operation | Already supported via Ollama and deterministic hash fallback |

No port needed. Anyone who wants palace-style tagging can use existing tags
and metadata with a documented convention.

### Bucket 2 — Worth Adopting

These are legitimately useful ideas that PostGram doesn't yet implement:

1. **`wake-up` / context-priming endpoint.** A single call that returns a
   small, budgeted pack of high-importance entities for an agent's session
   start. This is a real UX improvement over "search first, learn context
   second."

2. **Explicit importance score on entities.** Currently implicit in recency
   + relevance blending. A first-class `importance` column (user-set or
   LLM-scored during enrichment) enables wake-up and better ranking.

3. **Progressive retrieval tiers (L0/L1/L2/L3).** Token-budgeted responses
   where callers can ask for "identity only" (L0), "warm context" (L1), or
   "full search" (L3). Maps well to MCP where context windows matter.

4. **LLM reranking as an optional last-mile step.** We already have LLM
   adapters for enrichment. Adding a rerank pass on top-20 candidates is a
   small addition with a measurable accuracy lift.

5. **Deterministic classifier as an enrichment fallback.** Regex + keyword
   scoring to auto-tag ingested content when no LLM is configured. Keeps
   the no-API-cost path viable.

### Bucket 3 — Skip

| MemPalace feature | Why skip |
|---|---|
| AAAK compression | 12.4pp accuracy loss, ambiguous decode across LLMs, no real win on PostgreSQL where storage is cheap |
| Fixed Wing/Room/Hall taxonomy | Our `type` + `tags` + `metadata` already does this more flexibly; hardcoding the taxonomy is a regression |
| Rule-based regex classification as primary | We have LLM extraction; regex should be a fallback, not the main path |
| Separate "spatial" MCP tools | Would bloat our tool surface; existing `search`/`recall` with richer filters covers it |

## Proposed Implementation Sketch

If and when we pick this up, the minimum viable port is roughly:

### 1. Entity importance score

Migration: add `importance SMALLINT DEFAULT 3 CHECK (importance BETWEEN 1 AND 5)` to `entities`.

- Settable via `store` / `update` (CLI, REST, MCP).
- Optionally auto-scored by the enrichment worker using the existing LLM
  adapter with a scoring prompt, cached in `metadata.importance_reason`.

### 2. Wake-up endpoint

New MCP tool + REST route: `wake_up(budget_tokens, wing?, owner?)`.

- L0: pinned entities (new `pinned BOOLEAN` column, indexed).
- L1: top-N entities by `importance DESC, updated_at DESC` within filter
  scope, trimmed to fit token budget.
- Returns a compact "headline + snippet" format, not full chunks.

Token budget default: 800. Pinned set hard-capped at ~200 tokens.

### 3. Progressive search tiers

Extend existing `/search` and MCP `search` with a `tier` parameter:

- `tier=identity` → pinned + top importance only.
- `tier=warm` → current hybrid search, small N.
- `tier=full` → current hybrid search, large N + graph expansion.

No new tables. Just response-shape and N-selection logic.

### 4. Optional LLM rerank

Add `rerank: boolean` flag to search. When set, pass top-20 hybrid
candidates through the configured LLM adapter with a pairwise-or-listwise
rerank prompt. Reuses existing adapter infra; adds latency + cost, so
opt-in per call.

### 5. Deterministic classifier (stretch)

A TypeScript port of MemPalace's regex patterns as a fallback tag/type
suggester that runs when no LLM is configured. Output goes into `tags` and
a `metadata.classifier_hints` field, never overwriting explicit user input.

## Non-Goals

- Do not adopt the Wing/Room/Hall vocabulary as a fixed taxonomy.
- Do not port AAAK compression.
- Do not build separate spatial MCP tools (`mempalace mine`, etc.).
- Do not target LongMemEval benchmark scores as a success metric — our
  workload is mixed entity types, not conversation transcripts.

## Risk / Open Questions

1. **Importance scoring quality.** If LLM-scored, cost and consistency
   across re-runs are unclear. Manual-only might be fine for a personal
   system.
2. **Pin lifecycle.** Who pins? Does pinning expire? Should the
   enrichment worker ever unpin stale entries?
3. **Rerank cost model.** Needs to be off by default; MCP clients will
   need a way to request it without breaking latency SLOs.
4. **Wake-up for multi-owner deployments.** Should L0 be owner-scoped,
   visibility-scoped, or both? Pins probably need an owner.
5. **Benchmark harness.** Worth building a small internal eval (recall@k
   on a held-out set of our own entities) before and after adopting any
   of this, rather than trusting MemPalace's numbers.

## Recommendation

The retrieval mechanics are largely something PostGram already has in a
more flexible form. The genuinely portable pieces are **importance
scoring**, a **wake-up endpoint**, **progressive tiers**, and **optional
LLM rerank**. Those are each small, additive changes — no schema upheaval,
no vocabulary lock-in.

Suggest revisiting after Phase 1 MVP stabilizes. If picked up, start with
importance + wake-up (highest user-visible value), then tiers and rerank
as separate phases.
