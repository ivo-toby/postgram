# Implementation plan

1. Build the public quality harness and run it against the current search service.
   Persist baseline results before changing ranking.
2. Write failing retrieval, chunk scoring, threshold, recency, migration and
   authorization tests. Add the chunk expression GIN migration and implement
   bounded keyword/vector candidates, chunk deduplication and RRF in one query.
3. Update docs, MCP and CLI descriptions and numeric UI score displays. Verify
   that compact JSON/TOON still preserve the same result shape and score precision.
4. Extend the latency harness with a long keyword query. Run quality assertions,
   existing performance budgets and the repository verification commands.
5. Review all delegated changes, correct issues, record final evidence, commit,
   push and open a PR closing #114.

## Constitution check

- Specification precedes implementation in this feature directory.
- Search behavior stays in the transport-independent search service.
- Schema changes use a numbered migration; index write locking is documented.
- Every candidate branch reuses service authorization predicates.
- Regression tests use real PostgreSQL/pgvector and deterministic embeddings.
- Runtime settings and Docker defaults do not change.
- Verification: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`,
  `npm --prefix ui run typecheck`, `npm --prefix ui run build`,
  `npm --prefix ui test`, `npm run benchmark:quality -- --assert`,
  `npm run benchmark:search -- --assert`.

## Ranking decisions

Start with separate keyword cap 200 and RRF k=60; adjust the cap only when the
quality and latency evidence justify it. Keep the existing vector bounds.
PostgreSQL normalization 32 only maps rank to rank/(rank+1); it does not normalize
document length. Use normalization 2|32 (34) so long chunks do not accumulate an
unbounded advantage from repeated mentions. References:
https://www.postgresql.org/docs/17/textsearch-controls.html#TEXTSEARCH-RANKING
https://www.postgresql.org/docs/17/sql-createindex.html

The baseline corpus exposed two failures of raw lexeme OR under equal RRF:
shared ticket prefixes beat an identifier retrieved only lexically, and an
incidental `by` in a config key beat a semantic answer. Preserve compound terms
as conjunctions and omit standalone English stopwords in multi-term queries.
Single-word searches remain literal. Prefer keyword rank when fused scores tie
so a concise answer wins the vector/keyword rank reversal against an incidental
long document. Keep the corpus fixed after recording the baseline.

Preserve the original latency dataset and query profiles. Measure the additional
long keyword profile alongside the common-term workloads; do not rename corpus
terms or relax the existing budgets to hide retrieval cost.

Ranking all OR matches failed the unchanged latency gate (cached p95 over
500 ms). A combined OR probe limited before ranking could hide a late identifier
behind a common query term. Use independent 200-hit probes per term, deduplicate
chunks, prefer smaller observed per-term hit counts (then compound terms), and
cover-density rank only the merged 200-chunk pool. Regression cases include
`ticket ABC-1234`, `order 998877665544332211`, and `release-date ABC-1234` with the
target inserted after more than 200 common-term matches, under exact and HNSW.

Only vector candidates below the similarity floor need a direct lexical
membership check; candidates above it already qualify. This preserves the
keyword exception even when a vector candidate falls outside the keyword pool.

Split terms with `unnest(regexp_split_to_array(...))` and build each compound
tsquery with a scalar aggregate. Expanding lexemes into a grouped relation made
PostgreSQL overestimate the number of term probes, which triggered expensive
JIT compilation for a small query. The final shape retains the 200-hit caps and
passes the existing latency budgets without changing database settings.

## Delegation

Implementation workers use the user-requested GPT-5.6-Luna with reasoning max.
The parent records the spec, coordinates the baseline gate, personally reviews
changes and owns final validation and PR creation. Workers edit disjoint files.

## Initial PR evidence (6189914)

The unchanged public corpus improves exact-identifier, ISO-date, long-keyword
and Dutch category nDCG@5/MRR/recall@10 from 0 to 1. Concise-answer nDCG@5
improves from 0.796708 to 1, with MRR and recall unchanged at 1. Semantic
controls remain at 1 for all three metrics. These controlled synthetic results
measure retrieval and ranking behavior, not production relevance.

The parent's independent latency gate passes on the original 5,000-entity /
6,000-chunk corpus: cold p95 322.99ms (400ms budget), memory 57.88ms (125ms),
database 52.81ms (150ms), and long keyword 65.79ms (125ms). HNSW recall is 1.0;
captured HNSW and GIN index checks pass and cached profiles call no embedding
provider. No captured plan incurs JIT compilation.

Final verification passes: 587 backend tests, 150 UI tests, 23 CLI workspace
tests, server/CLI/UI typechecks, server/UI builds, lint, and both benchmark gates.
Sprite smoke checks cover server startup/migrations, local provider wiring,
REST store/recall/search/tasks/auth, compact CLI JSON/TOON, and read-only private
evaluation. The temporary Sprite was destroyed after validation.

## PR review follow-up

The capped per-term pool can exclude all-term matches when every term exceeds
200 hits. Add a highest-priority conjunctive probe before the existing rare-term
selection. Extend the corpus with crowded terms and a small intersection;
record its baseline against the reviewed commit before service changes.

Retain the first 24 distinct non-empty parsed term queries after stopword
filtering. Below-floor admission requires at least half of retained terms,
rounded up; vector-above-floor admission and branch ranks remain independent.
Add pasted-query and underfilled-fallback latency profiles without weakening
the original budgets. Keep the fallback implementation unless measurements
justify a larger refactor. Verify the existing NOT NULL embedding constraint,
and document score/threshold migration and the recency trade-off.

Coverage uses the actual chunk tsvector rather than capped probe membership,
which can undercount a late partial match. Materialize below-floor vector
tsvectors once before checking retained terms. Select the best whole probe
tuple during deduplication so rarity, compound priority and term order stay
associated with the same probe.

The expanded corpus has 1,295 fixtures and ten queries. The new crowded-term
category was missing all five relevant targets at 6189914; the revised service
retrieves all five, with nDCG@5 0.785467, MRR 1 and recall@10 1. Original
category metrics remain unchanged. The original baseline values still refer
to fb5f9f3 and the 630-fixture corpus; the appended category baseline refers to
the reviewed service and expanded corpus.

Parent verification passes 605 backend tests, static checks, the quality gate,
and PostgreSQL 16 smoke checks with the reported 2,000 postgram / 400 ranking /
five-intersection distribution under exact and HNSW. A late two-of-three
partial target outside the vector cap also passes on PostgreSQL 16. NULL chunk
embedding inserts fail with PostgreSQL error 23502 under the existing schema.

New latency profiles retain the original budgets and measure 300 distinct
input words (24 retained) and forced underfilled HNSW followed by exact search.
Two local attempts show varying timing spikes in different profiles, while
captured plans retain HNSW/GIN and avoid JIT; this shared host reports 12–31%
CPU steal. The unchanged CI performance gate provides final runner validation.

## Long-query performance review

Compare `6189914` and the current SQL with EXPLAIN (ANALYZE, BUFFERS) on the
same seeded database while the long-query fixture is present. Identify actual
node execution costs rather than attributing work to unexecuted coverage
subplans. Optimize that measured path, preserve authorization, coverage and
quality, and retain the existing 125ms long-query gate when the improvement
provides enough margin. Capture benchmark plans before fixture teardown.

Document that per-term caps can still miss a five-of-six common-term match
when no full conjunction exists; evaluation evidence can motivate intersection
or coverage-oriented probes in a later change.

The paired plans show the current long-query conjunction adding about 38ms of
GIN work, followed by 18 per-term GIN scans costing about 65ms. Coverage
subplans execute zero loops for this above-floor workload; ranking costs under
1ms. Use an authorized OR probe capped at 201 to detect when the entire lexical
union fits the 200-chunk pool. In that case reuse the complete union rather
than probing each term; with 201 hits retain the existing per-term selection.
Skip both paths when the conjunctive probe already fills the pool, and reuse
the conjunctive probe directly for single-term queries. Deduplicate lexemes
only in the full AND query, which preserves its boolean matching semantics;
leave the lexical OR scoring query unchanged.

Parent review confirms that authorization filters precede the new OR limit,
the complete sparse union preserves every lexical candidate, and overflow
retains the conjunction-first rarity selection. The 201-hit boundary, a full
200-hit conjunction, partial coverage outside the vector cap and 16 sparse-OR
scope/strategy cases pass in the 83-test focused search suite.

A second alternating comparison on one seeded database uses two warm-up rounds
and eight measured plans per version. Median SQL execution is 49.90ms at
6189914, 74.59ms at 2c67b1f, and 47.91ms with the optimization. The optimized
plan skips all 18 per-term probes, deduplicates shared conjunctive lexemes and
incurs no JIT. These are paired execution-plan timings, not latency-gate p95s.
The benchmark now captures full JSON plans before fixture teardown and applies
the service's HNSW iterative-scan setting; its assertions require 200 vector
candidates and one keyword candidate in the long-query plan.

The focused suite, quality gate, lint, server/CLI typechecks and build pass.
The local latency run measures long-query p95 73.33ms against the unchanged
125ms budget; pasted-query p95 is 171.72ms against 150ms on the shared host,
while its captured SQL execution is 51.15ms. All other local profiles pass,
HNSW recall is 1.0, and cached profiles make no provider calls. CI validates
all original budgets and uploads both the summary and full execution plans.

Final CI at 2918e5d passes 622 backend tests, 150 UI tests and both benchmark
gates. Long-query p95 is 54.03ms and pasted-query p95 is 79.30ms, within the
unchanged 125ms and 150ms budgets.

## Final review nits

Review 5518850306 approves the retrieval logic and leaves a cap-consistency nit.
Derive the OR overflow limit from `$17 + 1`, using the same bound parameter as
the other probes. This changes no current cap or probe selection. The parent
reviewed the one-line SQL edit; 19 existing exact/HNSW boundary, sparse-scope
and full-cap regressions and scoped lint pass.

Dense OR unions still build a GIN bitmap before LIMIT and then run the per-term
fallback. Document this accepted cost rather than changing probe order without
production timing evidence.
