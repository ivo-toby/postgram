# Memory Lifecycle Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scoped session-context memory alongside durable memory, with role-aware enrichment, an MCP write helper, Postgram-owned grooming, and end-user documentation.

**Architecture:** Keep `type=memory` as the storage model and distinguish roles through `metadata.memory_role`. Add stable `api_keys.client_id` so session context scopes to the client rather than the credential. Postgram owns promotion/grooming; agents get `store_session_context` for easy writes but do not promote memory directly.

**Tech Stack:** TypeScript 5.9, Node.js 22, Hono REST transport, MCP SDK, PostgreSQL/pgvector, Vitest integration tests, Commander CLIs.

---

## File Map

- Modify: `src/db/migrations/008_client_id.sql`
  Adds stable `client_id` to API keys.
- Modify: `src/auth/types.ts`
  Adds `clientId` to `ApiKeyRecord` and `AuthContext`.
- Modify: `src/auth/key-service.ts`
  Reads, creates, and validates API keys with `client_id`.
- Modify: `src/cli/admin/pgm-admin.ts`
  Lets operators pass `--client-id` on key creation and shows it in key lists.
- Modify: `tests/helpers/postgres.ts`
  Seeds `client_id` for tests.
- Create: `src/services/memory-role-service.ts`
  Central helpers for memory roles, session scope, and session-context store input.
- Test: `tests/unit/memory-role-service.test.ts`
  Covers role normalization and session-scope defaults.
- Modify: `src/services/entity-service.ts`
  Uses memory-role helpers when storing/updating memory entities.
- Modify: `src/services/search-service.ts`
  Adds targeted `memoryRole` and client-scoped session-context filters.
- Modify: `src/transport/rest.ts`
  Accepts `memory_role` in search.
- Modify: `src/transport/mcp.ts`
  Registers `store_session_context` and accepts `memory_role` in `search`.
- Modify: `src/services/enrichment-worker.ts`
  Embeds `session_context` but skips extraction for it.
- Create: `src/services/memory-grooming-service.ts`
  Operator-facing grooming logic: select eligible session context, dry-run, archive, and distilled promotion entry points.
- Test: `tests/integration/memory-grooming-service.test.ts`
  Covers dry-run, archive, and non-verbatim promotion behavior.
- Modify: `src/cli/admin/pgm-admin.ts`
  Adds `pgm-admin memory groom`.
- Modify: `README.md`
  End-user durable-vs-session memory docs.
- Modify: `cli/README.md`
  CLI examples for durable memory and session context.
- Modify: `specs/001-phase1-mvp/contracts/mcp-tools.md`
  Documents `store_session_context` and `memory_role` search.
- Modify: `skill/postgram/SKILL.md`
  Keeps the bundled agent skill aligned with the new model.

---

### Task 1: Stable Client Identity On API Keys

**Files:**
- Create: `src/db/migrations/008_client_id.sql`
- Modify: `src/auth/types.ts`
- Modify: `src/auth/key-service.ts`
- Modify: `src/cli/admin/pgm-admin.ts`
- Modify: `tests/helpers/postgres.ts`
- Test: `tests/integration/key-service.test.ts`
- Test: `tests/integration/cli-admin.test.ts`

- [ ] **Step 1: Write the migration**

Create `src/db/migrations/008_client_id.sql`:

```sql
ALTER TABLE api_keys
  ADD COLUMN client_id text;

UPDATE api_keys
SET client_id = name
WHERE client_id IS NULL;

ALTER TABLE api_keys
  ALTER COLUMN client_id SET NOT NULL;

CREATE INDEX idx_api_keys_client_id
  ON api_keys (client_id);
```

- [ ] **Step 2: Update auth types**

In `src/auth/types.ts`, add `clientId`:

```ts
export type ApiKeyRecord = {
  id: string;
  name: string;
  clientId: string;
  keyHash: string;
  keyPrefix: string;
  scopes: Scope[];
  allowedTypes: EntityType[] | null;
  allowedVisibility: Visibility[];
  isActive: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export type AuthContext = {
  apiKeyId: string | null;
  keyName: string;
  clientId: string | null;
  scopes: Scope[];
  allowedTypes: EntityType[] | null;
  allowedVisibility: Visibility[];
};
```

- [ ] **Step 3: Update key service mappings and creation**

In `src/auth/key-service.ts`, add `clientId` to input and row types:

```ts
type CreateKeyInput = {
  name: string;
  clientId?: string | undefined;
  scopes?: Scope[] | undefined;
  allowedTypes?: EntityType[] | null | undefined;
  allowedVisibility?: Visibility[] | undefined;
};

type ApiKeyRow = {
  id: string;
  name: string;
  client_id: string;
  key_hash: string;
  key_prefix: string;
  scopes: Scope[];
  allowed_types: EntityType[] | null;
  allowed_visibility: Visibility[];
  is_active: boolean;
  created_at: Date;
  last_used_at: Date | null;
};
```

Update `mapApiKeyRecord` and `toAuthContext`:

```ts
function mapApiKeyRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    keyHash: row.key_hash,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    allowedTypes: row.allowed_types,
    allowedVisibility: row.allowed_visibility,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null
  };
}

function toAuthContext(record: ApiKeyRecord): AuthContext {
  return {
    apiKeyId: record.id,
    keyName: record.name,
    clientId: record.clientId,
    scopes: record.scopes,
    allowedTypes: record.allowedTypes,
    allowedVisibility: record.allowedVisibility
  };
}
```

Update `INSERT INTO api_keys` to include `client_id`:

```ts
const result = await pool.query<ApiKeyRow>(
  `
    INSERT INTO api_keys (
      name,
      client_id,
      key_hash,
      key_prefix,
      scopes,
      allowed_types,
      allowed_visibility
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `,
  [
    input.name,
    input.clientId ?? input.name,
    keyHash,
    keyPrefix,
    input.scopes ?? ['read'],
    input.allowedTypes ?? null,
    input.allowedVisibility ?? ['shared']
  ]
);
```

- [ ] **Step 4: Update system auth contexts**

Any manually constructed `AuthContext` must include `clientId: null`. For example, in `src/services/enrichment-worker.ts`:

```ts
const extractionAuth: AuthContext = {
  apiKeyId: null,
  keyName: 'system-extraction',
  clientId: null,
  scopes: ['read', 'write', 'delete'] as const,
  allowedTypes: null,
  allowedVisibility: ['personal', 'work', 'shared'] as const
};
```

- [ ] **Step 5: Update admin key CLI**

In `src/cli/admin/pgm-admin.ts`, add a key create option:

```ts
.option('--client-id <clientId>', 'stable client identity for session-context memory scope')
```

Pass it to `createKey`:

```ts
clientId: options.clientId,
```

Include `client_id` in the key row type and list formatting.

- [ ] **Step 6: Update test helper**

In `tests/helpers/postgres.ts`, update `seedApiKey` input with `clientId?: string` and insert `client_id`:

```ts
input.clientId ?? input.name
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- tests/integration/key-service.test.ts tests/integration/cli-admin.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/008_client_id.sql src/auth/types.ts src/auth/key-service.ts src/cli/admin/pgm-admin.ts tests/helpers/postgres.ts tests/integration/key-service.test.ts tests/integration/cli-admin.test.ts
git commit -m "feat(auth): add stable client identity to API keys"
```

---

### Task 2: Memory Role Helpers And Session Context Storage

**Files:**
- Create: `src/services/memory-role-service.ts`
- Test: `tests/unit/memory-role-service.test.ts`
- Modify: `src/services/entity-service.ts`
- Test: `tests/integration/entity-service.test.ts`

- [ ] **Step 1: Add memory role helper tests**

Create `tests/unit/memory-role-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildSessionContextMetadata,
  getMemoryRole,
  isSessionContextMemory
} from '../../src/services/memory-role-service.js';

describe('memory-role-service', () => {
  it('treats missing memory_role as durable_memory', () => {
    expect(getMemoryRole({})).toBe('durable_memory');
  });

  it('detects session_context memory', () => {
    expect(isSessionContextMemory({
      type: 'memory',
      metadata: { memory_role: 'session_context' }
    })).toBe(true);
  });

  it('defaults session scope from client_id', () => {
    expect(buildSessionContextMetadata({
      existing: {},
      auth: { clientId: 'codex-desktop' },
      input: { topic: 'postgram-memory', agentId: 'codex' }
    })).toEqual({
      memory_role: 'session_context',
      session_scope: { kind: 'client', client_id: 'codex-desktop' },
      topic: 'postgram-memory',
      agent_id: 'codex'
    });
  });
});
```

- [ ] **Step 2: Create memory role service**

Create `src/services/memory-role-service.ts`:

```ts
import type { AuthContext } from '../auth/types.js';

export type MemoryRole = 'durable_memory' | 'session_context';

export type SessionContextInput = {
  content: string;
  visibility?: 'personal' | 'work' | 'shared' | undefined;
  owner?: string | undefined;
  sessionId?: string | undefined;
  agentId?: string | undefined;
  topic?: string | undefined;
  tags?: string[] | undefined;
  promotable?: boolean | undefined;
  groomAfter?: string | undefined;
  expiresAt?: string | undefined;
};

export function getMemoryRole(metadata: Record<string, unknown> | null | undefined): MemoryRole {
  return metadata?.memory_role === 'session_context'
    ? 'session_context'
    : 'durable_memory';
}

export function isSessionContextMemory(entity: {
  type: string;
  metadata: Record<string, unknown> | null | undefined;
}): boolean {
  return entity.type === 'memory' && getMemoryRole(entity.metadata) === 'session_context';
}

export function buildSessionContextMetadata({
  existing,
  auth,
  input
}: {
  existing?: Record<string, unknown> | undefined;
  auth: Pick<AuthContext, 'clientId' | 'apiKeyId' | 'keyName'>;
  input: {
    sessionId?: string | undefined;
    agentId?: string | undefined;
    topic?: string | undefined;
    promotable?: boolean | undefined;
    groomAfter?: string | undefined;
    expiresAt?: string | undefined;
  };
}): Record<string, unknown> {
  const sessionScope = auth.clientId
    ? { kind: 'client', client_id: auth.clientId }
    : { kind: 'api_key', api_key_id: auth.apiKeyId, api_key_name: auth.keyName };

  return {
    ...(existing ?? {}),
    memory_role: 'session_context',
    session_scope: sessionScope,
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
    ...(input.agentId ? { agent_id: input.agentId } : {}),
    ...(input.topic ? { topic: input.topic } : {}),
    ...(input.promotable !== undefined ? { promotable: input.promotable } : {}),
    ...(input.groomAfter ? { groom_after: input.groomAfter } : {}),
    ...(input.expiresAt ? { expires_at: input.expiresAt } : {})
  };
}
```

- [ ] **Step 3: Export a service function for session-context storage**

In `src/services/entity-service.ts`, import the helper and add:

```ts
import {
  buildSessionContextMetadata,
  type SessionContextInput
} from './memory-role-service.js';
```

Add near `storeEntity`:

```ts
export function storeSessionContextMemory(
  pool: Pool,
  auth: AuthContext,
  input: SessionContextInput
): ServiceResult<Entity> {
  return storeEntity(pool, auth, {
    type: 'memory',
    content: input.content,
    visibility: input.visibility,
    owner: input.owner,
    tags: ['session-context', ...(input.tags ?? [])],
    metadata: buildSessionContextMetadata({
      auth,
      input: {
        sessionId: input.sessionId,
        agentId: input.agentId,
        topic: input.topic,
        promotable: input.promotable,
        groomAfter: input.groomAfter,
        expiresAt: input.expiresAt
      }
    })
  });
}
```

- [ ] **Step 4: Add integration test**

In `tests/integration/entity-service.test.ts`, add:

```ts
it('stores session context with client-scoped metadata', async () => {
  const result = await storeSessionContextMemory(database.pool, {
    ...auth,
    clientId: 'codex-desktop'
  }, {
    content: 'We are discussing memory lifecycle roles.',
    visibility: 'personal',
    topic: 'postgram-memory',
    agentId: 'codex'
  });

  expect(result.isOk()).toBe(true);
  const entity = result._unsafeUnwrap();
  expect(entity.type).toBe('memory');
  expect(entity.metadata).toMatchObject({
    memory_role: 'session_context',
    session_scope: { kind: 'client', client_id: 'codex-desktop' },
    topic: 'postgram-memory',
    agent_id: 'codex'
  });
  expect(entity.tags).toContain('session-context');
});
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/unit/memory-role-service.test.ts tests/integration/entity-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/memory-role-service.ts src/services/entity-service.ts tests/unit/memory-role-service.test.ts tests/integration/entity-service.test.ts
git commit -m "feat(memory): add session context role helpers"
```

---

### Task 3: MCP Tool And Scoped Search

**Files:**
- Modify: `src/transport/mcp.ts`
- Modify: `src/transport/rest.ts`
- Modify: `src/services/search-service.ts`
- Test: `tests/integration/search-service.test.ts`
- Test: `tests/integration/mcp-transport.test.ts` or the existing MCP contract test file if named differently
- Modify: `specs/001-phase1-mvp/contracts/mcp-tools.md`

- [ ] **Step 1: Add search-service tests for memory role filtering**

In `tests/integration/search-service.test.ts`, add a test that stores two session-context memories under different `clientId` values, embeds them with the existing helper pattern in the file, and verifies scoped search:

```ts
it('filters session-context search to the caller client', async () => {
  await storeAndEmbed(database.pool, { ...auth, clientId: 'codex' }, {
    type: 'memory',
    visibility: 'personal',
    content: 'Memory lifecycle roles discussion for Codex.',
    tags: ['session-context'],
    metadata: {
      memory_role: 'session_context',
      session_scope: { kind: 'client', client_id: 'codex' }
    }
  });

  await storeAndEmbed(database.pool, { ...auth, clientId: 'talon' }, {
    type: 'memory',
    visibility: 'personal',
    content: 'Memory lifecycle roles discussion for Talon.',
    tags: ['session-context'],
    metadata: {
      memory_role: 'session_context',
      session_scope: { kind: 'client', client_id: 'talon' }
    }
  });

  const result = await searchEntities(database.pool, { ...auth, clientId: 'codex' }, {
    query: 'memory lifecycle roles discussion',
    type: 'memory',
    memoryRole: 'session_context',
    limit: 10
  }, { embeddingService });

  expect(result.isOk()).toBe(true);
  const contents = result._unsafeUnwrap().results.map((entry) => entry.entity.content);
  expect(contents).toContain('Memory lifecycle roles discussion for Codex.');
  expect(contents).not.toContain('Memory lifecycle roles discussion for Talon.');
});
```

- [ ] **Step 2: Add targeted search inputs**

In `src/services/search-service.ts`, extend `SearchInput`:

```ts
type SearchInput = {
  query: string;
  type?: EntityType | undefined;
  tags?: string[] | undefined;
  visibility?: Visibility | undefined;
  owner?: string | undefined;
  memoryRole?: 'durable_memory' | 'session_context' | undefined;
  includeOtherClientsSessionContext?: boolean | undefined;
  limit?: number | undefined;
  threshold?: number | undefined;
  recencyWeight?: number | undefined;
  expandGraph?: boolean | undefined;
  includeArchived?: boolean | undefined;
};
```

Update the SQL `WHERE` clause in both hybrid and BM25 fallback paths:

```sql
AND (
  $11::text IS NULL
  OR COALESCE(e.metadata->>'memory_role', 'durable_memory') = $11
)
AND (
  $12::boolean = true
  OR $11::text IS DISTINCT FROM 'session_context'
  OR e.metadata #>> '{session_scope,client_id}' = $13
)
```

Append params:

```ts
input.memoryRole ?? null,
input.includeOtherClientsSessionContext ?? false,
auth.clientId
```

Use the same filter in fallback search.

- [ ] **Step 3: Add MCP `store_session_context`**

In `src/transport/mcp.ts`, import:

```ts
import { recallEntity, softDeleteEntity, storeEntity, storeSessionContextMemory, updateEntity } from '../services/entity-service.js';
```

Register the tool after `store`:

```ts
server.registerTool(
  'store_session_context',
  {
    description: 'Store short-lived working context for resuming recent conversations. Creates a memory with metadata.memory_role=session_context, scopes it to the authenticated client_id, embeds it for recall, and skips graph extraction.',
    inputSchema: {
      content: z.string().min(1),
      visibility: visibilitySchema.optional(),
      owner: ownerSchema.optional(),
      session_id: z.string().optional(),
      agent_id: z.string().optional(),
      topic: z.string().optional(),
      tags: z.array(z.string()).optional(),
      promotable: z.boolean().optional(),
      groom_after: z.string().optional(),
      expires_at: z.string().optional()
    }
  },
  (args) =>
    toolFromService(
      storeSessionContextMemory(pool, auth, {
        content: args.content,
        visibility: args.visibility,
        owner: args.owner,
        sessionId: args.session_id,
        agentId: args.agent_id,
        topic: args.topic,
        tags: args.tags,
        promotable: args.promotable,
        groomAfter: args.groom_after,
        expiresAt: args.expires_at
      }),
      (entity) => ({ entity: toStoredEntity(entity) })
    )
);
```

- [ ] **Step 4: Add `memory_role` to MCP and REST search schemas**

In `src/transport/mcp.ts`, add:

```ts
const memoryRoleSchema = z.enum(['durable_memory', 'session_context']);
```

Add search args:

```ts
memory_role: memoryRoleSchema.optional(),
include_other_clients_session_context: z.boolean().optional()
```

Map into service:

```ts
memoryRole: args.memory_role,
includeOtherClientsSessionContext: args.include_other_clients_session_context
```

Mirror this in `src/transport/rest.ts` search schema.

- [ ] **Step 5: Document MCP contract**

In `specs/001-phase1-mvp/contracts/mcp-tools.md`, add a `store_session_context` section with the input schema from Step 3 and note:

```md
Session-context memories are embedded for semantic recall but skipped by graph extraction. They are scoped to the authenticated API key's `client_id` by default.
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/integration/search-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/transport/mcp.ts src/transport/rest.ts src/services/search-service.ts tests/integration/search-service.test.ts specs/001-phase1-mvp/contracts/mcp-tools.md
git commit -m "feat(mcp): add scoped session context memory"
```

---

### Task 4: Role-Aware Enrichment

**Files:**
- Modify: `src/services/enrichment-worker.ts`
- Test: `tests/integration/enrichment-worker.test.ts`

- [ ] **Step 1: Add failing enrichment test**

In `tests/integration/enrichment-worker.test.ts`, add:

```ts
it('embeds session-context memory but does not queue graph extraction', async () => {
  const stored = (await storeEntity(database.pool, auth, {
    type: 'memory',
    content: 'Session context about Postgram memory lifecycle roles.',
    visibility: 'personal',
    metadata: {
      memory_role: 'session_context',
      session_scope: { kind: 'client', client_id: 'codex' }
    }
  }))._unsafeUnwrap();

  const worker = createEnrichmentWorker({
    pool: database.pool,
    embeddingService,
    extractionEnabled: true,
    callLlm: async () => '[]'
  });

  await worker.runOnce();

  const entity = await database.pool.query(
    'SELECT enrichment_status, extraction_status FROM entities WHERE id = $1',
    [stored.id]
  );
  const chunks = await database.pool.query(
    'SELECT count(*)::int AS count FROM chunks WHERE entity_id = $1',
    [stored.id]
  );

  expect(entity.rows[0]).toEqual({
    enrichment_status: 'completed',
    extraction_status: null
  });
  expect(chunks.rows[0].count).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Update enrichment worker selection**

In `src/services/enrichment-worker.ts`, include `metadata` in `PendingEntityRow`:

```ts
type PendingEntityRow = {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
};
```

Update the enrichment `SELECT`:

```sql
SELECT id, content, metadata
FROM entities
```

Import the helper:

```ts
import { getMemoryRole } from './memory-role-service.js';
```

- [ ] **Step 3: Skip extraction queueing for session context**

Before the enrichment status update, compute:

```ts
const shouldQueueExtraction =
  options.extractionEnabled &&
  getMemoryRole(entity.metadata) !== 'session_context';
```

Use `shouldQueueExtraction` in the update:

```sql
extraction_status = CASE
  WHEN $2::boolean = false THEN NULL
  WHEN 'auto-created' = ANY(tags) THEN NULL
  ELSE 'pending'
END
```

Pass `[entity.id, shouldQueueExtraction]`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/integration/enrichment-worker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/enrichment-worker.ts tests/integration/enrichment-worker.test.ts
git commit -m "feat(enrichment): skip graph extraction for session context"
```

---

### Task 5: Postgram-Owned Grooming

**Files:**
- Create: `src/services/memory-grooming-service.ts`
- Test: `tests/integration/memory-grooming-service.test.ts`
- Modify: `src/cli/admin/pgm-admin.ts`
- Modify: `docs/superpowers/specs/2026-05-31-memory-lifecycle-roles-design.md` if implementation decisions differ from the spec

- [ ] **Step 1: Add grooming service tests**

Create `tests/integration/memory-grooming-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { storeEntity } from '../../src/services/entity-service.js';
import {
  groomSessionContext,
  previewSessionContextGrooming
} from '../../src/services/memory-grooming-service.js';
import { createTestDatabase, resetTestDatabase, seedApiKey, type TestDatabase } from '../helpers/postgres.js';

describe('memory-grooming-service', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await resetTestDatabase(database.pool);
    await seedApiKey(database.pool, {
      name: 'groom-key',
      clientId: 'codex',
      scopes: ['read', 'write', 'delete'],
      allowedVisibility: ['personal']
    });
  });

  afterAll(async () => {
    await database.stop();
  });

  it('previews eligible session-context memories without mutating them', async () => {
    const auth = {
      apiKeyId: null,
      keyName: 'test',
      clientId: 'codex',
      scopes: ['read', 'write', 'delete'] as const,
      allowedTypes: null,
      allowedVisibility: ['personal'] as const
    };

    await storeEntity(database.pool, auth, {
      type: 'memory',
      content: 'Session context: decision was made to skip graph extraction.',
      visibility: 'personal',
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'codex' },
        groom_after: '2026-01-01T00:00:00.000Z'
      }
    });

    const preview = await previewSessionContextGrooming(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      limit: 10
    });

    expect(preview.isOk()).toBe(true);
    expect(preview._unsafeUnwrap().eligible.length).toBe(1);
  });

  it('archives stale session context without deleting it', async () => {
    const result = await groomSessionContext(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      mode: 'archive',
      dryRun: false,
      confirm: true,
      limit: 10
    });

    expect(result.isOk()).toBe(true);
  });
});
```

- [ ] **Step 2: Implement preview and archive-only grooming**

Create `src/services/memory-grooming-service.ts`:

```ts
import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import type { ServiceResult } from '../types/common.js';
import { AppError, ErrorCode } from '../util/errors.js';

export type GroomingCandidate = {
  id: string;
  content: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type GroomingPreview = {
  eligible: GroomingCandidate[];
};

export function previewSessionContextGrooming(
  pool: Pool,
  input: { clientId: string; now: Date; limit: number }
): ServiceResult<GroomingPreview> {
  return ResultAsync.fromPromise(
    (async () => {
      const result = await pool.query<{
        id: string;
        content: string | null;
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        `
          SELECT id, content, metadata, created_at
          FROM entities
          WHERE type = 'memory'
            AND status IS DISTINCT FROM 'archived'
            AND metadata->>'memory_role' = 'session_context'
            AND metadata #>> '{session_scope,client_id}' = $1
            AND metadata->>'promoted_to' IS NULL
            AND (
              (metadata->>'groom_after')::timestamptz <= $2
              OR created_at <= $2::timestamptz - interval '7 days'
            )
          ORDER BY created_at ASC
          LIMIT $3
        `,
        [input.clientId, input.now.toISOString(), input.limit]
      );

      return {
        eligible: result.rows.map((row) => ({
          id: row.id,
          content: row.content,
          metadata: row.metadata,
          createdAt: row.created_at.toISOString()
        }))
      };
    })(),
    (error) =>
      error instanceof AppError
        ? error
        : new AppError(ErrorCode.INTERNAL, 'Failed to preview memory grooming')
  );
}

export function groomSessionContext(
  pool: Pool,
  input: {
    clientId: string;
    now: Date;
    mode: 'archive';
    dryRun: boolean;
    confirm: boolean;
    limit: number;
  }
): ServiceResult<{ archived: number; dryRun: boolean }> {
  return ResultAsync.fromPromise(
    (async () => {
      if (!input.dryRun && !input.confirm) {
        throw new AppError(ErrorCode.VALIDATION, '--yes is required outside dry-run');
      }

      const preview = await previewSessionContextGrooming(pool, input);
      if (preview.isErr()) {
        throw preview.error;
      }

      const ids = preview.value.eligible.map((candidate) => candidate.id);
      if (input.dryRun || ids.length === 0) {
        return { archived: 0, dryRun: input.dryRun };
      }

      await pool.query(
        `UPDATE entities SET status = 'archived' WHERE id = ANY($1::uuid[])`,
        [ids]
      );

      return { archived: ids.length, dryRun: false };
    })(),
    (error) =>
      error instanceof AppError
        ? error
        : new AppError(ErrorCode.INTERNAL, 'Failed to groom session context')
  );
}
```

- [ ] **Step 3: Add admin CLI wrapper**

In `src/cli/admin/pgm-admin.ts`, add:

```ts
program
  .command('memory')
  .description('Memory maintenance commands')
  .command('groom')
  .description('Preview or archive eligible session-context memories')
  .requiredOption('--client-id <clientId>', 'client id to groom')
  .option('--limit <limit>', 'maximum candidates', '50')
  .option('--dry-run', 'preview without mutating')
  .option('--yes', 'confirm mutation')
  .action(async (options) => {
    const pool = createPoolFromConfig();
    const result = await groomSessionContext(pool, {
      clientId: options.clientId,
      now: new Date(),
      mode: 'archive',
      dryRun: Boolean(options.dryRun),
      confirm: Boolean(options.yes),
      limit: Number(options.limit)
    });
    await printServiceResult(result);
  });
```

Use the local admin CLI helper functions already present in the file for pool creation and output formatting instead of duplicating new infrastructure.

- [x] **Step 4: Add distilled promotion as a PR follow-up**

The implementation now supports `pgm-admin memory groom --mode promote --yes`.
Promotion uses the configured extraction LLM to assess each eligible
session-context memory, stores only distilled durable content, archives the
source context, and records provenance with `metadata.promoted_to` plus a
`promoted_to` edge.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/integration/memory-grooming-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/memory-grooming-service.ts src/cli/admin/pgm-admin.ts tests/integration/memory-grooming-service.test.ts
git commit -m "feat(memory): add session context grooming preview"
```

---

### Task 6: End-User Documentation And Skill

**Files:**
- Modify: `README.md`
- Modify: `cli/README.md`
- Modify: `specs/001-phase1-mvp/contracts/mcp-tools.md`
- Modify: `skill/postgram/SKILL.md`

- [ ] **Step 1: Update main README**

Add a section after "Typed Knowledge Storage":

```md
### Memory Roles

Postgram supports two roles for `memory` entities:

- `durable_memory`: long-term memory future agents should trust, such as decisions, preferences, constraints, root causes, and completed-work summaries.
- `session_context`: working context for resuming recent conversations. Session context is scoped to the calling client, embedded for semantic recall, and skipped by graph extraction.

Use session context for "where were we in this thread?" Use durable memory for "what should future agents remember as true?"
```

- [ ] **Step 2: Update CLI README**

Add examples:

```md
Store durable memory:

```bash
pgm store "Ivo prefers client-scoped session context in Postgram." \
  --type memory \
  --visibility personal \
  --metadata '{"memory_role":"durable_memory"}'
```

Store session context:

```bash
pgm store "We are discussing Postgram memory lifecycle roles." \
  --type memory \
  --visibility personal \
  --tags session-context \
  --metadata '{"memory_role":"session_context","topic":"postgram-memory"}'
```
```

- [ ] **Step 3: Finalize MCP docs**

Ensure `specs/001-phase1-mvp/contracts/mcp-tools.md` includes:

```md
### store_session_context

Stores short-lived working context for resuming recent conversations.

Session-context memories:

- are stored as `type=memory`
- have `metadata.memory_role=session_context`
- are scoped to the authenticated `client_id`
- are embedded for semantic recall
- do not run graph extraction
```

- [ ] **Step 4: Finalize bundled skill**

Ensure `skill/postgram/SKILL.md` contains:

```md
Use durable memory for information future agents should treat as stable. Use session context for "where we are in this thread" continuity. Session context is embedded for semantic recall, but should not participate in graph extraction.
```

- [ ] **Step 5: Run documentation checks**

Run:

```bash
npm run typecheck
```

Expected: PASS. Markdown has no repo-level linter, so manually inspect changed docs for broken fenced code blocks.

- [ ] **Step 6: Commit**

```bash
git add README.md cli/README.md specs/001-phase1-mvp/contracts/mcp-tools.md skill/postgram/SKILL.md
git commit -m "docs(memory): explain session context and durable memory"
```

---

### Task 7: Final Verification

**Files:**
- No new files. Verifies the full feature.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Manual MCP sanity**

Start Postgram with extraction enabled in a local test environment. Call `store_session_context`, wait for enrichment, then verify:

```sql
SELECT metadata, enrichment_status, extraction_status
FROM entities
WHERE metadata->>'memory_role' = 'session_context'
ORDER BY created_at DESC
LIMIT 1;
```

Expected:

- `metadata.memory_role = session_context`
- `metadata.session_scope.kind = client`
- `enrichment_status = completed`
- `extraction_status IS NULL`
- at least one `chunks` row exists for the entity

- [ ] **Step 5: Manual docs sanity**

Read these pages as a first-time user:

```bash
sed -n '1,180p' README.md
sed -n '1,140p' cli/README.md
sed -n '1,120p' specs/001-phase1-mvp/contracts/mcp-tools.md
```

Expected: a user can answer "Should I use session context or durable memory?" without reading the design spec.

- [ ] **Step 6: Commit final fixes**

If verification required fixes:

```bash
git add <changed-files>
git commit -m "fix(memory): address lifecycle verification findings"
```

---

## Self-Review

Spec coverage:

- Memory roles: Task 2.
- Stable client scoping: Task 1 and Task 3.
- Session context embedded but not graph-extracted: Task 4.
- MCP `store_session_context`: Task 3.
- Postgram-owned grooming: Task 5.
- End-user docs and bundled skill: Task 6.
- Verification: Task 7.

Known deliberate deferral:

- Grouped consolidation and scheduled grooming are not implemented yet. The
  first promotion path is operator-run and processes eligible memories
  individually.
