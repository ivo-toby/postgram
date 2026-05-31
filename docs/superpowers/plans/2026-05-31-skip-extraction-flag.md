# Skip Extraction Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent `skip_extraction` opt-out that keeps entities searchable through embeddings while preventing graph extraction through normal and admin queue paths.

**Architecture:** Store surfaces pass a boolean skip intent into `storeEntity`, which writes `extraction_status = 'skipped'`. A database migration widens the status constraint. The enrichment worker preserves skipped status after embedding, queue reporting counts skipped rows, and admin commands exclude skipped rows from requeue operations.

**Tech Stack:** TypeScript 5.9, Node.js 22, Hono, MCP SDK, PostgreSQL, Vitest.

---

### Task 1: Core Status and Store Behavior

**Files:**
- Create: `src/db/migrations/008_skip_extraction_status.sql`
- Modify: `src/types/entities.ts`
- Modify: `src/services/entity-service.ts`
- Test: `tests/integration/entity-service.test.ts`

- [ ] Add a failing integration test that stores an entity with `skipExtraction: true` and verifies the database row has `extraction_status = 'skipped'` while the returned entity still has `enrichmentStatus = 'pending'`.
- [ ] Run `npm test -- tests/integration/entity-service.test.ts -t "stores entities with skipped extraction"` and confirm it fails because `skipExtraction` is not implemented.
- [ ] Add the migration constraint update, extend the internal store input with `skipExtraction?: boolean`, and insert `extraction_status = 'skipped'` when true.
- [ ] Run the targeted entity-service test and confirm it passes.

### Task 2: Enrichment Worker Preservation

**Files:**
- Modify: `src/services/enrichment-worker.ts`
- Test: `tests/integration/enrichment-worker.test.ts`

- [ ] Add a failing worker test that stores a skipped entity, runs enrichment with extraction enabled, verifies chunks are created, and verifies `extraction_status` remains `skipped`.
- [ ] Run `npm test -- tests/integration/enrichment-worker.test.ts -t "preserves skipped extraction"` and confirm it fails because enrichment currently queues extraction.
- [ ] Update the enrichment select/update logic so it reads current extraction status and preserves `skipped` when marking enrichment completed.
- [ ] Run the targeted worker test and confirm it passes.

### Task 3: Public Store Surfaces

**Files:**
- Modify: `src/transport/mcp.ts`
- Modify: `src/transport/rest.ts`
- Modify: `cli/src/client.ts`
- Modify: `cli/src/pgm.ts`
- Test: `tests/contract/mcp-tools.test.ts`
- Test: `tests/contract/rest-api.test.ts`
- Test: `tests/integration/cli-pgm.test.ts`

- [ ] Add failing MCP, REST, and CLI tests that pass `skip_extraction` / `--skip-extraction` and verify the stored row is skipped.
- [ ] Run the targeted tests and confirm they fail because the public fields are not wired.
- [ ] Add `skip_extraction` to MCP and REST schemas, pass it to `storeEntity`, add CLI request support, and expose `pgm store --skip-extraction`.
- [ ] Run the targeted tests and confirm they pass.

### Task 4: Queue Reporting

**Files:**
- Modify: `src/services/queue-service.ts`
- Test: `tests/integration/queue-service.test.ts`
- Test: `tests/contract/mcp-tools.test.ts`
- Test: `tests/contract/rest-api.test.ts`

- [ ] Add a failing queue-status test that creates a skipped extraction row and expects `extraction.skipped` to be counted.
- [ ] Run `npm test -- tests/integration/queue-service.test.ts -t "counts skipped extraction"` and confirm it fails.
- [ ] Add skipped counts to the queue SQL, `QueueStatus` type, and API responses.
- [ ] Run queue, MCP, and REST targeted tests and confirm they pass.

### Task 5: Admin Guardrails

**Files:**
- Modify: `src/cli/admin/pgm-admin.ts`
- Test: `tests/integration/cli-admin.test.ts`

- [ ] Add failing admin tests showing `reextract` and `improve-graph` do not mark skipped rows pending, including `--id` targeted cases.
- [ ] Run `npm test -- tests/integration/cli-admin.test.ts -t "skipped"` and confirm the new tests fail.
- [ ] Exclude `extraction_status = 'skipped'` from admin requeue selections and include skipped counts in existing skipped-category reporting where available.
- [ ] Run the targeted admin tests and confirm they pass.

### Task 6: Verification and Commit

**Files:**
- All changed files.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Commit implementation with `feat: add skip extraction flag`.
