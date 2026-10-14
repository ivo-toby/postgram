# Hybrid search relevance

Issue: https://github.com/ivo-toby/postgram/issues/114

## Behavior

Search retrieves both semantic neighbors and chunks matching query lexemes using
PostgreSQL's `simple` configuration. Keyword retrieval uses OR across query
terms, so a partial match can enter a bounded candidate branch even for long
keyword lists. Components of a compound term stay conjunctive: `ABC-1234`
matches the complete identifier's lexemes rather than every ticket sharing
`ABC`. Multi-term queries omit standalone English stopwords to prevent weak
function-word matches from displacing semantic answers. Single-term queries
retain those words, and all retained terms still use `simple` matching.
All branches enforce the existing visibility, type, tag, owner, archive,
memory-role and client-scoped memory restrictions before ranking.

Keyword retrieval retains at most 24 distinct parsed term queries in their
original order after removing empty terms and multi-term English stopwords.
The full original text still goes to the embedding provider. A separate
200-hit conjunctive probe ANDs all retained term queries, deduplicating shared
lexemes without changing boolean matching. A single retained term or 200
conjunctive hits supplies the keyword pool directly. Otherwise, an authorized
OR probe capped at 201 detects whether the complete lexical union fits the
200-chunk pool. A union of at most 200 chunks supplies that complete pool;
201 hits trigger independent 200-hit probes for each retained term, with full
conjunction hits taking precedence. After chunk deduplication, rarer term probes
take priority over common terms; compound terms break rarity ties before
standalone terms. This keeps a late identifier or order number discoverable
even when another query term matches many chunks, and bounds expensive content
parsing and ranking. Unordered GIN probes can select different capped hits when
more than 200 authorized chunks match. When the full conjunction is absent,
independent probes can still miss a five-of-six common-term match; intersection
probes are a possible future improvement requiring evaluation evidence.
Keyword ranks are approximate within the bounded pool, like the existing
bounded vector candidate retrieval. Lexical OR scoring remains unchanged.
The OR overflow probe uses the same bound keyword cap plus one. For dense
queries that overflow, GIN builds the OR bitmap before the limit and per-term
probes still run, adding retrieval work. Production timing evidence may justify
changing probe order; the current path remains subject to the latency budgets.

Candidates are deduplicated by chunk, then scored using reciprocal rank fusion:
`1 / (60 + vector_rank) + 1 / (60 + keyword_rank)`. An absent branch contributes
zero. Equal fused scores prefer the better keyword rank, then vector rank and
stable IDs. Keyword ranks use chunk content and cover-density ranking with
document length normalization. Entity deduplication, threshold filtering and
result limits remain in SQL; content is hydrated only for returned rows.

`threshold` is a floor on cosine similarity. A candidate is eligible when its
similarity meets the threshold OR its chunk matches at least half the retained
distinct term queries (rounded up). A compound identifier is one term query;
single-term searches require that term. This prevents a lone common word in a
multi-term query from granting a below-floor exception. The fused
`score` is a relative ordering value, not a probability or percentage. Recency
continues to multiply the fused score, with a true 30-day half-life.

Exact, HNSW and bounded HNSW-to-exact fallback remain available. The fallback
decision counts vector candidates alone. Empty or punctuation-only keyword
queries retain semantic retrieval. Query punctuation is treated as text rather
than executable tsquery syntax. Embedding failures continue to fail the search.

## Storage and rollout

Migration 017 adds an expression GIN index on
`to_tsvector('simple', chunks.content)`. No generated column or row backfill is
needed. The existing transactional migration runner builds the index normally:
reads remain available, writes to chunks wait until migration commit. Operators
should schedule deployment accordingly; CONCURRENTLY cannot run in this runner.
The entity keyword index remains available for existing callers.

## Evaluation and contracts

A public synthetic corpus and `benchmark:quality` report nDCG@5, MRR and recall@10
per category: exact identifiers, long documents versus concise answers, ISO
dates, long keyword lists, Dutch, crowded common terms and semantic controls. Record pre-change numbers
before ranking changes. CI asserts identifier targets in the top three, concise
answers above incidental mentions and no semantic-control nDCG regression.

The public baseline and default gate use exact search to isolate rank quality
from ANN approximation. HNSW retains separate latency, index-use, recall and
authorization checks. Optional `SEARCH_QUALITY_LABELS` reads local graded JSONL
against an explicitly configured real database without seeding or resetting it.
Private evaluation enforces read-only database transactions, disables query-cache
writes, validates embedding identity, and supports a client identity for scoped
memories. Private labels are never committed; the default path is ignored.

README, MCP descriptions and CLI help explain threshold and RRF score semantics.
UI search results display RRF scores as numbers; independent projector cosine
scores retain their existing interpretation. Compact JSON and TOON shapes stay
unchanged. No new runtime configuration is needed.

## Acceptance

- Regression tests first demonstrate missed keyword candidates and whole-entity
  keyword leakage, then pass for exact, HNSW and fallback strategies.
- Keyword-only matches cannot cross any existing authorization/scoping boundary.
- Concise answers beat long incidental mentions in the public corpus; exact
  identifier targets appear in the top three and semantic controls do not regress.
- Synthetic quality checks run in CI and the PR records baseline and final metrics.
- Existing latency budgets and recall/index-use gates pass unchanged; a long
  multi-term keyword profile measures the additional retrieval cost. Additional
  profiles cover a 300-word pasted query and an underfilled HNSW-to-exact
  fallback, including the repeated keyword probes in that path.
- Long-query EXPLAIN runs before fixture teardown with the service's HNSW
  iterative-scan settings, and verifies 200 vector candidates and one keyword
  candidate. An optional benchmark flag saves complete JSON execution plans.
- Server/CLI/UI typechecks, builds and relevant automated tests pass.
