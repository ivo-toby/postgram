<!--
Sync Impact Report
Version change: 1.0.0 -> 1.1.0
Modified principles:
- None (all five Core Principles unchanged)
Added sections:
- Implementation Phase (Code Quality, Naming Conventions, Architecture
  Principles, Data Access, Process)
- Constraints & Boundaries (Security, Performance, Compatibility)
Removed sections:
- None
Templates requiring updates:
- ✅ .specify/templates/plan-template.md (no changes needed; Technical Context
  already captures stack, testing, and constraints)
- ✅ .specify/templates/spec-template.md (no changes needed; acceptance
  scenarios and requirements already aligned)
- ✅ .specify/templates/tasks-template.md (no changes needed; phase structure
  and checkpoint gates already compatible)
- ✅ .specify/templates/agent-file-template.md (no changes needed; Code Style
  and Commands sections will be filled from these new rules at generation time)
- ⚠ pending .specify/templates/commands/ (directory absent; no command
  templates available to validate)
Follow-up TODOs:
- None
-->
# Postgram Constitution

## Core Principles

### I. Specification Before Implementation
Every material change MUST begin with an updated specification artifact before
implementation starts. The spec MUST capture user-visible behavior, edge cases,
data model impact, transport contract impact, and operational implications for
the change. If implementation decisions diverge from the approved spec, the spec
MUST be updated in the same change before the implementation is considered
complete. Rationale: this repository already uses `SPEC.md` and feature specs as
its source of intent, so code without synchronized specifications is
unreviewable drift.

### II. Service-Layer Canonical Logic
Domain behavior MUST be implemented once in transport-agnostic service modules.
REST handlers, MCP tools, and CLI commands MUST remain thin adapters that reuse
the same validation, authorization, persistence, and error-handling rules rather
than reimplementing business logic. Rationale: Postgram serves multiple agent
and operator interfaces, and duplicated logic causes behavioral drift across
surfaces.

### III. Explicit Schema and Migration Discipline
Persistent behavior MUST be backed by explicit PostgreSQL schema definitions and
numbered SQL migrations. Any schema-affecting change MUST update the relevant
specification, migration files, typed query helpers, and concurrency/versioning
rules together. Raw SQL with typed helpers is the default persistence model; ORM
features that hide schema changes or query behavior are prohibited unless this
constitution is amended. Rationale: Postgram is a durable knowledge store, so
storage behavior must stay inspectable, reproducible, and reversible.

### IV. Scoped Security and Auditability
Every non-health transport entry point MUST authenticate callers and enforce
scope, type, and visibility restrictions in the service layer. Mutating or
privileged operations MUST emit auditable records, and admin capabilities MUST
remain container-local rather than exposed over public REST or MCP surfaces
unless the constitution is explicitly amended. Rationale: the system stores
personal, work, and shared knowledge for multiple agents, so boundary failures
and missing audit trails are unacceptable.

### V. Verification with Contract Coverage
Every change MUST include fresh verification proportional to risk. Changes that
touch transports, authentication, schema, search behavior, migrations, or
cross-surface contracts MUST include automated contract and/or integration
coverage; narrower logic changes MUST include focused unit or service tests.
No work may be marked complete without fresh verification evidence and updated
operator-facing documentation when setup or runtime behavior changes. Rationale:
this project spans database, API, MCP, and CLI interfaces, so regressions are
easy to introduce and hard to detect without explicit verification.

## Implementation Phase

### Code Quality

- **Linting**: ESLint with TypeScript strict rules
- **Formatting**: Prettier
- **Testing**: Vitest (unit + integration minimum)
- **Coverage**: 80% minimum enforced
- **Test types**: contract tests for transport interfaces (REST + MCP),
  integration tests for service-layer operations against a real database,
  unit tests for pure logic and helpers
- No code merges without passing CI
- Follow existing patterns and conventions in codebase
- Documentation required for public APIs (TSDoc)
- Comments only where logic is not self-evident

### Naming Conventions

- **Variables / functions**: camelCase
- **Types / classes / interfaces**: PascalCase
- **Constants**: UPPER_SNAKE_CASE
- **File names**: kebab-case (e.g., `entity-service.ts`, `audit-log.ts`)
- **Directories**: kebab-case
- **Database tables / columns**: snake_case
- **SQL migration files**: numbered prefix with kebab-case description
  (e.g., `001-create-entities.sql`)

### Architecture Principles

- **Pattern**: Service-layer core — thin transport adapters (REST handlers,
  MCP tools, CLI commands) over shared, transport-agnostic service modules
- **Error handling**: Result types (`neverthrow`) for expected errors;
  exceptions only for truly exceptional or unrecoverable failures
- **Logging**: `pino` — structured JSON logs with `request_id`, `api_key_id`,
  `operation`, `entity_id`
- **Observability**: Structured logs, audit log table (append-only), health
  endpoint reporting service and database status
- **Security**: Scoped API keys, service-layer enforcement of type and
  visibility restrictions, admin operations container-local only, secrets
  never in plaintext at rest

### Data Access

- **No ORM** — raw SQL with typed helpers (e.g., `kysely` or hand-written
  prepared statements with TypeScript type annotations)
- Keep the persistence interface behind a repository pattern so the query
  layer can evolve without touching service logic
- Migrations are versioned, forward-only SQL files applied via a dedicated
  migration runner at startup

### Process

- Implementation is fully autonomous after spec approval
- All changes happen in isolated git worktrees
- Each stage (coder, reviewer, tester, QA) MUST pass before proceeding
- QA validation required before merge to main

## Constraints & Boundaries

### Security

- API keys stored hashed (argon2); plaintext returned once at creation, never
  persisted
- Admin CLI (`pgm-admin`) has zero network exposure — runs only inside the
  Docker container via `docker exec`
- TLS everywhere via Caddy for all API and MCP traffic
- Encrypted backups (`pg_dump` output encrypted before leaving the host)
- Audit everything: every mutating or privileged operation recorded with
  `api_key_id`, `operation`, `entity_id`, and timestamp
- Network default for Postgres: internal Docker network only, no host binding

### Performance

- Embedding generation MAY be asynchronous — entity writes MUST return before
  enrichment completes
- Vector search MUST use pgvector indexes (`ivfflat` or `hnsw`) once chunk
  volume exceeds 10k rows
- Connection pooling required for Postgres (e.g., built-in pool or PgBouncer)
- API response target: < 200ms p95 for non-search operations, < 500ms p95 for
  vector search at personal scale (< 100k chunks)

### Compatibility

- Node.js 22+ (LTS)
- PostgreSQL 16+ with `pgvector` and `pgcrypto` extensions
- Docker and Docker Compose for deployment
- Caddy as reverse proxy (TLS termination)
- Target platform: Linux (Hetzner VM); macOS for local development

## Engineering Standards

- The canonical implementation stack for Phase 1 is Node.js with TypeScript,
  PostgreSQL with `pgvector`, raw SQL with typed helpers, MCP via
  `@modelcontextprotocol/sdk`, and a lightweight HTTP transport such as Hono or
  Fastify. Any deviation MUST be justified in the feature plan.
- Schema changes MUST ship as numbered SQL migrations in source control and MUST
  describe forward-only rollout, backfill needs, and version/locking impact.
- Structured application logs, explicit error contracts, and audit logging are
  part of the runtime surface and MUST be treated as maintained interfaces.
- Sensitive exports and backups MUST use encrypted handling, and key material
  MUST be stored hashed rather than in plaintext.

## Delivery Workflow & Quality Gates

- Feature work MUST flow through spec, plan, and task artifacts that remain
  consistent with this constitution.
- The plan's Constitution Check MUST confirm specification coverage, service
  layer ownership, migration impact, security and audit impact, and the exact
  verification commands required for the change.
- Task lists MUST be organized by user story and MUST include constitution-driven
  work for service logic, transport wiring, schema/migration updates,
  authorization and audit behavior, and documentation or quickstart updates when
  those surfaces change.
- Any constitutional exception MUST be documented in the plan's complexity or
  waiver section with a concrete justification and the simpler rejected
  alternative.

## Governance

- This constitution overrides conflicting local process notes, template defaults,
  and ad hoc implementation shortcuts.
- Amendments MUST update this file and all affected templates or guidance
  artifacts in the same change, and the top-of-file Sync Impact Report MUST
  summarize the propagation.
- Versioning policy for this constitution follows semantic versioning:
  MAJOR for removed or materially redefined principles, MINOR for new principles
  or materially expanded governance, and PATCH for clarifications that do not
  change obligations.
- Compliance review is mandatory for every plan, task list, code review, and
  merge decision. Reviewers MUST confirm alignment with all Core Principles or
  record the exception explicitly.
- Runtime guidance generated from
  `.specify/templates/agent-file-template.md` MUST remain consistent with this
  constitution.

**Version**: 1.1.0 | **Ratified**: 2026-03-18 | **Last Amended**: 2026-03-18
