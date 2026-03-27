# Postgram

Postgram is a self-hosted knowledge store for humans and agents. It gives you a
single place to store memories, notes, people, projects, and tasks, then
retrieve them over REST, MCP, and a CLI with semantic search and API-key-based
access control.

## What It Is

Postgram is a personal-scale knowledge backend built for:

- human operators who want a searchable external memory
- agent workflows that need durable shared context across sessions
- local or single-VM deployments where simplicity matters more than massive scale

It is not a general SaaS platform. It is designed for one user or one small
team running their own instance.

## What It Does

Postgram provides:

- durable storage for typed entities: `memory`, `person`, `project`, `task`,
  `interaction`, `document`
- semantic vector search with async enrichment
- scoped API-key authentication and visibility restrictions
- a REST API for application and automation access
- an MCP SSE endpoint for agent-native tool access
- a human CLI (`pgm`)
- a container-local admin CLI (`pgm-admin`)
- Talon SQLite migration tooling
- encrypted backup support
- append-only audit logging for mutating and privileged operations

## Who It Is For

Primary users:

- developers running local or VM-hosted agent infrastructure
- operators who want CLI + API access to a personal knowledge store
- people migrating from Talon memory and wanting a more unified backend

Typical usage patterns:

- store decisions, working notes, research fragments, and reminders
- search context by meaning instead of exact keyword
- maintain a lightweight persistent task system
- expose the same store to agents over MCP and to scripts over REST

## Architecture

Postgram is a TypeScript Node.js application built around a service layer.

Main components:

- PostgreSQL + `pgvector` for persistence and vector search
- Hono for the HTTP server
- MCP over SSE for agent-facing tool access
- CLI/admin CLIs built with Commander
- background enrichment worker for chunking and embeddings

High-level flow:

1. a client stores or updates an entity
2. the entity is written immediately
3. enrichment runs asynchronously
4. chunks and embeddings are produced in the background
5. search queries are embedded and matched against stored chunks

## Main Features

### 1. Typed Knowledge Storage

Store structured knowledge objects with:

- `type`
- `content`
- `tags`
- `visibility`
- `status`
- arbitrary JSON metadata

### 2. Async Enrichment

Entities with content are persisted first and enriched later.

Each entity tracks:

- `pending`
- `completed`
- `failed`

This keeps writes fast and preserves data even if embeddings fail.

### 3. Semantic Search

Search returns:

- ranked results
- similarity scores
- recency-adjusted scores
- matching chunk text

### 4. Access Control

API keys can be restricted by:

- scopes: `read`, `write`, `delete`, `sync`
- allowed entity types
- allowed visibility levels

### 5. Task Management

Tasks are first-class entities with convenience operations for:

- create
- list
- update
- complete

### 6. Multiple Interfaces

The same service layer is exposed through:

- REST
- MCP
- `pgm`
- `pgm-admin`

## Repository Layout

```text
src/
  auth/            API key validation and auth middleware
  cli/             Human CLI and admin CLI
  db/              Pool and migrations
  migrate-talon/   Talon import path
  services/        Business logic
  transport/       REST and MCP adapters
  types/           Shared types
  util/            Errors, audit, logging

tests/
  contract/        REST and MCP contract tests
  integration/     Service and CLI integration tests
  unit/            Pure logic tests

specs/001-phase1-mvp/
  spec.md
  plan.md
  tasks.md
  quickstart.md
  contracts/
```

## Prerequisites

- Node.js 22+
- Docker + Docker Compose
- OpenAI API key
- `gpg`

Optional:

- `curl`
- `jq`

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create environment file

```bash
cp .env.example .env
```

Set:

```bash
POSTGRES_PASSWORD=postgram
OPENAI_API_KEY=<your-openai-key>
LOG_LEVEL=info
PORT=3100
```

### 3. Start the stack

```bash
docker compose up -d --build
```

The default compose setup exposes only the app on `127.0.0.1:3100`. PostgreSQL
stays on the internal Docker network.

### 4. Check health

```bash
curl http://127.0.0.1:3100/health
```

Expected:

- `status: "ok"`
- `postgres: "connected"`

## Environment Variables

Server:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `PORT`
- `LOG_LEVEL`
- `ENRICHMENT_POLL_INTERVAL_MS`

CLI:

- `PGM_API_URL`
- `PGM_API_KEY`

Admin CLI:

- `DATABASE_URL` for direct DB access

Backup:

- `DATABASE_URL` or `PGM_DATABASE_URL`
- `PGM_BACKUP_PASSPHRASE` when using `--encrypt`
- optional compose fallback overrides:
  - `PGM_BACKUP_DOCKER_SERVICE`
  - `PGM_BACKUP_DOCKER_USER`
  - `PGM_BACKUP_DOCKER_DB`

## Running The Server

Development:

```bash
npm run dev
```

Production-style local run:

```bash
npm run build
npm start
```

The server exposes:

- REST API at `http://127.0.0.1:3100/api`
- MCP endpoint at `http://127.0.0.1:3100/mcp`
- Health endpoint at `http://127.0.0.1:3100/health`

## Authentication

Create an API key:

```bash
docker compose exec -T mcp-server \
  node dist/cli/admin/pgm-admin.js key create \
  --name local \
  --scopes read,write,delete \
  --visibility personal,work,shared \
  --json
```

Export it for CLI use:

```bash
export PGM_API_URL=http://127.0.0.1:3100
export PGM_API_KEY='<plaintext-key>'
```

## REST API Overview

Main endpoints:

- `POST /api/entities`
- `GET /api/entities/:id`
- `PATCH /api/entities/:id`
- `DELETE /api/entities/:id`
- `GET /api/entities`
- `POST /api/search`
- `POST /api/tasks`
- `GET /api/tasks`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/complete`

All `/api/*` routes require `Authorization: Bearer <api-key>`.

## MCP Overview

MCP is served over SSE at:

```text
http://127.0.0.1:3100/mcp
```

Exposed tools:

- `store`
- `recall`
- `search`
- `update`
- `delete`
- `task_create`
- `task_list`
- `task_update`
- `task_complete`

The MCP tool behavior is intentionally aligned with the REST surface.

## Human CLI (`pgm`)

Use directly in development:

```bash
npx tsx src/cli/pgm.ts <command>
```

Main commands:

- `store`
- `search`
- `recall`
- `update`
- `delete`
- `task add`
- `task list`
- `task update`
- `task complete`
- `backup`

Examples:

```bash
npx tsx src/cli/pgm.ts store "decided to use pgvector" --type memory --tags decisions
npx tsx src/cli/pgm.ts search "database decisions"
npx tsx src/cli/pgm.ts recall <id>
npx tsx src/cli/pgm.ts task add "set up monitoring" --context @focus-work --status next
npx tsx src/cli/pgm.ts backup --encrypt --output /tmp/postgram-backups/
```

## Admin CLI (`pgm-admin`)

Recommended with the default compose setup:

```bash
docker compose exec -T mcp-server \
  node dist/cli/admin/pgm-admin.js <command>
```

Direct host execution only makes sense if PostgreSQL is reachable from the host
via `DATABASE_URL`.

Main commands:

- `key create`
- `key list`
- `key revoke`
- `audit`
- `model list`
- `model set-active`
- `stats`

Examples:

```bash
docker compose exec -T mcp-server \
  node dist/cli/admin/pgm-admin.js key list --json

docker compose exec -T mcp-server \
  node dist/cli/admin/pgm-admin.js audit --limit 20 --json
```

## Talon Migration

Recommended compose-based workflow:

1. Copy the SQLite file into the app container.

```bash
docker cp /path/to/talon.sqlite postgram-mcp-server-1:/tmp/talon.sqlite
```

2. Run the migration inside the container.

```bash
docker compose exec -T mcp-server \
  node dist/migrate-talon/index.js /tmp/talon.sqlite \
  --api-base-url http://127.0.0.1:3100 \
  --api-key "$PGM_API_KEY"
```

Useful flags:

- `--dry-run`
- `--thread <id>`
- `--batch-size <n>`
- `--skip-embeddings`

## Backup And Restore

Create encrypted backup:

```bash
export DATABASE_URL=postgres://postgram:postgram@postgres:5432/postgram
export PGM_BACKUP_PASSPHRASE=testpass
npx tsx src/cli/pgm.ts backup --encrypt --output /tmp/postgram-backups/ --json
```

Backups are written in PostgreSQL custom format (`.dump`) so they can be
restored with `pg_restore`.

Decrypt:

```bash
gpg --batch --yes --pinentry-mode loopback \
  --passphrase "$PGM_BACKUP_PASSPHRASE" \
  -o /tmp/postgram-backups/restore.dump \
  -d /tmp/postgram-backups/<backup-file>.dump.gpg
```

Restore:

```bash
pg_restore -d <target-db> /tmp/postgram-backups/restore.dump
```

If `pg_dump` is not available locally, `pgm backup` falls back to
`docker compose exec postgres pg_dump`.

If you do have a local `pg_dump` installed and Postgres is not host-exposed,
either point `DATABASE_URL` at a reachable Postgres endpoint or rely on the
compose-based fallback workflow used in the manual test plan.

## Testing

Run everything:

```bash
npm test
npm run lint
npm run build
npm run test:coverage
```

Targeted suites:

```bash
npx vitest run tests/unit/
npx vitest run tests/integration/
npx vitest run tests/contract/
```

## Manual Validation

Use the manual test plan:

[`docs/manual-test-plan.md`](docs/manual-test-plan.md)

That document covers:

- REST checks
- CLI checks
- Admin checks
- MCP checks
- migration
- backup/restore
- performance and RAM checks

## Current Status

Phase 1 is complete in the repo:

- REST surface implemented
- MCP surface implemented
- CLI/admin implemented
- migration implemented
- audit logging implemented
- manual and automated validation completed

## Notes And Limitations

- Postgram is optimized for personal/small-team scale, not massive multitenant usage
- Embedding generation depends on your configured environment and provider setup
- Backup encryption requires `gpg`
- The CLI backup flow requires either local `pg_dump` or a working Docker Compose
  Postgres service fallback

## Related Docs

- [Feature spec](specs/001-phase1-mvp/spec.md)
- [Implementation plan](specs/001-phase1-mvp/plan.md)
- [Task tracker](specs/001-phase1-mvp/tasks.md)
- [Quickstart](specs/001-phase1-mvp/quickstart.md)
- [Manual test plan](docs/manual-test-plan.md)
