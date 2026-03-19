# Tasks: Phase 1 MVP — Central Knowledge Store

**Input**: Design documents from `/specs/001-phase1-mvp/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/, research.md, quickstart.md

**Tests**: Included per constitution (Principle V — Verification with Contract Coverage). 80% coverage minimum. Contract tests for transports, integration tests for service layer, unit tests for pure logic.

**Organization**: Tasks grouped by user story. Auth (US3) is scheduled before Store/Recall (US1) because all non-health endpoints require auth middleware.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dependencies, tooling configuration

- [ ] T001 Initialize Node.js project with package.json (name: postgram, type: module, engines: node >=22) and install all dependencies per plan.md in package.json
- [ ] T002 Create tsconfig.json with strict mode, ES2022 target, NodeNext module resolution, outDir: dist
- [ ] T003 [P] Configure ESLint with TypeScript strict rules in eslint.config.js
- [ ] T004 [P] Configure Prettier in .prettierrc
- [ ] T005 [P] Configure Vitest in vitest.config.ts (coverage threshold 80%, include tests/**)
- [ ] T006 [P] Create .env.example with POSTGRES_PASSWORD, OPENAI_API_KEY, LOG_LEVEL, PORT placeholders
- [ ] T007 [P] Create docker-compose.yml with postgres (pgvector/pgvector:pg17) and mcp-server services per SPEC.md section 9.2
- [ ] T008 [P] Create Dockerfile with multi-stage build (node:22-alpine, tini, non-root user) per SPEC.md section 9.1

**Checkpoint**: Project builds, lints, and runs empty test suite

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T009 Create shared types: Entity, Chunk, EmbeddingModel, StoredEntity in src/types/entities.ts
- [ ] T010 [P] Create shared types: ServiceResult (using neverthrow ResultAsync), PaginatedResult in src/types/common.ts
- [ ] T011 [P] Create AppError class with ErrorCode enum and toHttpStatus mapping in src/util/errors.ts
- [ ] T012 [P] Create request/response shapes and ErrorResponse type in src/types/api.ts
- [ ] T013 [P] Create AuthContext and ApiKeyRecord types in src/auth/types.ts
- [ ] T014 [P] Create zod-validated config loader (DATABASE_URL, OPENAI_API_KEY, PORT, LOG_LEVEL) in src/config.ts
- [ ] T015 [P] Create pino structured logger with request_id, api_key_id, operation, entity_id fields in src/util/logger.ts
- [ ] T016 Create pg Pool setup with connection config and health check helper in src/db/pool.ts
- [ ] T017 Create migration runner (read numbered SQL files, track in schema_migrations table) in src/db/migrate.ts
- [ ] T018 Write initial schema migration (extensions, embedding_models, api_keys, entities, chunks, audit_log, triggers, seed data) in src/db/migrations/001_initial_schema.sql
- [ ] T019 Create appendAuditEntry helper (append-only insert to audit_log) in src/util/audit.ts
- [ ] T020 Create Hono app skeleton with health endpoint (GET /health — no auth, reports DB + model status) in src/index.ts
- [ ] T021 Write contract test for health endpoint (200 ok, 503 degraded) in tests/contract/health.test.ts

**Checkpoint**: `docker compose up postgres`, migrations run, health endpoint responds with DB status

---

## Phase 3: User Story 3 — API Key Auth & Scoped Access (Priority: P1)

**Goal**: Create and validate API keys with scoped permissions; enforce auth on all non-health endpoints

**Independent Test**: Create two keys with different visibility scopes, attempt cross-boundary access, verify rejection

### Tests for US3

- [ ] T022 [P] [US3] Unit tests for scope, type, and visibility checking functions in tests/unit/auth-scope.test.ts
- [ ] T023 [P] [US3] Integration tests for key creation (argon2 hash+verify), key lookup by prefix, revocation in tests/integration/key-service.test.ts

### Implementation for US3

- [ ] T024 [US3] Implement key-service: createKey (generate pgm-<name>-<random>, argon2id hash, store), validateKey (prefix lookup, verify hash), requireScope, checkTypeAccess, checkVisibilityAccess in src/auth/key-service.ts
- [ ] T025 [US3] Implement auth middleware: extract Bearer token, lookup by prefix, verify hash, attach AuthContext, update last_used_at (fire-and-forget) in src/auth/middleware.ts
- [ ] T026 [US3] Wire auth middleware to Hono app for all /api/* routes (exclude /health) in src/index.ts

**Checkpoint**: Auth middleware rejects missing/invalid keys, attaches AuthContext to valid requests, scope checking works

---

## Phase 4: User Story 1 — Store and Recall Knowledge (Priority: P1) MVP

**Goal**: Store entities with content/type/tags/metadata, recall by ID, update with optimistic locking, soft-delete, list with filters

**Independent Test**: Store a memory via POST /api/entities, recall by ID via GET /api/entities/:id, verify round-trip

### Tests for US1

- [ ] T027 [P] [US1] Unit tests for chunking service (single chunk, multi-chunk, empty content, separator priority, overlap) in tests/unit/chunking-service.test.ts
- [ ] T028 [P] [US1] Unit tests for AppError construction and error code mapping in tests/unit/errors.test.ts
- [ ] T029 [P] [US1] Integration tests for entity-service (store, recall, update, version conflict, soft-delete, list with filters) against real Postgres in tests/integration/entity-service.test.ts
- [ ] T030 [P] [US1] Contract tests for REST entity endpoints (POST /api/entities 201, GET /:id 200/404, PATCH /:id 200/409, DELETE /:id 200, GET /api/entities list with pagination) in tests/contract/rest-api.test.ts

### Implementation for US1

- [ ] T031 [US1] Implement chunking-service: chunkText with RecursiveCharacterTextSplitter logic (300 chars, 100 overlap, hierarchical separators), token count estimation in src/services/chunking-service.ts
- [ ] T032 [US1] Implement embedding-service: embedQuery (single text), embedBatch (batched, 100 per call), getActiveModel, retry with exponential backoff (3 attempts) using OpenAI SDK in src/services/embedding-service.ts
- [ ] T033 [US1] Implement entity-service: store (INSERT with enrichment_status=pending, dispatch enrichment), recall (SELECT + auth filter), update (optimistic locking WHERE version=$v, re-dispatch enrichment if content changed), softDelete (SET status=archived), list (paginated with type/status/visibility/tags filters) in src/services/entity-service.ts
- [ ] T034 [US1] Implement enrichment-worker: poll entities with enrichment_status=pending, chunk content, embed batch, store chunks in transaction, set enrichment_status=completed (or failed on error), configurable poll interval, graceful shutdown in src/services/enrichment-worker.ts
- [ ] T034a [US1] Wire enrichment-worker startup/shutdown into server lifecycle (start on boot, stop on SIGTERM) in src/index.ts
- [ ] T035 [US1] Implement REST routes: POST /api/entities, GET /api/entities/:id, PATCH /api/entities/:id, DELETE /api/entities/:id, GET /api/entities — thin adapters calling entity-service, zod validation on request bodies in src/transport/rest.ts
- [ ] T036 [US1] Wire REST routes to Hono app with auth middleware in src/index.ts

### Async Enrichment Verification for US1

- [ ] T036a [P] [US1] Integration tests for enrichment-worker (store returns enrichment_status=pending, worker processes to completed, embedding failure sets failed, entity remains recallable throughout, search finds entity only after enrichment completes) in tests/integration/enrichment-worker.test.ts
- [ ] T036b [US1] Integration test: search before enrichment completes returns no vector results for that entity; search after enrichment returns the entity in tests/integration/search-service.test.ts

**Checkpoint**: Store a memory with content+tags, recall by ID (enrichment_status=pending), enrichment completes asynchronously, search works after enrichment, update with version, conflict on stale version, soft-delete, list with filters — all via REST

---

## Phase 5: User Story 2 — Semantic Search (Priority: P1)

**Goal**: Natural language search ranked by cosine similarity with recency boost, type/tag filtering, chunk deduplication

**Independent Test**: Store 3 memories with varied content, search with paraphrased query, verify top result is semantically correct

### Tests for US2

- [ ] T037 [P] [US2] Unit tests for search scoring (recency boost formula, deduplication logic, threshold filtering) in tests/unit/search-scoring.test.ts
- [ ] T038 [P] [US2] Integration tests for search-service (vector search, type/tag filtering, recency boost, empty results, multi-chunk dedup) against real Postgres with embedded data in tests/integration/search-service.test.ts
- [ ] T041 [US2] Contract test for search endpoint (POST /api/search 200 with results, 400 empty query, 502 query embedding failure) in tests/contract/rest-api.test.ts

### Implementation for US2

- [ ] T039 [US2] Implement search-service: search (embed query → vector similarity JOIN entities → auth filters → threshold → recency boost → dedup → sort) in src/services/search-service.ts
- [ ] T040 [US2] Add REST route: POST /api/search — zod validation, calls search-service, returns SearchResult[] in src/transport/rest.ts

**Checkpoint**: Store entities, search with natural language, get ranked results with scores and chunk content

---

## Phase 6: User Story 4 — MCP Transport (Priority: P2)

**Goal**: Expose all knowledge tools via MCP SSE transport with identical behavior to REST

**Independent Test**: Connect MCP client, list tools, call store then search, verify results match REST

### Tests for US4

- [ ] T042 [P] [US4] Contract tests for MCP tools (store, recall, search, update, delete, task_create, task_list, task_update, task_complete — verify tool listing, call behavior, error responses, parity with REST) in tests/contract/mcp-tools.test.ts

### Implementation for US4

- [ ] T043 [US4] Implement MCP server: register tools (store, recall, search, update, delete, task_create, task_list, task_update, task_complete) with inputSchema and descriptions per contracts/mcp-tools.md, authenticate on SSE connection init, map tool calls to service layer in src/transport/mcp.ts
- [ ] T044 [US4] Mount MCP SSE transport at /mcp on Hono server in src/index.ts

**Checkpoint**: MCP client connects, lists 9 tools, store+search round-trip works identically to REST

---

## Phase 7: User Story 5 — Task Management (Priority: P2)

**Goal**: Task CRUD with GTD contexts, status filtering, completion timestamps

**Independent Test**: Create a task with context and due date, list filtered by status, complete it, verify status=done with completed_at

### Tests for US5

- [ ] T045 [P] [US5] Integration tests for task-service (taskCreate defaults to inbox, taskList filters by status/context, taskComplete sets done + completed_at) in tests/integration/task-service.test.ts
- [ ] T048a [P] [US5] Contract tests for task REST endpoints (POST /api/tasks 201, GET /api/tasks filtered, PATCH /api/tasks/:id 200/409, POST /api/tasks/:id/complete 200 — include auth, validation, and parity assertions) in tests/contract/rest-api.test.ts
- [ ] T048b [P] [US5] Contract tests for MCP task tools (task_create, task_list, task_update, task_complete — verify parity with REST responses) in tests/contract/mcp-tools.test.ts

### Implementation for US5

- [ ] T046 [US5] Implement task-service: taskCreate (store with type=task, default status=inbox, metadata: context/due_date), taskList (list with type=task + context JSONB filter), taskUpdate (entity update), taskComplete (set status=done, merge completed_at) in src/services/task-service.ts
- [ ] T047 [US5] Add REST routes: POST /api/tasks, GET /api/tasks, PATCH /api/tasks/:id, POST /api/tasks/:id/complete — thin adapters to task-service in src/transport/rest.ts
- [ ] T048 [US5] Add MCP task tools (task_create, task_list, task_update, task_complete) to MCP server in src/transport/mcp.ts

**Checkpoint**: Create task, list by status, complete with timestamp — works via both REST and MCP with identical behavior

### Audit Integration (cross-cutting, after US5)

- [ ] T048c [US5] Verify audit log entries: entity store, update, delete emit audit rows; task_complete emits audit row; search and recall do NOT emit audit rows in tests/integration/entity-service.test.ts

---

## Phase 8: User Story 6 — CLI Tool (Priority: P2)

**Goal**: Human-facing CLI for store, search, recall, update, delete, task ops, and backup

**Independent Test**: `pgm store "test" --type memory`, `pgm search "test"`, `pgm recall <id>` — human-readable output

### Tests for US6

- [ ] T057a [US6] CLI integration tests: spawn pgm against test server, verify store returns entity ID, search returns results, recall prints entity, task list filters by status, --json produces parseable output in tests/integration/cli-pgm.test.ts

### Implementation for US6

- [ ] T049 [US6] Implement HTTP client: configurable base URL + API key (from env or ~/.pgmrc), request/response handling, error formatting in src/cli/client.ts
- [ ] T050 [US6] Implement pgm CLI entry point with commander, global --json flag, config loading from PGM_API_URL/PGM_API_KEY env or ~/.pgmrc in src/cli/pgm.ts
- [ ] T051 [P] [US6] Implement pgm store command (content from arg or stdin, --type, --tags, --visibility, --status, --metadata flags) in src/cli/commands/store.ts
- [ ] T052 [P] [US6] Implement pgm search command (query, --type, --tags, --limit, --threshold, --json flags, human-readable output with scores) in src/cli/commands/search.ts
- [ ] T053 [P] [US6] Implement pgm recall command (id with prefix matching, --json flag, human-readable entity display) in src/cli/commands/recall.ts
- [ ] T054 [P] [US6] Implement pgm update command (--content, --tags, --status, --visibility, --metadata, --version required, --force for conflict override) in src/cli/commands/update.ts
- [ ] T055 [P] [US6] Implement pgm delete command (soft delete by id) in src/cli/commands/delete.ts
- [ ] T056 [P] [US6] Implement pgm task subcommands (add, list, update, complete with --context, --status, --due flags, grouped output) in src/cli/commands/task.ts
- [ ] T057 [US6] Implement pgm backup command (ssh + pg_dump wrapper, --output, --encrypt with GPG) in src/cli/commands/backup.ts

**Checkpoint**: All pgm commands work against running server, human-readable output, --json for scripting

---

## Phase 9: User Story 7 — Admin Operations (Priority: P3)

**Goal**: Container-local admin CLI for key management, audit log review, embedding model management, and system stats — zero network exposure

**Independent Test**: Run pgm-admin inside container: create key, query audit, switch active model, view stats

### Tests for US7

- [ ] T062a [US7] Admin CLI integration tests: spawn pgm-admin against test DB, verify key create returns plaintext once, key list shows keys, key revoke deactivates, key create/revoke/list emit audit rows, audit queries filter correctly and emit audit rows, model list/set-active works and emit audit rows, and stats returns counts and emits an audit row in tests/integration/cli-admin.test.ts

### Implementation for US7

- [ ] T058 [US7] Implement pgm-admin CLI entry point with commander, direct DATABASE_URL connection (no REST) in src/cli/admin/pgm-admin.ts
- [ ] T059 [P] [US7] Implement pgm-admin key subcommands (create with --name/--scopes/--visibility/--types, list in table format, revoke by id) in src/cli/admin/key.ts
- [ ] T060 [P] [US7] Implement pgm-admin audit subcommand (--since, --key, --operation, --entity, --limit filters, formatted output) in src/cli/admin/audit.ts
- [ ] T061 [P] [US7] Implement pgm-admin model subcommands (list models, set-active) in src/cli/admin/model.ts
- [ ] T062 [P] [US7] Implement pgm-admin stats command (entity counts by type, chunk count, storage usage, key count, uptime) in src/cli/admin/stats.ts

**Checkpoint**: Admin CLI works via docker exec, creates keys, queries audit log, manages models, shows stats

---

## Phase 10: User Story 8 — Talon Memory Migration (Priority: P3)

**Goal**: Migrate existing Talon SQLite memories into Postgram with preserved timestamps

**Independent Test**: Run migration on Talon SQLite copy, verify entities created and searchable

### Tests for US8

- [ ] T063 [US8] Integration test for Talon migration (mock SQLite with sample data, verify entity creation, type mapping, timestamp preservation, embedding_ref skip, dry-run mode, re-run after partial success produces no duplicates, idempotent dedup by source thread_id) in tests/integration/migration.test.ts

### Implementation for US8

- [ ] T064 [US8] Implement SQLite reader: open read-only, SELECT from memory_items WHERE type != 'embedding_ref', group by thread_id in src/migrate-talon/reader.ts
- [ ] T065 [US8] Implement transformer: map Talon types to Postgram entities (fact→memory/facts, summary→memory/summaries, note→memory/notes), convert ms epoch to ISO timestamps, parse metadata JSON in src/migrate-talon/transformer.ts
- [ ] T066 [US8] Implement migration entry point: iterate items, POST to /api/entities via REST, batch embedding, progress logging, --dry-run, --thread, --batch-size, --skip-embeddings flags in src/migrate-talon/index.ts

**Checkpoint**: Migration script imports Talon memories, preserved timestamps, searchable in Postgram

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Docker deployment readiness, CI, documentation, final verification

- [ ] T067 [P] Add npm scripts to package.json: build, start, dev (tsx), test, test:coverage, lint, format, migrate
- [ ] T068 [P] Verify Dockerfile builds and runs successfully (multi-stage, includes migrations, pgm-admin accessible via docker exec)
- [ ] T069 [P] Verify docker-compose.yml starts full stack (postgres healthy → mcp-server starts → health check passes)
- [ ] T070 Run full test suite with coverage, verify 80% minimum
- [ ] T071 Run quickstart.md end-to-end validation (local dev setup → store → search → recall → task CRUD)
- [ ] T072 Verify MCP client configuration from quickstart.md works (connect, list tools, store+search)
- [ ] T073 [P] Backup/restore rehearsal: create backup with pgm backup --encrypt, restore to fresh DB with pg_restore, verify all entities and chunks preserved
- [ ] T074 [P] Latency validation: measure p95 for store (< 200ms excluding enrichment), recall (< 200ms), search (< 500ms) against test dataset
- [ ] T075 [P] Resource validation: verify docker compose stack uses < 512 MB total RAM (postgres + mcp-server) under steady state with 1k entities

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **US3 Auth (Phase 3)**: Depends on Foundational — BLOCKS US1-US8 (all endpoints need auth)
- **US1 Store/Recall (Phase 4)**: Depends on US3 (needs auth middleware wired)
- **US2 Search (Phase 5)**: Depends on US1 (needs entities + chunks + embedding service)
- **US4 MCP (Phase 6)**: Depends on US1 + US2 (needs service layer to wrap)
- **US5 Tasks (Phase 7)**: Depends on US1 (wraps entity-service); can run parallel with US4
- **US6 CLI (Phase 8)**: Depends on US1 + US2 + US5 (needs REST endpoints to call)
- **US7 Admin (Phase 9)**: Depends on US3 (needs key-service); can run parallel with US6
- **US8 Migration (Phase 10)**: Depends on US1 (needs store endpoint); can run parallel with US7
- **Polish (Phase 11)**: Depends on all desired stories complete

### User Story Dependencies

```text
Setup → Foundational → US3 Auth → US1 Store/Recall → US2 Search ─┐
                                       │                          │
                                       ├── US5 Tasks ──┐          ├── US6 CLI
                                       │               │          │
                                       │               └──────────┘
                                       │
                                       ├── US4 MCP (after US2)
                                       │
                                       ├── US7 Admin (after US3)
                                       │
                                       └── US8 Migration (after US1)
```

### Within Each User Story

- Tests written and verified to FAIL before implementation
- Types/models before services
- Services before transport adapters
- Core implementation before integration wiring

### Parallel Opportunities

**Within phases (marked [P])**:
- Setup: T003-T008 all parallel
- Foundational: T010-T015 all parallel (types + config + logger)
- US1: T027-T030 tests parallel; T031-T032 services parallel
- US5 + US4: Can run concurrently after US2
- US6 CLI: T051-T056 commands all parallel
- US7 Admin: T059-T062 commands all parallel
- US7 + US8: Can run concurrently

**Across stories**: After US2 completes, US4/US5/US6/US7/US8 can fan out with appropriate overlap per the dependency graph above.

---

## Parallel Example: User Story 1

```text
# Tests (all parallel — different test files):
T027: Unit tests for chunking in tests/unit/chunking-service.test.ts
T028: Unit tests for errors in tests/unit/errors.test.ts
T029: Integration tests for entity-service in tests/integration/entity-service.test.ts
T030: Contract tests for REST in tests/contract/rest-api.test.ts

# Services (parallel — different files):
T031: chunking-service in src/services/chunking-service.ts
T032: embedding-service in src/services/embedding-service.ts

# Then sequential:
T033: entity-service with persist-first store (depends on T031, T032)
T034: enrichment-worker (background enrichment)
T034a: Wire enrichment-worker lifecycle into server
T035: REST routes (depends on T033)
T036: Wire to Hono (depends on T035)
T036a/T036b: Async enrichment verification tests
```

---

## Implementation Strategy

### MVP First (US3 + US1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (DB + types + config)
3. Complete Phase 3: US3 Auth (key creation + middleware)
4. Complete Phase 4: US1 Store/Recall (entity CRUD + embeddings)
5. **STOP and VALIDATE**: Store + recall + list via REST with auth
6. This is a functional knowledge store — deploy if ready

### Incremental Delivery

1. Setup + Foundational + Auth → Foundation ready
2. Add US1 Store/Recall → Test independently → **MVP!**
3. Add US2 Search → Semantic search works → **Core complete**
4. Add US4 MCP → Agents can connect → **Agent-ready**
5. Add US5 Tasks + US6 CLI → GTD + human ops → **Full feature set**
6. Add US7 Admin + US8 Migration → Ops ready → **Production ready**

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [US#] label maps task to specific user story for traceability
- Constitution requires: service-layer logic, transport adapters, auth enforcement, audit logging, contract tests
- All REST + MCP transports MUST produce identical results (SC-010)
- Audit log entry for every mutating operation (SC-008)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
