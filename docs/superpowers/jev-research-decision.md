# Postgram × Jev — Research & Architecture Decision

## Problem

Postgram's retrieval ranks candidates with a fixed linear formula (`0.6 × cosine + 0.4 × normalized BM25`, recency boost, hard `0.35` score floor) and either expands the graph for **all** results or none. Similarity is not relevance: lexically similar but useless chunks consume context window, while the score threshold is hand-tuned, not measured. Separately, extraction trusts the extractor LLM's **self-reported** confidence (missing values default to `0.5` in code — proof the signal is weak) against hand-tuned per-type floors. Both are fuzzy semantic judgments currently made by arithmetic or by the model grading its own homework.

## Current architecture

**Retrieval** (`src/services/search-service.ts`): `searchEntities` embeds the query, then runs hybrid SQL — candidate pool `limit × 20` (cap 500), exact or HNSW strategy, `ROW_NUMBER()` dedup per entity, score threshold `$15` (default `0.35`, line 695), final `LIMIT`. Graph handling is binary: `expandGraph=true` expands every result (two batched queries, lines 776+); otherwise only edge-count summaries are attached. No per-candidate relevance judgment exists.

**Extraction** (`src/services/extraction-service.ts`, `enrichment-worker.ts`, `llm-provider.ts`): a general-purpose LLM (`openai | anthropic | ollama | openai-compatible`, via `createLlmProvider`) returns small structured JSON (`EXTRACTION_SCHEMA`: target_name/type/relation/confidence). `parseExtractionResponse` decodes it; `findMatchingEntityByName` resolves targets in three stages (exact → substring-without-chunks → semantic ≥ 0.5); auto-create is gated by self-reported confidence floors (global `0.7`, `person: 0.5`, `project: 0.6` — the per-type override exists because the global floor blocked every first-mention person). A semantic-neighbor second pass links topical siblings as `related_to` (≥ 0.65, max 10). Memories are queued per `EXTRACTION_MEMORY_MODE` (`embed_only | extract_durable | extract_all`).

**Memory grooming** (`src/services/memory-grooming-service.ts`): batch LLM classification with structured schemas — session promotion (`{promote: boolean}`), durable grooming (`{outcome: keep | needs_grooming | archive | superseded}`). Already operator-gated (`--yes`, dry-run).

**Config** (`src/config.ts`): zod-parsed env; new flags follow the `EXTRACTION_*` pattern. Tests: `tests/unit/search-scoring.test.ts`, `tests/integration/{search-service,extraction-service,memory-grooming-service}.test.ts`.

## Jev capabilities that matter

- **API shape**: `state` (string or structured JSON) + typed questions → structured answers. One request evaluates one state against several questions; all see the same state ([state docs](https://docs.typesafe.ai/concepts/state.md)).
- **Noul** returns `noul` = P(yes) — the probability *is* the signal, no `confidence` field ([noul](https://docs.typesafe.ai/primitives/noul.md)). **Choice/Score** return selection + full `probabilities` distribution + `confidence` derived from distribution peakedness ([confidence](https://docs.typesafe.ai/confidence.md)).
- **Ask one atomic judgment per question**; combine in code ([primitives](https://docs.typesafe.ai/primitives.md)). Composite scoring and confidence-gated routing (act / confirm / escalate bands scaled to stakes) are the documented patterns ([patterns](https://docs.typesafe.ai/patterns/composite-scoring.md), [confidence-routing](https://docs.typesafe.ai/patterns/confidence-routing.md)).
- **Directly applicable cookbook evidence**: RAG-passage classification (one request per passage, 4 Nouls — relevant, usable evidence, contradicts premise, instructs model — then `route()` thresholds in code; [classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages.md)); rerank over BM25 shortlists raising top-1 5%→18% ([rerank](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md)); entity alignment via one Score whose levels *are* the actions (merge / leave / escalate — "no threshold to fit"; [entity alignment](https://docs.typesafe.ai/cookbooks/entity_alignment.md)).
- **TS SDK**: `@typesafe-ai/sdk` (Node 20+), `client.systemOne({state, questions})` with `choice()`/`score()`/`noul()` builders ([JS SDK](https://docs.typesafe.ai/sdk/javascript.md)).
- **Limits** ([jaggedness, jev-1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)): literal readings (write exact conditions); no math/counting/dates (keep in code); large irrelevant state distracts (send minimal state); no structural invariants (ask one way, enforce in code); can't generate (propose candidates in code, let Jev pick); English primary.
- **Community jevkit** ([jevkit](https://github.com/tegersdorfer-collab/jevkit)) is example code, not authority — but its patterns corroborate the docs: severity-scaled bands instead of bare thresholds, measured calibration loop (`suggest_bands`), guard questions for untrusted text, `JevUnavailable` (never partial results). Do not import it; borrow the band idea.

## Candidate integration points

### 1. Retrieval admission (primary experiment)

- **Current mechanism**: linear score + `0.35` floor; threshold filters, nothing judges relevance.
- **Jev state**: `{query, candidate chunk text, entity metadata (type/tags), current score/similarity}` — one request per candidate, mirroring the RAG cookbook.
- **Questions**: `relevant` (Noul), `states_usable_evidence` (Noul), `contradicts_premise` (Noul). Fan out together, combine in code.
- **Primitive(s)**: Noul × 3.
- **Policy consumer**: `route()` in code — keep / flag-as-conflict / drop; recall-safe defaults (drop only high-P(irrelevant)).
- **Expected benefit**: drops irrelevant and injection-carrying context before the consumer agent; separates conflicting evidence into its own block.
- **Primary failure mode**: miscalibrated drop of useful recall.
- **Evaluation difficulty**: medium — needs relevance labels on query/candidate pairs, obtainable by replaying logged queries with human or strong-LLM grading.

### 2. Graph-expansion gating (follow-up)

- **Current mechanism**: `expandGraph` expands all results unconditionally.
- **Jev state**: `{query, entity summary, edge summary (relations/counts)}`.
- **Questions**: `expansion_likely_useful` (Noul).
- **Primitive(s)**: Noul.
- **Policy consumer**: skip neighbor fetch below band; always expand on low confidence (fail open).
- **Expected benefit**: token/latency savings on broad queries.
- **Primary failure mode**: skipping the one hop that mattered.
- **Evaluation difficulty**: high — requires labels on expansion usefulness, which Postgram does not log today.

### 3. Extraction grounding validation (follow-up)

- **Current mechanism**: extractor's self-reported confidence vs. per-type floors; missing confidence defaults to `0.5`.
- **Jev state**: `{source content, extracted (target_name, target_type, relation)}`.
- **Questions**: `is_grounded_in_source` (Noul); `relation_type` (Choice over RELATIONS) for ambiguous cases only.
- **Primitive(s)**: Noul, then Choice on escalate.
- **Policy consumer**: accept / reject / escalate to stronger extractor; enables a cheaper candidate extractor with Jev as gate.
- **Expected benefit**: replaces uncalibrated self-grading with a calibrated judge; fewer junk stubs and wrong-typed edges.
- **Primary failure mode**: added cost/latency per extraction; correlated errors if extractor and judge share failure modes.
- **Evaluation difficulty**: medium-high — grounding labels need human review; auto-create rate and re-extraction rate are proxy metrics.

### 4. Grooming outcome classification — deferred

General-LLM calls already return a small enum, and every destructive action is operator-confirmed (`--yes`, dry-run). The stakes are managed and the volume is batch-low; Jev adds calibration Postgram doesn't need here. Revisit only if grooming volume forces full automation.

### 5. Memory admission Choice (durable / session / ignore) — rejected

No fuzzy decision exists at the write path: `memory_role` is set deterministically at write time and enforced by `scopedMemoryVisibilitySql`. There is nothing to replace; adding a Jev gate would invent latency for a solved problem.

## Recommendation

**Primary experiment**: shadow-mode retrieval admission (candidate 1). It targets the largest context-window cost, is non-destructive by construction, replays offline, and has the strongest cookbook precedent.

**Follow-up**: extraction grounding validation (candidate 3) — but only after retrieval admission shows calibrated probabilities on Postgram data, since both depend on trusting Jev's numbers.

**Deferred**: expansion gating (needs logging built first), grooming (no pain), memory admission (no problem).

## Proposed architecture

No new abstraction in experiment 1. One module (e.g. `src/services/jev-retrieval-judge.ts`) calls the TS SDK directly behind `JEV_*` env flags (see `src/config.ts` pattern), invoked from the search path in shadow mode only; all thresholds live as named constants in code (cookbook `THRESHOLDS` pattern). A `SemanticDecisionProvider` interface is explicitly **not** warranted until a second decision backend exists — one caller does not need an interface. Policy stays deterministic code; Jev output is advisory until calibration proves otherwise. Flag-off path is byte-identical current behavior.

## Evaluation

- **Dataset/traces**: replay logged historical queries with their candidate sets (query, chunk, score/rank); label relevance (human sample + strong-LLM grading for scale). Log Jev judgments, scores, token/context size, latency, cost per the shadow-mode design in `jev.md`.
- **Baselines** (in order): current behavior → vector-score-only → deterministic heuristic → cheap generative classifier → Jev.
- **Metrics**: precision/recall and FPR/FNR on admission; Brier score / ECE for calibration; downstream answer quality; context tokens, latency, cost per query.
- **Success criteria**: reject a material share of irrelevant context with recall ≥ baseline, equal-or-better downstream answers, and calibration error low enough that bands (not a magic `0.8`) drive policy.
- **Failure criteria**: any recall regression vs. baseline; no statistically meaningful win over the cheap classifier; or probabilities too miscalibrated to set bands — any of these kills the integration.

## Risks / unknowns

Calibration on Postgram's domain (short, noisy personal notes — not auth docs); confident-wrong answers on literal readings; English-language bias on non-English content; state-size sensitivity (keep candidate state minimal); per-candidate API cost/latency at retrieval volume; vendor dependency and availability (fail open via `JevUnavailable`-style handling, never partial); candidate content leaving the VPC (privacy); the possibility that a reranker or tuned threshold is simply better/cheaper — which the baselines are designed to reveal.

## Decision log

1. Jev is a decision layer, not a replacement for embeddings/BM25/graph/code — decided from primitives + cookbook evidence.
2. No `SemanticDecisionProvider` abstraction until a second backend exists (YAGNI).
3. Calibration is measured (bands from data, jevkit-style), never a hardcoded probability cut.
4. Shadow mode first; Jev controls nothing until success criteria are met.
5. Numeric/date/counting logic stays in SQL/code per jaggedness docs — Jev never sees such questions.
6. Retrieval admission beats extraction validation as experiment 1: cheaper labels, bigger context savings, stronger precedent.
7. Do not depend on jevkit (Python, unvetted); reimplement only the band pattern in TS.
8. TinySDD handoff is the context packet below, shaped for TinySDD's task-brief + context-compiler manifest (facts + exact source ranges, 96 KiB cap).

## Final question

**What is the smallest Jev integration that tells us whether System One models materially improve Postgram?** A shadow-mode retrieval judge: for each candidate from the existing hybrid search, send `{query, chunk, metadata, scores}` with three Nouls (`relevant`, `states_usable_evidence`, `contradicts_premise`) in one fan-out request, log judgments alongside current scores without changing results, and measure precision/recall, calibration, and downstream answer quality against the four baselines. One module, one flag, zero behavior change — the log alone answers the question.
