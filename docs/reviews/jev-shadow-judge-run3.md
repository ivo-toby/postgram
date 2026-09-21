# Review: jev-shadow-judge — run 3 (glm worker) — ACCEPTED

Run: `worker-2026-09-21T11-22-49-525Z-e4fba165` (launch `c8d08c69`, ollama/glm-5.3-flash:cloud, thinking medium, 900s timeout)

## Verdict: accepted

## Observed

- Outcome completed (865s of 900s), 47 tool calls.
- Full implementation produced: new `src/services/jev-retrieval-judge.ts` (414 lines), integration in `search-service.ts`, five JEV_* config flags, docker-compose env pass-through, `@typesafe-ai/sdk@^0.6.0` in package.json, 58 new test assertions in two suites.

## Scope violations — disposition

The runner flagged `docker-compose.yml`, `package.json`, `tests/unit/config.test.ts` as outside `packet.allowedPaths`. Disposition: **accepted as registration gap, not model misbehavior** — these files are part of the intended change (dependency declaration, env pass-through, config-schema tests); the task registration's allowed-path list was incomplete. No model-attributable violation.

## Reviewer fixes applied to the candidate

1. `tests/unit/search-scoring.test.ts`: stub `vi.fn` retyped via generics (removed unused args and `require-await` violation); `expect.any(Number)` cast for `no-unsafe-assignment`.
2. Pre-existing privacy-lint failures from earlier prep commits fixed (`docs/superpowers/jev.md:690`, `docs/tasks/jev-shadow-judge.md:74`).

## Verification (run by caller in disposable clone, then in repo)

- `git apply` of the candidate patch: clean.
- `npx tsc -p tsconfig.json --noEmit`: pass.
- `npx eslint` (all touched files): pass.
- `npx vitest run tests/unit`: 193/193 pass (incl. 58 new).
- Full suite rerun in the real repo after apply: 193/193 pass.
- Applied as `1f9ef90` on `feat/jev`.

## Acceptance checks

- [x] Flag-off byte-identical: judge resolves to undefined; SDK never imported; suites green.
- [x] Flag-on judgments logged ≤ JEV_MAX_CANDIDATES: judge slices to maxCandidates; payload merged into `search.completed` only.
- [x] Jev errors fail open: per-candidate try/catch + init latch; outer guard in search path.
- [x] No numeric/date/counting questions: state is text + scores only; three literal Noul questions.
- [x] Shadow log queryable for offline metrics: `queryHash` + structured observations in debug payload.
- [x] No hardcoded probability cut: module contains no threshold; calibration deferred to offline measurement.

## Deferred

- Calibration/band analysis on real shadow traffic (the point of the experiment; requires live traffic with flag on).
- Extraction-grounding follow-up, graph-expansion gating, grooming: unchanged scope.
## Addendum: post-review feedback fixes (operator review of PR #107)

Four issues raised by the operator, all fixed in the follow-up commit:

1. **P1 — shadow results invisible at default log level.** The `search.completed` debug payload merge is replaced by a dedicated info-level `jev.shadow` event (queryHash, counts, aggregated token usage, per-candidate observations). Visible at the default `LOG_LEVEL=info`. `SearchOptions.logger` gained an optional `info` so debug/warn-only callers still compile.
2. **P2 — query digest privacy.** `hashQuery` now mirrors `createQueryEmbeddingCacheKey`: HMAC-SHA256 keyed by `QUERY_EMBEDDING_CACHE_SECRET` when configured, plain sha256 otherwise; the client scope is mixed into the digest either way (NUL-separated), so identical queries from two clients never hash equal. `resolveEnvJevJudge` re-resolves when the secret changes.
3. **P2 — usage preserved.** Each judged candidate records `usage: { inputTokens, outputTokens }` from the SDK's `usage` block (defensively parsed, absent when missing); the `jev.shadow` event adds aggregated `totalUsage` for cost-per-query.
4. **P2 — runtime configuration docs.** `.env.example` documents all five `JEV_*` variables including the privacy note (query text + chunk contents leave the host) and latency shape; the README configuration table gained the same rows.

Verification after fixes: tsc clean, eslint clean, 195/195 unit tests.
