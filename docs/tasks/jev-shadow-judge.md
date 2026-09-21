# Task brief: jev-shadow-judge

Status: ready for user review

## Outcome and boundaries

Add a shadow-mode Jev retrieval judge to Postgram: after hybrid search
resolves, send each of up to N candidates (`{query, chunk, metadata, scores}`)
to the TypeSafe API with three Noul questions (`relevant`,
`states_usable_evidence`, `contradicts_premise`) in one fan-out call, and log
the resulting probabilities alongside current scores. Change nothing
user-visible: with the flag off, search results are byte-identical and the Jev
dependency is never loaded at runtime; with the flag on, judgments are written
to the `search.completed` debug log only. Any Jev error or timeout degrades to
a per-candidate skip — search never fails because of Jev.

Out of scope: using judgments to filter, rerank, or gate graph expansion;
any `SemanticDecisionProvider` abstraction (YAGNI — one caller uses the SDK
directly); jevkit dependency; extraction, grooming, or memory-admission
changes; extractor prompt changes; any hardcoded probability cut.

## Sources and open decisions

- `src/services/search-service.ts` `searchEntities` (line 679): retrieval
  entry point; judge is invoked after `runHybridSearch` resolves, before the
  `search.completed` log (line 860).
- `src/config.ts` `loadConfig` (line 220): zod env pattern to follow for new
  `JEV_*` flags.
- `src/services/llm-provider.ts` `createLlmProvider` (line 292):
  provider-factory pattern to mirror for the Jev client.
- `tests/unit/search-scoring.test.ts`: mocked-pool search tests — flag-off
  behavior must stay green; add flag-on/flag-off/Jev-error cases.
- TypeSafe JS SDK `@typesafe-ai/sdk` v0.6.0 (npm): `client.systemOne({state,
  questions})` with `noul()` builders. Verify the exact builder/API shape in
  the installed package before implementing — the research packet predates
  dependency installation.
- Decision: shadow log extends the existing `search.completed` debug payload
  with per-candidate `{entityId, score, similarity, nouls, model, latencyMs}`;
  full chunk text is not duplicated (already in DB).

## Acceptance and checks

| Situation | Expected result and preserved state | Source or approved decision | Exact check |
| --- | --- | --- | --- |
| Flag off (default) | Results identical to today; Jev client never constructed; no new network calls | Brief boundary | `npm test -- tests/unit/search-scoring.test.ts` green; new unit test asserts judge not invoked when disabled |
| Flag on, API healthy | Up to `JEV_MAX_CANDIDATES` judgments per query logged with model + latency; results unchanged | Brief boundary | Unit test with stubbed Jev client: log payload contains three nouls per candidate; `npx tsc --noEmit` clean |
| Flag on, API down/slow | Search succeeds; skipped candidates logged as `jev.unavailable`; no throw into search path | Fail-open boundary | Unit test with rejecting client + short timeout: search still resolves; `npm run lint` clean |
| State hygiene | No numeric/date/counting questions sent; state is text + scores only | Jev jaggedness docs | Code review of the question strings in the new module |

Integration coverage (`tests/integration/search-service.test.ts`) needs a
testcontainers Postgres — run only if Docker is available; unit tests must
pass regardless.

## Expected changes and stop conditions

- `src/config.ts`: add `JEV_SHADOW_ENABLED` (default false), `JEV_API_KEY`,
  `JEV_MODEL`, `JEV_TIMEOUT_MS`, `JEV_MAX_CANDIDATES` following the
  `EXTRACTION_*` zod pattern.
- `src/services/jev-retrieval-judge.ts` (new): judge module calling
  `@typesafe-ai/sdk` directly; best-effort per-candidate fan-out.
- `src/services/search-service.ts`: invoke judge after `runHybridSearch`
  resolves (near line 753); extend `search.completed` log (line 860).
- `.env.example`, `docker-compose.yml` if it carries env defaults: document
  the new flags.
- Stop and ask if the installed SDK's API shape contradicts the packet; if
  `SearchInput`/`SearchOptions` need export changes beyond the judge call; or
  if the 96 KiB context budget forces narrower manifest ranges.

## Approval and handoff

Approval: pending — Ivo to approve this brief in conversation. Recording the
approval here does not grant it.

Evidence: none yet — no implementation work done; research artifacts are
`docs/superpowers/jev-research-decision.md` and
`docs/superpowers/jev-implementation-context.md`.

Remaining work or concerns: verify SDK API shape on install; confirm
`JEV_API_KEY` provisioning for any live test (unit tests stub the client);
integration test needs Docker/testcontainers.
