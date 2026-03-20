# Implementation Plan: Phase 1 MVP — Central Knowledge Store

**Branch**: `001-phase1-mvp` | **Date**: 2026-03-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-phase1-mvp/spec.md`
**Supporting Detail**: `SPEC.md` at repo root (implementation notes, not authoritative)

## Summary

Build a central knowledge store backed by PostgreSQL + pgvector that replaces
Talon's fragmented per-thread memory. The system stores typed entities (memories,
people, projects, tasks, interactions, documents) with durable writes first
and asynchronous enrichment (chunking + embedding) after. It serves entities
over MCP (SSE) and REST transports with identical behavior, provides a CLI for
human operators, and enforces scoped API key auth with per-key type and
visibility restrictions. Admin operations are container-local only.

## Technical Context

**Language/Version**: TypeScript on Node.js 22+ (LTS)
**Primary Dependencies**: Hono (HTTP), @modelcontextprotocol/sdk (MCP SSE),
pg + pgvector (database), OpenAI SDK (embeddings), argon2 (key hashing),
commander (CLI), pino (logging), zod (validation), neverthrow (result types)
**Storage**: PostgreSQL 17 with `pgvector` and `pgcrypto` extensions
**Testing**: Vitest — unit tests (chunking, search scoring, auth scope, errors),
integration tests against real Postgres (entity-service, search-service,
task-service, key-service, migration, enrichment worker), REST contract tests
(entity CRUD, search, task CRUD, health), MCP contract tests (all tools incl.
task_*), CLI integration tests (pgm against test server), admin CLI integration
tests (pgm-admin against test DB), audit-log verification (mutating ops only),
backup/restore verification, latency/resource validation (p95 targets, 512 MB)
**Target Platform**: Linux (Hetzner VM) primary; macOS for local development
**Project Type**: Web service + CLI tool (single deployable + separate CLI binary)
**Performance Goals**: < 200ms p95 non-search; < 500ms p95 vector search at
personal scale (< 100k chunks)
**Constraints**: < 512 MB total RAM (Postgres + server); single VM deployment;
Docker Compose orchestration; Caddy TLS termination
**Scale/Scope**: Personal scale — 1-5 concurrent agents, < 100k entities,
< 100k chunks

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| I. Specification Before Implementation | PASS | Feature spec at `specs/001-phase1-mvp/spec.md` (authoritative) includes Data, Contracts & Operational Impact section; synchronized with this plan |
| II. Service-Layer Canonical Logic | PASS | All domain logic in `src/services/` (entity, search, task, embedding, chunking); REST handlers (`src/transport/rest.ts`) and MCP tools (`src/transport/mcp.ts`) are thin adapters; CLI (`src/cli/`) calls REST API |
| III. Explicit Schema and Migration Discipline | PASS | 5 tables + triggers in `src/db/migrations/001_initial_schema.sql`; raw SQL with typed helpers; no ORM; `schema_migrations` tracking table |
| IV. Scoped Security and Auditability | PASS | API key auth on all non-health endpoints; scope/type/visibility enforcement in service layer; append-only `audit_log` table; admin CLI container-local only via `docker exec` |
| V. Verification with Contract Coverage | PASS | Contract tests for REST + MCP transports; integration tests against real Postgres; unit tests for chunking, search scoring, auth logic; 80% coverage target |

**Implementation Phase compliance:**

| Standard | Status | Evidence |
|----------|--------|----------|
| Code Quality (ESLint strict, Prettier, Vitest, 80% coverage) | PASS | Included in project setup; CI gate required |
| Naming Conventions | PASS | camelCase functions, PascalCase types, kebab-case files, snake_case DB |
| Architecture (neverthrow, pino, typed query helpers) | PASS | ServiceResult types, structured logging, DB access via typed query helpers in services |
| Data Access (no ORM, raw SQL, versioned migrations) | PASS | pg + typed helpers; migrations in `src/db/migrations/` |
| Process (worktrees, stage gates, QA) | PASS | Worktree-based implementation; stages enforced by specKit workflow |

**Constraints & Boundaries compliance:**

| Constraint | Status | Evidence |
|------------|--------|----------|
| Security (argon2, container-local admin, TLS, encrypted backups) | PASS | Key hashing via argon2id; `pgm-admin` in container only; Caddy TLS; `pgm backup --encrypt` |
| Performance (async embedding, HNSW index, connection pooling) | PASS | Writes persist first, enrichment async via background worker; HNSW index on chunks; pg Pool |
| Compatibility (Node 22+, PG 16+, Docker, Caddy) | PASS | Docker Compose with pgvector:pg17; node:22-alpine |

## Project Structure

### Documentation (this feature)

```text
specs/001-phase1-mvp/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── rest-api.md      # REST endpoint contracts
│   └── mcp-tools.md     # MCP tool definitions
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── index.ts                     # Entry point — starts MCP + HTTP servers
├── config.ts                    # Env var loading, validation (zod), typed config
├── db/
│   ├── pool.ts                  # pg Pool setup, connection config
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   └── migrate.ts               # Migration runner (reads SQL, tracks in schema_migrations)
├── services/
│   ├── entity-service.ts        # store, recall, update, delete, list
│   ├── search-service.ts        # vector search with recency boost
│   ├── task-service.ts          # task convenience wrappers
│   ├── embedding-service.ts     # OpenAI embedding generation, batch processing
│   ├── chunking-service.ts      # Text splitting (RecursiveCharacterTextSplitter port)
│   └── enrichment-worker.ts     # Background enrichment: poll pending, chunk, embed, update status
├── auth/
│   ├── middleware.ts             # Hono middleware — Bearer token extraction + validation
│   ├── key-service.ts           # Key creation (argon2), validation, scope checking
│   └── types.ts                 # AuthContext, ApiKeyRecord types
├── transport/
│   ├── rest.ts                  # Hono routes — thin adapter to service layer
│   └── mcp.ts                   # MCP server — registers tools, maps to service layer
├── types/
│   ├── entities.ts              # Entity, Chunk, EmbeddingModel types
│   ├── api.ts                   # Request/response shapes, error format
│   └── common.ts                # ServiceResult, PaginatedResult, AppError
└── util/
    ├── errors.ts                # AppError class, error codes, toHttpStatus mapping
    ├── logger.ts                # pino structured logger
    └── audit.ts                 # appendAuditEntry() helper

src/cli/
├── pgm.ts                       # CLI entry point (commander)
├── commands/
│   ├── store.ts
│   ├── search.ts
│   ├── recall.ts
│   ├── update.ts
│   ├── delete.ts
│   ├── task.ts                  # pgm task (add/list/update/complete)
│   └── backup.ts
├── admin/
│   ├── pgm-admin.ts             # Admin CLI entry point
│   ├── key.ts                   # pgm-admin key (create/list/revoke)
│   ├── audit.ts                 # pgm-admin audit
│   ├── model.ts                 # pgm-admin model (list/set-active)
│   └── stats.ts                 # pgm-admin stats
└── client.ts                    # HTTP client for CLI → REST API calls

src/migrate-talon/
├── index.ts                     # Migration entry point
├── reader.ts                    # SQLite reader for Talon memory_items
└── transformer.ts               # Maps Talon MemoryItem → Postgram entity

tests/
├── unit/
│   ├── chunking-service.test.ts
│   ├── search-scoring.test.ts
│   ├── auth-scope.test.ts
│   └── errors.test.ts
├── integration/
│   ├── entity-service.test.ts
│   ├── search-service.test.ts
│   ├── task-service.test.ts
│   ├── key-service.test.ts
│   ├── enrichment-worker.test.ts
│   └── migration.test.ts
└── contract/
    ├── rest-api.test.ts          # Entity + search + task endpoints
    ├── mcp-tools.test.ts         # All tools incl. task_create/list/update/complete
    └── health.test.ts

docker-compose.yml
Dockerfile
.env.example
package.json
tsconfig.json
```

**Structure Decision**: Single project with service-layer architecture. The
server (`src/`) and CLI (`src/cli/`) share types and the CLI calls the server
via REST. The admin CLI (`src/cli/admin/`) connects directly to Postgres (no
REST) and is only available inside the container. Tests are organized by type:
unit (pure logic), integration (service layer + real DB), contract (transport
surface verification).

## Complexity Tracking

> No constitutional violations. No exceptions required.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none)    | —          | —                                   |
