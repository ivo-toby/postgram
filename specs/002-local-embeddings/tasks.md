---

description: "Task list for 002-local-embeddings"
---

# Tasks: Local Embedding Provider Support

**Input**: Design documents from `/specs/002-local-embeddings/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Required per Constitution Principle V (schema touch, embedding pipeline touch) and per `CLAUDE.md` Red/Green TDD. Kept minimal: config-parse unit tests, provider unit tests against stubbed `fetch`, one Ollama enrichment integration test, one migrate integration test covering dry-run + real + startup dimension gate.

**Organization**: Two user stories, plus Setup, Foundational, and Polish.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Update `.env.example` with the new embedding env vars (`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`), a comment noting `EMBEDDING_BASE_URL` falls back to `OLLAMA_BASE_URL`, and a comment noting `OPENAI_API_KEY` is now conditional

---

## Phase 2: Foundational (blocks both user stories)

- [X] T002 Extend `src/config.ts` zod schema: add `EMBEDDING_PROVIDER` (enum `openai | ollama`, default `openai`), `EMBEDDING_MODEL` (optional string), `EMBEDDING_DIMENSIONS` (coerced positive integer, optional), `EMBEDDING_BASE_URL` (optional string), `EMBEDDING_API_KEY` (optional string); make `OPENAI_API_KEY` optional and add a `.superRefine` that requires it when `EMBEDDING_PROVIDER === 'openai'` OR (`EXTRACTION_ENABLED && EXTRACTION_PROVIDER === 'openai'`)
- [X] T003 [P] Unit tests at `tests/unit/config.test.ts` covering: Ollama-only config parses without `OPENAI_API_KEY`; OpenAI embedding without key → parse error with actionable message; OpenAI extraction enabled without key → parse error; `EMBEDDING_BASE_URL` falls back to `OLLAMA_BASE_URL` when unset (provider ollama)
- [X] T004 Create `src/services/embeddings/providers.ts` with the `EmbeddingProvider` interface, OpenAI implementation (wrapping the existing OpenAI embeddings call pattern), Ollama implementation (posts to `{baseUrl}/api/embeddings` with `{model, prompt}`, loops for `embedBatch`, optional bearer auth from `EMBEDDING_API_KEY`), and `createEmbeddingProvider(config)` factory. Dimension mismatches throw `AppError(EMBEDDING_FAILED)` with typed `details`.
- [X] T005 [P] Unit tests at `tests/unit/services/embeddings/providers.test.ts` against stubbed `global.fetch`: OpenAI single + batch order-preservation + 401/5xx error mapping + dimension mismatch; Ollama single + batch loop + non-2xx → AppError + dimension mismatch; factory selection for both providers with correct readonly fields
- [X] T006 Refactor `src/services/embedding-service.ts` to accept an optional `provider: EmbeddingProvider` in `createEmbeddingService(options)` and delegate `embedBatch`/`embedQuery` to it; keep the deterministic test mode, `vectorToSql`, and `getActiveModel` unchanged; remove the inline OpenAI client construction

---

## Phase 3: User Story 1 — Local embedding provider (Priority: P1) 🎯 MVP

**Goal**: Postgram runs with Ollama embeddings on a dedicated embedding host, independent of the LLM extraction host, with no `OPENAI_API_KEY` required.

**Independent Test**: Fresh install, `EMBEDDING_PROVIDER=ollama` + `EMBEDDING_BASE_URL=<ollama-host>` + no `OPENAI_API_KEY`. Server boots and logs active provider/model/dimensions/host. Ingest entities; enrichment completes; search works. No outbound OpenAI traffic.

- [X] T007 [US1] Wire `src/index.ts`: build an `EmbeddingProviderConfig` from the loaded `AppConfig` (resolving per-provider defaults when model/dimensions are unset and resolving `EMBEDDING_BASE_URL ?? OLLAMA_BASE_URL` for Ollama), instantiate the provider via `createEmbeddingProvider`, pass it into `createEmbeddingService`, and log one info line: `embedding provider active provider=<n> model=<m> dimensions=<d> host=<url|n/a>`. Replace the existing OpenAI-specific probe (`embedQuery('startup validation', ...)`) with a generic provider warmup that preserves today's warn-and-degrade behavior on failure (no new fail-fast).
- [X] T008 [US1] Integration test at `tests/integration/enrichment-ollama.test.ts` using testcontainers Postgres + an in-process stub HTTP server that answers `POST /api/embeddings` with deterministic vectors; asserts an ingested entity reaches `enrichment_status='completed'` and produces chunks of the configured dimension; also asserts no calls are made to `api.openai.com` during the run (hostname check on the stub's fetch interceptor or an assertion that the OpenAI client was never constructed)

**Checkpoint**: US1 deliverable — fresh Ollama install works end to end; existing OpenAI deployments still boot and embed unchanged (regression guard via the existing test suite).

---

## Phase 4: User Story 2 — Dimension migration (Priority: P2)

**Goal**: Operator with a populated 1536-dim deployment runs `pgm-admin embeddings migrate --target-dimensions <N> --yes`, restarts, and background enrichment regenerates chunks at dimension `N`.

**Independent Test**: Seeded DB with N chunks at 1536. Dry-run reports correct counts with no writes. Real run with `--yes` alters column to target, truncates chunks, inserts a new active `embedding_models` row, marks enrichable entities pending, writes an audit row. Startup with mismatched config refuses to boot with a message naming both values and the migrate command.

- [X] T009 [US2] Implement `src/services/embeddings/admin.ts` exporting `runMigrate({ pool, config, targetDimensions, dryRun, yes, logger })`: validates config/flag agreement; writes an audit row on every invocation (including `--dry-run`, with `dry_run: true` in details) to match the existing CLI's pattern of auditing privileged reads; in dry-run, reads and returns counts without further writes; otherwise, in a single transaction, `DROP INDEX idx_chunks_embedding`, `TRUNCATE chunks`, `ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(N)`, deactivates existing `embedding_models` rows, inserts a new active row from config, `UPDATE entities SET enrichment_status='pending', enrichment_attempts=0, updated_at=now() WHERE content IS NOT NULL`, recreates the HNSW index, and commits
- [X] T010 [US2] Add the startup dimension-agreement gate: at server start (after migrations run, before HTTP listen), compare `EMBEDDING_DIMENSIONS` against the active `embedding_models.dimensions`; on mismatch, log a single-line error naming both values and the migrate command, and exit with code 1. Implement as `assertEmbeddingDimensionAgreement(pool, config)` in `src/services/embeddings/admin.ts`; `src/index.ts` invokes it. Do NOT add a reachability gate.
- [X] T011 [US2] Add the `embeddings migrate` subcommand to `src/cli/admin/pgm-admin.ts`: `--target-dimensions <n>` (required), `--dry-run`, `--yes`, `--json`; delegates to `runMigrate`; prints a human or JSON report; exit codes 0 (success), 64 (missing `--yes` outside dry-run), 65 (config/flag mismatch), 70 (internal error — transaction rolled back). NOTE: `src/cli/shared.ts:138` `handleCliFailure` hard-sets `exitCode = 1`; this subcommand sets `process.exitCode` directly per outcome instead of routing through `handleCliFailure`, or extends the shared helper to accept a code — pick one during implementation and keep it local to `embeddings migrate` if extending globally is risky.
- [X] T012 [US2] Integration test at `tests/integration/admin-embeddings-migrate.test.ts` using testcontainers: seeded DB with chunks at 1536 → `--dry-run` returns correct counts and does not alter schema; `--yes` path alters column, truncates chunks, marks entities pending, writes audit row, creates new active model row, rebuilds index; re-running `--yes` with the same target is safe (idempotent on converged state); missing-`--yes` path exits 64; env/flag mismatch exits 65; separately, a startup test asserts that booting with `EMBEDDING_DIMENSIONS` disagreeing with the active model row exits non-zero with an error message pointing to the migrate command

**Checkpoint**: US2 deliverable — migration path and startup dimension gate work end to end.

---

## Phase 5: Polish

- [X] T013 Run `npm run lint`, `npm run build`, `npm run test`; fix any issues introduced by this feature and confirm the existing REST/MCP contract suite passes unchanged (FR-013 regression guard). Add or confirm at least one assertion in the suite that exercises the default OpenAI embedding path end-to-end (SC-004 explicit regression) — either by re-running `tests/integration/enrichment-ollama.test.ts`'s sibling for OpenAI or by confirming an existing test in the current suite covers enrichment via the OpenAI provider after the facade refactor
- [X] T014 [P] Update `README.md` (if an embeddings/config section exists — otherwise skip) with a short note on provider selection, independent embedding host, and a link to `specs/002-local-embeddings/quickstart.md`
- [X] T015 Run `/codex` per `CLAUDE.md` workflow; fix P0/P1/P2 findings before pushing

---

## Dependencies

- Phase 1 → Phase 2 → {Phase 3, Phase 4} → Phase 5.
- US1 and US2 are largely independent. Both touch `src/index.ts` (T007 for provider wiring + log, T010 for the dimension gate) — coordinate via small sequential commits.

## MVP scope

Ship Phases 1–3 (Setup + Foundational + US1) for the core "run on Ollama" outcome. Add US2 when migration tooling is needed.

## Notes

- Total tasks: 15.
- Constitution Principle III is waived for the runtime `ALTER TABLE`; see `plan.md` Complexity Tracking.
- No contracts directory; the provider interface is internal and the migrate subcommand is described in `quickstart.md` + `spec.md` requirements. Anything more formal would be scaffolding for scaffolding.
