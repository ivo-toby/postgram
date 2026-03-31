# Review Findings

Status note: the issues documented below were fixed in the current working tree on 2026-03-31. The rest of this file is preserved as the original review report.

Audited against `SPEC.md` and `specs/001-phase1-mvp/spec.md`. I reviewed the schema and migrations, core services, REST and MCP transports, both CLIs, migration code, and the relevant tests. Findings are ordered by severity. Findings 2, 3, and 4 were also reproduced against a disposable Postgres instance during review.

## 1. [high] The embedding pipeline is not model-backed, so semantic search and model management are mostly cosmetic

The spec requires OpenAI-backed embeddings, semantic ranking by cosine similarity, and active-model management that affects new enrichment (`SPEC.md:91-92`, `SPEC.md:549-560`, `specs/001-phase1-mvp/spec.md:286-287`, `specs/001-phase1-mvp/spec.md:322-323`, `specs/001-phase1-mvp/spec.md:370-374`, `specs/001-phase1-mvp/spec.md:410-412`). The implementation never calls OpenAI or any other embedding provider. Instead, `createEmbeddingService()` hashes local tokens into a fixed 1536-d vector and uses that for both chunk embeddings and queries (`src/services/embedding-service.ts:19-80`). `getActiveModel()` only reads `id` and `name` from the database (`src/services/embedding-service.ts:82-100`), and `pgm-admin model set-active` / `reembed` only flip DB rows and mark entities pending (`src/cli/admin/pgm-admin.ts:376-499`).

This means the core promise of semantic search is not actually implemented: ranking is effectively lexical token overlap with a deterministic hash, not provider-backed embeddings. It also means active model switching is metadata-only; new enrichment still uses the same local hashing routine regardless of the selected model.

## 2. [high] Clearing entity content leaves stale chunks searchable

The spec says whitespace-only content should behave like metadata-only data with no chunks or embeddings (`specs/001-phase1-mvp/spec.md:262-263`), and the service contract says content changes must replace old chunks (`SPEC.md:400-405`). `updateEntity()` sets `enrichment_status` to `null` when the new content is empty, but it does not delete the old chunks at update time (`src/services/entity-service.ts:228-268`). The worker only processes rows whose `content IS NOT NULL` and whose enrichment status is `pending` or `failed` (`src/services/enrichment-worker.ts:33-50`), so an entity updated to `''` is never reprocessed. Search still joins against whatever rows remain in `chunks` (`src/services/search-service.ts:167-181`).

I reproduced this: after storing and enriching a memory, updating it to `''` returned an entity with `enrichmentStatus: null`, but a subsequent search still returned that same entity from its old chunk data.

This is a data-correctness bug. Once content is cleared, the entity should stop participating in search immediately; today it can keep surfacing indefinitely with stale text.

## 3. [medium] Soft delete incorrectly requires `read` scope in addition to `delete`

The documented delete contract says soft delete validates `delete` scope plus type and visibility checks (`SPEC.md:408-414`, `specs/001-phase1-mvp/spec.md:291-294`). The implementation starts by calling `recallEntity()` inside `softDeleteEntity()` (`src/services/entity-service.ts:301-308`), and `recallEntity()` unconditionally requires `read` scope (`src/services/entity-service.ts:183-195`).

I reproduced this with a key that had only `delete` scope and `shared` visibility: `softDeleteEntity()` failed with `FORBIDDEN: Key 'delete-only' lacks 'read' scope`.

This makes scope enforcement stricter than the documented contract and prevents legitimate delete-only keys from working.

## 4. [medium] Task listing silently truncates after the first 500 tasks and reports the wrong total

The task API is supposed to support filtered listing with pagination (`SPEC.md:527-539`, `specs/001-phase1-mvp/spec.md:152-157`, `specs/001-phase1-mvp/spec.md:318-321`). `listTasks()` does not push the context filter into SQL. Instead, it always calls `listEntities()` with `limit: 500` and `offset: 0`, then filters `metadata.context` in memory and paginates the reduced array (`src/services/task-service.ts:97-137`).

I reproduced this by seeding 600 `next` tasks, 550 of which matched `@dev`. `listTasks(..., { status: 'next', context: '@dev', limit: 600 })` returned `total: 450` and `items: 450`, because only the newest 500 rows were fetched before filtering.

This breaks both correctness and pagination once the task table grows beyond 500 matching rows.

## 5. [medium] Search hides embedding outages behind BM25 fallback instead of returning `EMBEDDING_FAILED`

The search contract explicitly calls for `EMBEDDING_FAILED` when query embedding fails (`SPEC.md:501-505`). The implementation catches any `embedQuery()` failure and silently switches to BM25-only search (`src/services/search-service.ts:315-339`). `startServer()` even logs that degraded mode as an expected fallback (`src/index.ts:140-149`).

This is not just an implementation detail; it changes the external contract. Clients cannot distinguish "semantic search is degraded because embeddings are down" from "search succeeded normally," and the result shape still looks valid even though the vector half of ranking never ran.

## 6. [medium] The public REST, MCP, and CLI contracts have drifted from the documented API

Several spec-defined inputs are supported in the service design but are not actually exposed through the public surfaces.

- Entity `source` is required by the schema and entity contract (`SPEC.md:29-30`, `SPEC.md:64`, `SPEC.md:351-358`, `specs/001-phase1-mvp/spec.md:277-279`), and `storeEntity()` persists it (`src/services/entity-service.ts:132-153`). But REST omits it from store and update schemas (`src/transport/rest.ts:37-63`), MCP omits it from store and update tool inputs (`src/transport/mcp.ts:200-223`, `src/transport/mcp.ts:285-310`), and the CLI client and commands have no way to send it (`src/cli/client.ts:103-145`, `src/cli/pgm.ts:267-285`, `src/cli/pgm.ts:384-409`).
- Search is documented with an optional `visibility` filter (`SPEC.md:451-459`), but neither the search service input nor the REST or MCP search contracts expose it (`src/services/search-service.ts:54-62`, `src/transport/rest.ts:55-63`, `src/transport/mcp.ts:241-268`).
- Task create and update are documented to accept arbitrary metadata merged with `context` and `due_date` (`SPEC.md:512-546`), but the task service, REST API, MCP tools, and CLI only expose `context`, `due_date`, tags, status, and visibility (`src/services/task-service.ts:11-18`, `src/services/task-service.ts:27-35`, `src/services/task-service.ts:79-94`, `src/services/task-service.ts:140-156`, `src/transport/rest.ts:65-82`, `src/transport/mcp.ts:325-349`, `src/transport/mcp.ts:380-408`, `src/cli/client.ts:193-240`).

This drift matters because it removes provenance tracking, prevents callers from using the documented search filter surface, and narrows task metadata support below the published contract.
