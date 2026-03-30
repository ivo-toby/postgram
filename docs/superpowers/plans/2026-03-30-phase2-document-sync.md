# Phase 2: Document Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push-based sync of local markdown repos into postgram as searchable document entities, with full manifest comparison, REST + MCP transports, and a `pgm sync` CLI command.

**Architecture:** The CLI walks a local directory for `.md` files, computes SHA-256 hashes, and sends a full manifest to `POST /api/sync`. The server diffs the manifest against stored `document_sources` rows and creates, updates, or archives entities in a single transaction. The existing enrichment worker handles chunking and embedding — documents become searchable via hybrid search. MCP tools (`sync_push`, `sync_status`) expose the same service layer.

**Tech Stack:** TypeScript, Postgres, Hono, Vitest, testcontainers, Node crypto (SHA-256)

**Design spec:** `docs/superpowers/specs/2026-03-30-phase2-document-sync-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/db/migrations/003_document_sync.sql` | document_sources table |
| Create | `src/services/sync-service.ts` | syncManifest, getSyncStatus, extractTitle |
| Modify | `src/transport/rest.ts` | POST /api/sync, GET /api/sync/status/:repo |
| Modify | `src/transport/mcp.ts` | sync_push, sync_status tools |
| Modify | `src/cli/client.ts` | syncRepo, getSyncStatus methods |
| Modify | `src/cli/pgm.ts` | sync command |
| Create | `tests/unit/sync-manifest.test.ts` | Title extraction unit tests |
| Create | `tests/integration/sync-service.test.ts` | Full sync lifecycle tests |
| Modify | `tests/contract/rest-api.test.ts` | Sync endpoint contract tests |
| Modify | `tests/contract/mcp-tools.test.ts` | Sync MCP tool contract tests |
| Modify | `tests/integration/cli-pgm.test.ts` | pgm sync CLI test |

---

## Task 1: Schema Migration

**Files:**
- Create: `src/db/migrations/003_document_sync.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 003_document_sync.sql
-- Document sync: tracks files synced from local repos
CREATE TABLE document_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  repo        text NOT NULL,
  path        text NOT NULL,
  sha         text NOT NULL,
  last_synced timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'current' CHECK (sync_status IN ('current', 'stale', 'error')),

  UNIQUE (repo, path)
);

CREATE INDEX idx_document_sources_repo ON document_sources (repo);
CREATE INDEX idx_document_sources_entity_id ON document_sources (entity_id);
```

- [ ] **Step 2: Verify migration runs**

Run: `npm test -- --run tests/contract/health.test.ts`
Expected: PASS — health test boots testcontainers, runs all migrations including the new one.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/003_document_sync.sql
git commit -m "feat: add document_sources table for sync tracking"
```

---

## Task 2: Title Extraction + Unit Tests

**Files:**
- Create: `src/services/sync-service.ts` (partial — just the helper)
- Create: `tests/unit/sync-manifest.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/unit/sync-manifest.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { extractTitle } from '../../src/services/sync-service.js';

describe('extractTitle', () => {
  it('extracts title from first h1 heading', () => {
    const content = '# Project Alpha\n\nSome content here.';
    expect(extractTitle(content, 'project-alpha.md')).toBe('Project Alpha');
  });

  it('uses filename without extension when no heading found', () => {
    const content = 'Just plain text without headings.';
    expect(extractTitle(content, 'my-notes.md')).toBe('my-notes');
  });

  it('ignores h2 and deeper headings', () => {
    const content = '## Section Title\n\nContent.';
    expect(extractTitle(content, 'doc.md')).toBe('doc');
  });

  it('trims whitespace from extracted title', () => {
    const content = '#   Spaced Title  \n\nContent.';
    expect(extractTitle(content, 'file.md')).toBe('Spaced Title');
  });

  it('handles nested path filenames', () => {
    const content = 'No heading.';
    expect(extractTitle(content, 'deeply/nested/my-doc.md')).toBe('my-doc');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/unit/sync-manifest.test.ts`
Expected: FAIL — module `sync-service.js` does not exist.

- [ ] **Step 3: Create sync-service.ts with extractTitle**

Create `src/services/sync-service.ts`:

```typescript
import path from 'node:path';

const H1_PATTERN = /^#\s+(.+)$/m;

export function extractTitle(content: string, filePath: string): string {
  const match = H1_PATTERN.exec(content);
  if (match?.[1]) {
    return match[1].trim();
  }

  const basename = path.basename(filePath, path.extname(filePath));
  return basename;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/unit/sync-manifest.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/sync-service.ts tests/unit/sync-manifest.test.ts
git commit -m "feat: add extractTitle helper for document sync"
```

---

## Task 3: Sync Service — syncManifest + getSyncStatus

**Files:**
- Modify: `src/services/sync-service.ts`
- Create: `tests/integration/sync-service.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `tests/integration/sync-service.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { syncManifest, getSyncStatus } from '../../src/services/sync-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000201',
    keyName: 'sync-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

describe('sync-service', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);
    await seedApiKey(database.pool, {
      id: '00000000-0000-0000-0000-000000000201',
      name: 'sync-key'
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('creates entities and document_sources for new files', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const result = await syncManifest(database.pool, makeAuthContext(), {
      repo: 'test-repo',
      files: [
        { path: 'doc-a.md', sha: 'sha-a', content: '# Doc A\n\nContent A.' },
        { path: 'doc-b.md', sha: 'sha-b', content: 'Plain content B.' }
      ]
    });

    expect(result.isOk()).toBe(true);
    const counts = result._unsafeUnwrap();
    expect(counts).toEqual({ created: 2, updated: 0, unchanged: 0, deleted: 0 });

    // Verify entities were created
    const entities = await database.pool.query(
      "SELECT type, content, metadata FROM entities WHERE type = 'document' ORDER BY created_at"
    );
    expect(entities.rows).toHaveLength(2);
    expect(entities.rows[0]?.content).toBe('# Doc A\n\nContent A.');
    expect(entities.rows[0]?.metadata).toMatchObject({ repo: 'test-repo', path: 'doc-a.md', title: 'Doc A' });
    expect(entities.rows[1]?.metadata).toMatchObject({ title: 'doc-b' });

    // Verify document_sources rows
    const sources = await database.pool.query(
      "SELECT repo, path, sha, sync_status FROM document_sources ORDER BY path"
    );
    expect(sources.rows).toHaveLength(2);
    expect(sources.rows[0]).toMatchObject({ repo: 'test-repo', path: 'doc-a.md', sha: 'sha-a', sync_status: 'current' });
  }, 120_000);

  it('updates changed files, skips unchanged, and archives deleted', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    // Initial sync with 3 files
    await syncManifest(database.pool, makeAuthContext(), {
      repo: 'test-repo',
      files: [
        { path: 'keep.md', sha: 'sha-keep', content: '# Keep\n\nStays the same.' },
        { path: 'change.md', sha: 'sha-old', content: '# Change\n\nOld content.' },
        { path: 'remove.md', sha: 'sha-rm', content: '# Remove\n\nWill be deleted.' }
      ]
    });

    // Re-sync: keep unchanged, change one, remove one
    const result = await syncManifest(database.pool, makeAuthContext(), {
      repo: 'test-repo',
      files: [
        { path: 'keep.md', sha: 'sha-keep', content: '# Keep\n\nStays the same.' },
        { path: 'change.md', sha: 'sha-new', content: '# Change\n\nNew content!' }
      ]
    });

    expect(result.isOk()).toBe(true);
    const counts = result._unsafeUnwrap();
    expect(counts).toEqual({ created: 0, updated: 1, unchanged: 1, deleted: 1 });

    // Verify the changed entity has new content and pending enrichment
    const changed = await database.pool.query<{ content: string; enrichment_status: string }>(
      "SELECT e.content, e.enrichment_status FROM entities e JOIN document_sources ds ON ds.entity_id = e.id WHERE ds.path = 'change.md'"
    );
    expect(changed.rows[0]?.content).toBe('# Change\n\nNew content!');
    expect(changed.rows[0]?.enrichment_status).toBe('pending');

    // Verify the removed entity is archived
    const removed = await database.pool.query<{ status: string }>(
      "SELECT e.status FROM entities e JOIN document_sources ds ON ds.entity_id = e.id WHERE ds.path = 'remove.md'"
    );
    expect(removed.rows[0]?.status).toBe('archived');

    // Verify document_sources sync_status
    const staleSources = await database.pool.query<{ sync_status: string }>(
      "SELECT sync_status FROM document_sources WHERE path = 'remove.md'"
    );
    expect(staleSources.rows[0]?.sync_status).toBe('stale');
  }, 120_000);

  it('returns sync status for a repo', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await syncManifest(database.pool, makeAuthContext(), {
      repo: 'status-repo',
      files: [
        { path: 'file.md', sha: 'sha-1', content: '# File\n\nContent.' }
      ]
    });

    const result = await getSyncStatus(database.pool, makeAuthContext(), 'status-repo');

    expect(result.isOk()).toBe(true);
    const entries = result._unsafeUnwrap();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: 'file.md',
      sha: 'sha-1',
      syncStatus: 'current'
    });
    expect(entries[0]?.entityId).toBeDefined();
    expect(entries[0]?.lastSynced).toBeDefined();
  }, 120_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/integration/sync-service.test.ts`
Expected: FAIL — `syncManifest` and `getSyncStatus` are not exported from sync-service.

- [ ] **Step 3: Implement syncManifest and getSyncStatus**

Replace `src/services/sync-service.ts` with the full implementation:

```typescript
import path from 'node:path';

import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { checkVisibilityAccess, requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';

const H1_PATTERN = /^#\s+(.+)$/m;

export function extractTitle(content: string, filePath: string): string {
  const match = H1_PATTERN.exec(content);
  if (match?.[1]) {
    return match[1].trim();
  }

  const basename = path.basename(filePath, path.extname(filePath));
  return basename;
}

type SyncManifestInput = {
  repo: string;
  files: Array<{ path: string; sha: string; content: string }>;
};

type SyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
};

type DocumentSourceRow = {
  id: string;
  entity_id: string;
  path: string;
  sha: string;
  sync_status: string;
};

type SyncStatusEntry = {
  path: string;
  sha: string;
  syncStatus: string;
  lastSynced: string;
  entityId: string;
};

type SyncStatusRow = {
  path: string;
  sha: string;
  sync_status: string;
  last_synced: Date;
  entity_id: string;
};

function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL, fallbackMessage, {
      cause: error.message
    });
  }

  return new AppError(ErrorCode.INTERNAL, fallbackMessage);
}

export function syncManifest(
  pool: Pool,
  auth: AuthContext,
  input: SyncManifestInput
): ServiceResult<SyncResult> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'write');
      requireScope(auth, 'delete');
      checkVisibilityAccess(auth, 'shared');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Fetch existing document_sources for this repo
        const existingRows = await client.query<DocumentSourceRow>(
          'SELECT id, entity_id, path, sha, sync_status FROM document_sources WHERE repo = $1',
          [input.repo]
        );

        const existingByPath = new Map<string, DocumentSourceRow>();
        for (const row of existingRows.rows) {
          existingByPath.set(row.path, row);
        }

        let created = 0;
        let updated = 0;
        let unchanged = 0;

        const incomingPaths = new Set<string>();

        for (const file of input.files) {
          incomingPaths.add(file.path);
          const existing = existingByPath.get(file.path);

          if (!existing) {
            // New file — create entity + document_sources row
            const title = extractTitle(file.content, file.path);
            const entityResult = await client.query<{ id: string }>(
              `
                INSERT INTO entities (type, content, visibility, enrichment_status, metadata)
                VALUES ('document', $1, 'shared', 'pending', $2)
                RETURNING id
              `,
              [
                file.content,
                JSON.stringify({ repo: input.repo, path: file.path, title })
              ]
            );
            const entityId = entityResult.rows[0]?.id;
            if (!entityId) {
              throw new AppError(ErrorCode.INTERNAL, 'Failed to create entity');
            }

            await client.query(
              `
                INSERT INTO document_sources (entity_id, repo, path, sha)
                VALUES ($1, $2, $3, $4)
              `,
              [entityId, input.repo, file.path, file.sha]
            );

            created += 1;
          } else if (existing.sha !== file.sha) {
            // Changed file — update entity content + document_sources
            const title = extractTitle(file.content, file.path);

            // Fetch current version for optimistic locking
            const versionRow = await client.query<{ version: number }>(
              'SELECT version FROM entities WHERE id = $1',
              [existing.entity_id]
            );
            const currentVersion = versionRow.rows[0]?.version ?? 1;

            await client.query(
              `
                UPDATE entities
                SET content = $1,
                    enrichment_status = 'pending',
                    enrichment_attempts = 0,
                    metadata = jsonb_set(
                      jsonb_set(metadata, '{title}', to_jsonb($3::text)),
                      '{path}', to_jsonb($4::text)
                    ),
                    version = version + 1
                WHERE id = $2 AND version = $5
              `,
              [file.content, existing.entity_id, title, file.path, currentVersion]
            );

            await client.query(
              `
                UPDATE document_sources
                SET sha = $1, last_synced = now(), sync_status = 'current'
                WHERE id = $2
              `,
              [file.sha, existing.id]
            );

            updated += 1;
          } else {
            // Unchanged — just touch last_synced
            await client.query(
              'UPDATE document_sources SET last_synced = now() WHERE id = $1',
              [existing.id]
            );
            unchanged += 1;
          }
        }

        // Find deleted files (in DB but not in manifest)
        let deleted = 0;
        for (const [existingPath, existing] of existingByPath) {
          if (!incomingPaths.has(existingPath) && existing.sync_status !== 'stale') {
            await client.query(
              "UPDATE entities SET status = 'archived' WHERE id = $1",
              [existing.entity_id]
            );
            await client.query(
              "UPDATE document_sources SET sync_status = 'stale', last_synced = now() WHERE id = $1",
              [existing.id]
            );
            deleted += 1;
          }
        }

        await client.query('COMMIT');

        await appendAuditEntry(pool, {
          apiKeyId: auth.apiKeyId,
          operation: 'sync.complete',
          details: { repo: input.repo, created, updated, unchanged, deleted }
        });

        return { created, updated, unchanged, deleted };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to sync manifest')
  );
}

export function getSyncStatus(
  pool: Pool,
  auth: AuthContext,
  repo: string
): ServiceResult<SyncStatusEntry[]> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const rows = await pool.query<SyncStatusRow>(
        `
          SELECT path, sha, sync_status, last_synced, entity_id
          FROM document_sources
          WHERE repo = $1
          ORDER BY path
        `,
        [repo]
      );

      return rows.rows.map((row) => ({
        path: row.path,
        sha: row.sha,
        syncStatus: row.sync_status,
        lastSynced: row.last_synced.toISOString(),
        entityId: row.entity_id
      }));
    })(),
    (error) => toAppError(error, 'Failed to get sync status')
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/integration/sync-service.test.ts`
Expected: PASS — all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/sync-service.ts tests/integration/sync-service.test.ts
git commit -m "feat: implement syncManifest and getSyncStatus service"
```

---

## Task 4: REST Endpoints

**Files:**
- Modify: `src/transport/rest.ts`
- Modify: `tests/contract/rest-api.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add to `tests/contract/rest-api.test.ts` inside the existing describe block:

```typescript
it('syncs a document repo and returns sync status', async () => {
  const { app, apiKey } = await createAuthorizedApp();

  // Push sync manifest
  const syncResponse = await app.request('/api/sync', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      repo: 'contract-repo',
      files: [
        { path: 'readme.md', sha: 'abc123', content: '# Readme\n\nHello world.' },
        { path: 'notes.md', sha: 'def456', content: 'Some notes here.' }
      ]
    })
  });

  expect(syncResponse.status).toBe(200);
  const syncBody = (await syncResponse.json()) as {
    created: number;
    updated: number;
    unchanged: number;
    deleted: number;
  };
  expect(syncBody).toEqual({
    created: 2,
    updated: 0,
    unchanged: 0,
    deleted: 0
  });

  // Get sync status
  const statusResponse = await app.request('/api/sync/status/contract-repo', {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  expect(statusResponse.status).toBe(200);
  const statusBody = (await statusResponse.json()) as {
    repo: string;
    files: Array<{ path: string; sha: string; syncStatus: string }>;
  };
  expect(statusBody.repo).toBe('contract-repo');
  expect(statusBody.files).toHaveLength(2);
  expect(statusBody.files[0]).toMatchObject({
    path: 'notes.md',
    sha: 'def456',
    syncStatus: 'current'
  });
}, 120_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/contract/rest-api.test.ts`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Add REST routes**

Add to `src/transport/rest.ts` in `registerRestRoutes`, at the end before the closing `}`:

First add the zod schema at the top with the other schemas:

```typescript
const syncManifestSchema = z.object({
  repo: z.string().min(1),
  files: z.array(
    z.object({
      path: z.string().min(1),
      sha: z.string().min(1),
      content: z.string()
    })
  )
});
```

Add the import at the top:

```typescript
import { syncManifest, getSyncStatus } from '../services/sync-service.js';
```

Add the routes at the end of `registerRestRoutes`:

```typescript
  app.post('/api/sync', async (c) => {
    const auth = c.get('auth');
    const body = parseJsonBody(syncManifestSchema, await c.req.json());
    const result = await syncManifest(pool, auth, body);

    if (result.isErr()) {
      throw result.error;
    }

    return c.json(result.value);
  });

  app.get('/api/sync/status/:repo', async (c) => {
    const auth = c.get('auth');
    const repo = c.req.param('repo');
    const result = await getSyncStatus(pool, auth, repo);

    if (result.isErr()) {
      throw result.error;
    }

    return c.json({
      repo,
      files: result.value
    });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/contract/rest-api.test.ts`
Expected: PASS — all 6 tests pass (5 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/transport/rest.ts tests/contract/rest-api.test.ts
git commit -m "feat: add REST endpoints for document sync"
```

---

## Task 5: MCP Tools

**Files:**
- Modify: `src/transport/mcp.ts`
- Modify: `tests/contract/mcp-tools.test.ts`

- [ ] **Step 1: Write failing contract test**

Add to `tests/contract/mcp-tools.test.ts` inside the existing describe block:

```typescript
it('syncs documents and returns status via MCP tools', async () => {
  const { client, close } = await startServerWithEmbeddingService(
    createEmbeddingService()
  );

  try {
    // Use sync_push tool
    const pushResult = (await client.callTool({
      name: 'sync_push',
      arguments: {
        repo: 'mcp-repo',
        files: [
          { path: 'test.md', sha: 'mcp-sha-1', content: '# MCP Test\n\nContent.' }
        ]
      }
    })) as ToolResultPayload;

    expect(pushResult.isError).toBeUndefined();
    const pushPayload = extractStructuredPayload(pushResult) as {
      created: number;
      updated: number;
    };
    expect(pushPayload.created).toBe(1);
    expect(pushPayload.updated).toBe(0);

    // Use sync_status tool
    const statusResult = (await client.callTool({
      name: 'sync_status',
      arguments: {
        repo: 'mcp-repo'
      }
    })) as ToolResultPayload;

    expect(statusResult.isError).toBeUndefined();
    const statusPayload = extractStructuredPayload(statusResult) as {
      repo: string;
      files: Array<{ path: string; sha: string; syncStatus: string }>;
    };
    expect(statusPayload.repo).toBe('mcp-repo');
    expect(statusPayload.files).toHaveLength(1);
    expect(statusPayload.files[0]?.path).toBe('test.md');
  } finally {
    await close();
  }
}, 120_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/contract/mcp-tools.test.ts`
Expected: FAIL — `sync_push` tool not found.

- [ ] **Step 3: Add MCP tools**

Add the import to `src/transport/mcp.ts`:

```typescript
import { syncManifest, getSyncStatus } from '../services/sync-service.js';
```

Add tools inside `createSessionServer`, after the `task_complete` tool registration:

```typescript
  server.registerTool(
    'sync_push',
    {
      description: 'Sync a document repository. Sends a manifest of files with content and SHA-256 hashes.',
      inputSchema: {
        repo: z.string().min(1),
        files: z.array(
          z.object({
            path: z.string().min(1),
            sha: z.string().min(1),
            content: z.string()
          })
        )
      }
    },
    (args) =>
      toolFromService(
        syncManifest(pool, auth, {
          repo: args.repo,
          files: args.files
        }),
        (value) => value
      )
  );

  server.registerTool(
    'sync_status',
    {
      description: 'Get the sync status of a document repository.',
      inputSchema: {
        repo: z.string().min(1)
      }
    },
    (args) =>
      toolFromService(
        getSyncStatus(pool, auth, args.repo),
        (files) => ({ repo: args.repo, files })
      )
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/contract/mcp-tools.test.ts`
Expected: PASS — all 5 tests pass (4 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/transport/mcp.ts tests/contract/mcp-tools.test.ts
git commit -m "feat: add sync_push and sync_status MCP tools"
```

---

## Task 6: CLI Client Methods

**Files:**
- Modify: `src/cli/client.ts`

- [ ] **Step 1: Add syncRepo and getSyncStatus to the client**

Add to `src/cli/client.ts` inside the `createPgmClient` return object, after `listEntities`:

```typescript
syncRepo(input: {
  repo: string;
  files: Array<{ path: string; sha: string; content: string }>;
}) {
  return request<{
    created: number;
    updated: number;
    unchanged: number;
    deleted: number;
  }>(options, '/api/sync', {
    method: 'POST',
    body: input
  });
},
getSyncStatus(repo: string) {
  return request<{
    repo: string;
    files: Array<{
      path: string;
      sha: string;
      syncStatus: string;
      lastSynced: string;
      entityId: string;
    }>;
  }>(options, `/api/sync/status/${encodeURIComponent(repo)}`);
},
```

- [ ] **Step 2: Build to verify types compile**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add src/cli/client.ts
git commit -m "feat: add syncRepo and getSyncStatus to CLI client"
```

---

## Task 7: `pgm sync` CLI Command

**Files:**
- Modify: `src/cli/pgm.ts`
- Modify: `tests/integration/cli-pgm.test.ts`

- [ ] **Step 1: Write failing integration test**

Add to `tests/integration/cli-pgm.test.ts` inside the `pgm CLI` describe block. The test needs to create a temp directory with markdown files and run `pgm sync` against it.

```typescript
it('syncs a local directory of markdown files', async () => {
  if (!database) {
    throw new Error('test database not initialized');
  }

  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const createdKey = (await createKey(database.pool, {
    name: `sync-${crypto.randomUUID()}`,
    scopes: ['read', 'write', 'delete'],
    allowedVisibility: ['shared']
  }))._unsafeUnwrap();

  const env = {
    PGM_API_URL: baseUrl,
    PGM_API_KEY: createdKey.plaintextKey
  };

  // Create a temp directory with markdown files
  const tempDir = await mkdtemp(join(tmpdir(), 'pgm-sync-test-'));
  await writeFile(join(tempDir, 'alpha.md'), '# Alpha\n\nAlpha content.');
  await writeFile(join(tempDir, 'beta.md'), 'Beta content without heading.');

  // Run pgm sync
  const syncResult = await runPgm(
    ['sync', tempDir, '--json'],
    env
  );
  const syncBody = parseJson(syncResult.stdout) as {
    created: number;
    updated: number;
    unchanged: number;
    deleted: number;
  };
  expect(syncBody.created).toBe(2);
  expect(syncBody.unchanged).toBe(0);

  // Re-sync should show unchanged
  const resyncResult = await runPgm(
    ['sync', tempDir, '--json'],
    env
  );
  const resyncBody = parseJson(resyncResult.stdout) as {
    unchanged: number;
  };
  expect(resyncBody.unchanged).toBe(2);

  // Clean up temp directory
  const { rm } = await import('node:fs/promises');
  await rm(tempDir, { recursive: true });
}, 120_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/integration/cli-pgm.test.ts`
Expected: FAIL — `pgm sync` command does not exist.

- [ ] **Step 3: Add the sync command to pgm.ts**

Add to `src/cli/pgm.ts` after the `backup` command, before `await program.parseAsync(process.argv)`. Add the needed imports at the top of the file:

```typescript
import { createHash } from 'node:crypto';
import { readdir, readFile as fsReadFile, stat as fsStat } from 'node:fs/promises';
```

Add the command:

```typescript
program
  .command('sync')
  .description('Sync a local directory of markdown files')
  .argument('<dir>', 'directory path to sync')
  .option('--repo <name>', 'repo identifier (defaults to directory name)')
  .option('--dry-run', 'show what would change without syncing')
  .option('--quiet', 'suppress output')
  .action(async (dir, options, command) => {
    const json = isJsonMode(command);

    try {
      const resolvedDir = path.resolve(dir);
      const repoName = options.repo ?? path.basename(resolvedDir);

      // Walk directory for .md files
      const files: Array<{ path: string; sha: string; content: string }> = [];
      const SKIP_DIRS = new Set(['.git', 'node_modules', '.obsidian', '.trash']);

      async function walk(dirPath: string, prefix: string): Promise<void> {
        const entries = await readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
              await walk(
                path.join(dirPath, entry.name),
                prefix ? `${prefix}/${entry.name}` : entry.name
              );
            }
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const fullPath = path.join(dirPath, entry.name);
            const content = await fsReadFile(fullPath, 'utf8');
            const sha = createHash('sha256').update(content).digest('hex');
            const relativePath = prefix
              ? `${prefix}/${entry.name}`
              : entry.name;
            files.push({ path: relativePath, sha, content });
          }
        }
      }

      await walk(resolvedDir, '');

      const config = await resolvePgmConfig();
      const client = createPgmClient(config);

      if (options.dryRun) {
        const status = await client.getSyncStatus(repoName);
        const existingByPath = new Map(
          status.files.map((f) => [f.path, f])
        );
        const incomingPaths = new Set(files.map((f) => f.path));

        let newCount = 0;
        let changedCount = 0;
        let unchangedCount = 0;
        for (const file of files) {
          const existing = existingByPath.get(file.path);
          if (!existing) {
            newCount += 1;
          } else if (existing.sha !== file.sha) {
            changedCount += 1;
          } else {
            unchangedCount += 1;
          }
        }
        let deletedCount = 0;
        for (const [existingPath, entry] of existingByPath) {
          if (!incomingPaths.has(existingPath) && entry.syncStatus !== 'stale') {
            deletedCount += 1;
          }
        }

        const result = {
          created: newCount,
          updated: changedCount,
          unchanged: unchangedCount,
          deleted: deletedCount
        };

        if (json) {
          printJson(result);
        } else if (!options.quiet) {
          printHuman([
            `Dry run ${repoName}: ${result.created} to create, ${result.updated} to update, ${result.unchanged} unchanged, ${result.deleted} to delete`
          ]);
        }
        return;
      }

      const result = await client.syncRepo({ repo: repoName, files });

      if (json) {
        printJson(result);
      } else if (!options.quiet) {
        printHuman([
          `Synced ${repoName}: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.deleted} deleted`
        ]);
      }
    } catch (error) {
      await handleCliFailure(error, json);
    }
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/integration/cli-pgm.test.ts`
Expected: PASS — all 4 tests pass (3 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/cli/pgm.ts tests/integration/cli-pgm.test.ts
git commit -m "feat: add pgm sync command for local directory sync"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: PASS — all tests pass.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Clean compilation.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 4: Commit any remaining changes**

If any files were missed, stage and commit them.
