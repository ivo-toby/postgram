# Tasks

- [x] Public fixtures, metrics, private label support and CI quality gate.
- [x] Record current ranker baseline before service changes.
- [x] Failing keyword retrieval and authorization regression tests.
- [x] Migration 017 and chunk-based keyword candidates under all strategies.
- [x] RRF scoring, similarity threshold semantics and true recency half-life.
- [x] README, CLI and MCP contract documentation; numeric search UI scores.
- [x] Long keyword latency profile and unchanged existing budget assertions.
- [x] Parent review, full verification and final quality report.
- [x] Prepare the reviewed change for a PR closing #114.

## PR review follow-up

- [x] Red/green crowded-common-term regression and priority conjunctive probe.
- [x] Bound probes to 24 distinct terms and verify pasted-query behavior.
- [x] Require rounded-up 50% term coverage for below-floor keyword admission.
- [x] Measure pasted queries and underfilled HNSW-to-exact fallback latency.
- [x] Verify the non-null embedding constraint and document recency/score migration.
- [x] Parent review, full backend verification and prepared PR update.

## Long-query performance review

- [x] Compare old/current long-query EXPLAIN on the same seeded database.
- [x] Optimize the measured hot path while preserving coverage and authorization.
- [x] Capture long-query plans before temporary fixture teardown.
- [x] Document partial common-term misses as a possible next retrieval improvement.
- [x] Parent review, local regression/quality/performance verification and prepared PR update.

## Final review nits

- [x] Derive the OR overflow limit from the shared bound keyword cap.
- [x] Document the dense OR bitmap/fallback cost for future measurement.
- [x] Parent review, exact/HNSW boundary/scope checks and prepared PR update.
