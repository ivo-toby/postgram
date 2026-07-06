# Postgram Manual Test Plan

This document is for a human operator who wants to verify the full Phase 1
feature set manually, outside the automated test suite.

## Scope

This plan covers:

- Server startup and health
- Browser admin first-run setup
- Admin provider configuration, API-key creation, diagnostics, and maintenance
- API key auth and access control
- REST entity CRUD
- Async enrichment and semantic search
- Task management
- Human CLI (`pgm`)
- Admin CLI (`pgm-admin`) emergency/operator reference
- MCP transport
- Talon migration
- Backup and restore

## Prerequisites

- Node.js 22+
- Docker and Docker Compose
- `gpg`
- An OpenAI API key if you choose OpenAI-backed embeddings or extraction

Optional but useful:

- `jq`
- `curl`

## Test Environment

1. Clone and install:

```bash
git clone <repo-url> postgram
cd postgram
npm install
```

2. Start the stack. For an isolated manual run, choose a project name and
   non-conflicting host ports:

```bash
COMPOSE_PROJECT_NAME=postgram-manual \
POSTGRAM_API_PORT=3100 \
UI_PORT=3000 \
docker compose up -d --build
```

The first run creates a persistent `postgram_secrets` Docker volume with the
Postgres password, `ADMIN_MFA_SECRET_KEY`, and
`ADMIN_SETTINGS_ENCRYPTION_KEY`. No manual `.env` edit or normal `pgm-admin`
command is required for the supported setup path.

3. Wait for health:

```bash
curl http://127.0.0.1:3100/health
curl http://127.0.0.1:3000/health
```

Expected:

- HTTP `200`
- JSON contains `status: "ok"`
- JSON contains `postgres: "connected"`
- JSON contains an `embedding_model`

4. Capture the first-run bootstrap token from local container logs:

```bash
COMPOSE_PROJECT_NAME=postgram-manual docker compose logs mcp-server \
  | grep 'admin first-run bootstrap token'
```

Expected:

- Log line includes `bootstrapToken`
- The token starts with `pgm-admin-bootstrap-`
- The log line includes an expiry timestamp

5. Open `http://127.0.0.1:3000/admin`.

Expected:

- First admin setup form is shown
- Setup requires the bootstrap token
- Completing setup advances to MFA enrollment
- Completing MFA opens the protected Operations dashboard

## Test Data Conventions

Use the following names to keep the run readable:

- Admin email: `manual-admin@example.com`
- API key name: `manual-test`
- Memory content: `manual test memory`
- Task content: `manual test task`
- MCP memory content: `mcp manual memory`
- Backup directory: `/tmp/postgram-backups`

## 1. Admin Dashboard First-Run And Key Management

From the protected Admin dashboard:

1. Confirm the Overview panels show Health, Queue, Stats, Config status,
   Models, Jobs, API keys, and Audit.
2. Create an API key named `manual-test`.
3. Copy the one-time plaintext key from the browser and dismiss the one-time
   display.

Expected:

- API key table lists `manual-test`
- Plaintext key is shown only in the one-time create result
- Reloading the page does not recover the plaintext key

Export the key:

```bash
export PGM_API_URL=http://127.0.0.1:3100
export PGM_API_KEY='<paste-plaintextKey-here>'
```

Revoke and re-create a second key from the Admin dashboard later in this plan
if you want to verify the revoke path explicitly.

## 2. Admin Config And Maintenance Smoke

From the Config tab:

1. Save a provider secret such as `OPENAI_API_KEY`.
2. Confirm the UI reports the secret as configured metadata.
3. Restart the backend and UI containers.
4. Reload `/admin`, return to Config, and confirm the provider secret input is
   blank/write-only and the plaintext secret is absent from page text,
   `localStorage`, and `sessionStorage`.

```bash
COMPOSE_PROJECT_NAME=postgram-manual docker compose restart mcp-server postgram-ui
```

From the Maintenance tab:

1. Run one dry-run preview, for example re-extract `memory`.
2. Confirm the dry-run creates a job and the UI shows a terminal result.
3. Confirm browser/network evidence includes
   `/admin/api/jobs/<jobId>` polling.

Expected:

- Dry-run preview completes without destructive apply
- Job result summary contains safe selectors/counts only
- Apply remains gated by preview review plus recent step-up

## 3. REST Entity CRUD

Create an entity:

```bash
curl -sS -X POST http://127.0.0.1:3100/api/entities \
  -H "Authorization: Bearer $PGM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"memory","content":"manual test memory","tags":["manual","phase1"]}'
```

Expected:

- HTTP `201`
- `enrichment_status` is `pending`
- `version` is `1`

Save the returned `id` as `ENTITY_ID`.

Recall it:

```bash
curl -sS http://127.0.0.1:3100/api/entities/$ENTITY_ID \
  -H "Authorization: Bearer $PGM_API_KEY"
```

Expected:

- Content matches `manual test memory`

Update it:

```bash
curl -sS -X PATCH http://127.0.0.1:3100/api/entities/$ENTITY_ID \
  -H "Authorization: Bearer $PGM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"version":1,"content":"manual test memory updated"}'
```

Expected:

- HTTP `200`
- `version` becomes `2`
- `enrichment_status` resets to `pending`

Stale update conflict:

```bash
curl -sS -X PATCH http://127.0.0.1:3100/api/entities/$ENTITY_ID \
  -H "Authorization: Bearer $PGM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"version":1,"content":"stale write"}'
```

Expected:

- HTTP `409`
- Error payload includes `CONFLICT`

List entities:

```bash
curl -sS "http://127.0.0.1:3100/api/entities?type=memory&limit=20" \
  -H "Authorization: Bearer $PGM_API_KEY"
```

Expected:

- Your memory appears in the list

Delete it:

```bash
curl -sS -X DELETE http://127.0.0.1:3100/api/entities/$ENTITY_ID \
  -H "Authorization: Bearer $PGM_API_KEY"
```

Expected:

- HTTP `200`
- `deleted: true`

## 4. Async Enrichment And Search

Create a fresh searchable memory:

```bash
curl -sS -X POST http://127.0.0.1:3100/api/entities \
  -H "Authorization: Bearer $PGM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"memory","content":"postgres vector search makes retrieval easy","tags":["search","manual"]}'
```

Expected:

- `enrichment_status` is `pending`

Immediately search:

```bash
curl -sS -X POST http://127.0.0.1:3100/api/search \
  -H "Authorization: Bearer $PGM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"vector search","tags":["search"]}'
```

Expected:

- Either zero results or no match for the new entity yet

Wait a few seconds and search again:

```bash
sleep 3
curl -sS -X POST http://127.0.0.1:3100/api/search \
  -H "Authorization: Bearer $PGM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"vector search","tags":["search"]}'
```

Expected:

- The entity appears
- Response includes `chunk_content`, `similarity`, and `score`

## 5. Task Management Over REST

Create a task:

```bash
curl -sS -X POST http://127.0.0.1:3100/api/tasks \
  -H "Authorization: Bearer $PGM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content":"manual test task","context":"@dev","due_date":"2026-04-01"}'
```

Expected:

- HTTP `201`
- `type` is `task`
- `status` defaults to `inbox`

List tasks:

```bash
curl -sS "http://127.0.0.1:3100/api/tasks?status=inbox&context=@dev" \
  -H "Authorization: Bearer $PGM_API_KEY"
```

Expected:

- Your task appears

Update task:

```bash
curl -sS -X PATCH http://127.0.0.1:3100/api/tasks/$TASK_ID \
  -H "Authorization: Bearer $PGM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"version":1,"status":"next","context":"@focus"}'
```

Expected:

- Status becomes `next`

Complete task:

```bash
curl -sS -X POST http://127.0.0.1:3100/api/tasks/$TASK_ID/complete \
  -H "Authorization: Bearer $PGM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"version":2}'
```

Expected:

- Status becomes `done`
- `metadata.completed_at` is present

## 6. Human CLI (`pgm`)

Store:

```bash
npx tsx src/cli/pgm.ts store "cli memory" --type memory --tags cli,test --json
```

Recall:

```bash
npx tsx src/cli/pgm.ts recall <entity-id> --json
```

Search:

```bash
npx tsx src/cli/pgm.ts search "cli memory" --json
```

Task flow:

```bash
npx tsx src/cli/pgm.ts task add "cli task" --context @dev --status next --due 2026-04-01 --json
npx tsx src/cli/pgm.ts task list --status next --json
npx tsx src/cli/pgm.ts task complete <task-id> --version 1 --json
```

Expected:

- All commands succeed
- JSON payloads match the REST behavior

## 7. Admin CLI (`pgm-admin`) Emergency Reference

The normal Docker first-run path above should not use `pgm-admin`. Use this
section only for emergency recovery, advanced maintenance, embedding migration,
or direct operator inspection.

Audit query:

```bash
docker compose exec -T mcp-server \
  node dist/cli/admin/pgm-admin.js audit --limit 20 --json
```

Expected:

- Returns audit entries for mutating and privileged operations

Model list:

```bash
docker compose exec -T mcp-server \
  node dist/cli/admin/pgm-admin.js model list --json
```

Expected:

- At least one embedding model is listed
- One model is active

Stats:

```bash
docker compose exec -T mcp-server \
  node dist/cli/admin/pgm-admin.js stats --json
```

Expected:

- Returns `entityCounts`, `chunkCount`, `keyCount`, `databaseSizeBytes`, `uptimeSeconds`

## 8. MCP Transport

Create a minimal client script and run it:

```bash
node --input-type=module <<'EOF'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const apiKey = process.env.PGM_API_KEY;
const transport = new SSEClientTransport(new URL('http://127.0.0.1:3100/mcp'), {
  requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  eventSourceInit: {
    fetch: async (url, init) =>
      fetch(url, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${apiKey}`
        }
      })
  }
});

const client = new Client({ name: 'manual-test', version: '0.1.0' }, { capabilities: {} });
await client.connect(transport);

const tools = await client.listTools();
console.log(tools.tools.map((tool) => tool.name).sort());

const storeResult = await client.callTool({
  name: 'store',
  arguments: { type: 'memory', content: 'mcp manual memory' }
});
console.log(JSON.stringify(storeResult, null, 2));

const searchResult = await client.callTool({
  name: 'search',
  arguments: { query: 'mcp manual memory' }
});
console.log(JSON.stringify(searchResult, null, 2));

await client.close();
EOF
```

Expected:

- Tool list contains 9 tools
- `store` returns structured content
- `search` returns structured content

## 9. Talon Migration

Prepare a copy of a Talon SQLite database.

Copy it into the running app container:

```bash
docker cp /path/to/talon.sqlite postgram-mcp-server-1:/tmp/talon.sqlite
```

Run:

```bash
docker compose exec -T mcp-server \
  node dist/migrate-talon/index.js /tmp/talon.sqlite \
  --api-base-url http://127.0.0.1:3100 \
  --api-key "$PGM_API_KEY" \
  --dry-run
```

Expected:

- Dry-run reports the number of candidate items
- No writes happen

Then run without `--dry-run`:

```bash
docker compose exec -T mcp-server \
  node dist/migrate-talon/index.js /tmp/talon.sqlite \
  --api-base-url http://127.0.0.1:3100 \
  --api-key "$PGM_API_KEY"
```

Expected:

- Entities are created
- Re-running does not duplicate already-imported items

## 10. Backup And Restore

Create encrypted backup:

```bash
export DATABASE_URL=postgres://postgram:postgram@postgres:5432/postgram
export PGM_BACKUP_PASSPHRASE=testpass
npx tsx src/cli/pgm.ts backup --encrypt --output /tmp/postgram-backups/ --json
```

Expected:

- JSON returns `{ "ok": true }`
- A `.dump.gpg` file is created

Note:

- This path uses the validated Docker Compose fallback when `pg_dump` is not
  available locally.

Decrypt it:

```bash
gpg --batch --yes --pinentry-mode loopback \
  --passphrase "$PGM_BACKUP_PASSPHRASE" \
  -o /tmp/postgram-backups/restore.dump \
  -d /tmp/postgram-backups/<backup-file>.dump.gpg
```

Restore to a fresh DB inside the compose Postgres container:

```bash
docker compose exec -T postgres sh -lc \
  "dropdb -U postgram --if-exists postgram_restore >/dev/null 2>&1 || true; \
   createdb -U postgram postgram_restore; \
   cat > /tmp/restore.dump; \
   pg_restore -U postgram -d postgram_restore /tmp/restore.dump; \
   psql -U postgram -d postgram_restore -At -c 'select count(*) from entities; select count(*) from chunks;'" \
  < /tmp/postgram-backups/restore.dump
```

Expected:

- Restore succeeds
- Entity and chunk counts match the source DB

## 11. Performance And Resource Checks

Latency:

- Store should be comfortably below 200 ms excluding background enrichment
- Recall should be below 200 ms
- Search should be below 500 ms

Resource:

```bash
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' postgram-postgres-1 postgram-mcp-server-1
```

Expected:

- Combined steady-state RAM usage remains below 512 MB

## Exit Criteria

You can consider Phase 1 manually validated when all of the following are true:

- Health is green
- REST CRUD works
- Search works after async enrichment
- Task operations work
- CLI and admin CLI work
- Admin UI first-run, Config redaction, API-key creation, dashboard panels, and
  safe maintenance dry-run work
- MCP tool listing and invocation work
- Migration works
- Backup and restore work
- Docker build and compose startup work
- Latency and RAM are within target
