# Jev Integration — Implementation Context

## Goal

Add a shadow-mode Jev retrieval judge to Postgram: for each hybrid-search candidate, ask three Noul questions (relevant, usable evidence, contradicts premise), log the judgments with current scores, change nothing user-visible, and produce the data that decides whether Jev earns a control role.

## Non-goals

- No reranking, filtering, or graph-expansion changes; search results must be byte-identical with the flag off.
- No `SemanticDecisionProvider` abstraction; one caller uses the TypeSafe TS SDK directly.
- No jevkit dependency (Python); only its band pattern is borrowed.
- No extraction, grooming, or memory-admission changes; no prompt changes to the extractor.
- No hardcoded probability cut (`if p > 0.8`); thresholds are named constants tuned only from measured data.

## Existing architecture anchors

- `src/services/search-service.ts:679 searchEntities` → hybrid retrieval entry; builds candidates, applies `0.35` floor (line 695), binary `expandGraph` handling (lines 761+).
- `src/services/search-service.ts:194-209 VECTOR_WEIGHT/BM25_WEIGHT/CANDIDATE_MULTIPLIER/CAP` → ranking constants; shadow judge logs beside these, never inside the SQL.
- `src/services/llm-provider.ts:292 createLlmProvider` → provider-factory pattern to mirror for Jev client construction.
- `src/config.ts` → zod env pattern; new `JEV_*` flags live here (follow `EXTRACTION_*` precedent).
- `tests/unit/search-scoring.test.ts`, `tests/integration/search-service.test.ts` → scoring and search coverage the shadow path must not break.

## Proposed change

New module `src/services/jev-retrieval-judge.ts`: after `runHybridSearch` resolves, for each candidate send one `client.systemOne` call with state `{query, chunk, entity metadata, score/similarity}` and three Nouls; append `{nouls, model, latencyMs}` to the existing `search.completed` debug log. Gated by `JEV_SHADOW_ENABLED` (default false). Off = zero new imports executed, zero behavior change.

## Data flow

Before:

```text
query → embed → hybrid SQL → threshold → results → consumer
```

After (shadow):

```text
query → embed → hybrid SQL → threshold → results ─┬─→ consumer (unchanged)
                                                  └─→ Jev judge (async, best-effort) → evaluation log
```

## Jev decisions

### relevant

State: `{query, chunk_text, entity_type/tags, similarity, score}`. Keep minimal — large irrelevant state distracts (jaggedness #5).
Question: `Does this passage help answer the query?` — literal, exact condition, no negation.
Primitive: Noul → P(yes).
Consumer: `route()` in a later phase; in shadow, log only.
Fallback: on any error/timeout, skip logging for that candidate (fail open, never partial).
How evaluated: precision/recall vs. relevance labels; Brier score / ECE on P(yes).

### states_usable_evidence

State: same as above.
Question: `Does this passage state a fact usable in an answer?` (not merely on-topic).
Primitive: Noul.
Consumer: log only in shadow; later distinguishes keep vs. drop-among-relevant.
Fallback: same fail-open skip.
How evaluated: agreement with labels; drop-rate among irrelevant without recall loss.

### contradicts_premise

State: same as above.
Question: `Does this passage contradict something the query takes for granted?`
Primitive: Noul.
Consumer: log only; later routes conflicts to a separate evidence block.
Fallback: same fail-open skip.
How evaluated: flag rate on planted/known contradiction pairs.

## Deterministic policy

All policy stays in code: `route()` thresholds as named constants (cookbook `THRESHOLDS` pattern), `ROW_NUMBER()` dedup and score floor unchanged, graph expansion untouched. Jev output is advisory data until calibration bands are measured from the shadow log; low-confidence answers always fail open (keep candidate). Act/confirm/escalate bands are set from measured precision, never guessed.

## Feature flag / fallback behavior

- `JEV_SHADOW_ENABLED` (default `false`), `JEV_API_KEY`, `JEV_MODEL` (e.g. `jev-1.13`), `JEV_TIMEOUT_MS` (default ~3000), `JEV_MAX_CANDIDATES` (cap per query, default ~10).
- Flag off: code path not entered; results byte-identical; no new dependency loaded at runtime.
- Flag on, API error/timeout: per-candidate skip, search still succeeds; log `jev.unavailable` with latency. Never throw into the search path, never return partial judgments as decisions.

## Observability requirements

- Extend `search.completed` log with per-candidate `{entityId, score, similarity, nouls:{relevant, evidence, contradicts}, model, latencyMs}`.
- Log state hash, never full chunk text twice (state already in DB); keep log queryable by query text hash.
- Record token/cost estimate per call for the cost-per-query metric.
- Dashboard query: drop-candidate precision vs. recall over time; calibration curve per question.

## Evaluation requirements

- Dataset: replay logged queries with candidate sets; human-label a sample, strong-LLM-grade the rest.
- Baselines in order: current behavior → vector-only → deterministic heuristic → cheap generative classifier → Jev.
- Metrics: precision/recall, FPR/FNR, Brier/ECE, downstream answer quality, context tokens, latency, cost.
- Success: material irrelevant-context rejection at recall ≥ baseline, answers equal-or-better, calibration good enough to set bands. Failure on any recall regression, no win over cheap classifier, or unusable calibration.

## Acceptance criteria

- [ ] Flag off: existing search/extraction/grooming suites pass unchanged; results identical.
- [ ] Flag on: judgments logged for ≤ `JEV_MAX_CANDIDATES` candidates/query; search latency budget documented.
- [ ] Any Jev error degrades to skip; search never fails because of Jev (test by blocking the endpoint).
- [ ] No numeric/date/counting questions sent to Jev; state contains only text + scores.
- [ ] Shadow log contains query hash, candidate id, scores, three nouls, model, latency — enough to compute all metrics offline.

## Explicitly deferred

- Using judgments to filter/rerank (needs success criteria met first).
- Graph-expansion gating (needs expansion-usefulness logging built first).
- Extraction grounding validation (follow-up experiment; cheaper extractor + Jev gate).
- Grooming classification and memory-admission Choice (no demonstrated pain; rejected/deferred in decision doc).
- Any shared decision-provider abstraction (until a second backend exists).
- TinySDD artifacts themselves: turn this packet into a task brief + context-compiler manifest (facts + exact source ranges above, 96 KiB cap) at implementation time.
