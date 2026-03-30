# Phase 3: Knowledge Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a knowledge graph layer with typed edges between entities, LLM-powered relationship extraction on write, graph traversal, and graph-enhanced search.

**Architecture:** New `edges` table with directional typed relationships. Edge CRUD via edge-service. LLM extraction runs as a second stage in the enrichment worker after chunking/embedding completes — sends content to `gpt-4o-mini`, matches extracted references against existing entities by name, creates edges. Graph traversal uses recursive CTEs. Search optionally expands 1-hop neighbors.

**Tech Stack:** TypeScript, Postgres (recursive CTEs), OpenAI gpt-4o-mini, Hono, Vitest, testcontainers

**Design spec:** `docs/superpowers/specs/2026-03-30-phase3-knowledge-graph-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/db/migrations/004_knowledge_graph.sql` | edges table + extraction_status column |
| Modify | `src/config.ts` | EXTRACTION_ENABLED, EXTRACTION_MODEL env vars |
| Create | `src/services/edge-service.ts` | createEdge, deleteEdge, listEdges, expandGraph |
| Create | `src/services/extraction-service.ts` | LLM extraction, entity matching, prompt |
| Modify | `src/services/enrichment-worker.ts` | Extraction stage after enrichment |
| Modify | `src/services/search-service.ts` | expand_graph option |
| Modify | `src/transport/rest.ts` | Edge endpoints, graph expand |
| Modify | `src/transport/mcp.ts` | link, unlink, expand tools |
| Modify | `src/cli/client.ts` | Edge client methods |
| Modify | `src/cli/pgm.ts` | link, unlink, expand commands |
| Create | `tests/unit/extraction.test.ts` | Extraction response parsing |
| Create | `tests/integration/edge-service.test.ts` | Edge CRUD + graph traversal |
| Create | `tests/integration/extraction-service.test.ts` | Extraction pipeline |
| Modify | `tests/contract/rest-api.test.ts` | Edge endpoint tests |
| Modify | `tests/contract/mcp-tools.test.ts` | link/unlink/expand tool tests |
| Modify | `tests/integration/cli-pgm.test.ts` | CLI edge command tests |
| Modify | `tests/helpers/postgres.ts` | Add edges to truncate |

---

## Task 1: Schema Migration + Config

**Files:**
- Create: `src/db/migrations/004_knowledge_graph.sql`
- Modify: `src/config.ts`

- [ ] **Step 1: Write the migration file**

```sql
-- 004_knowledge_graph.sql
-- Knowledge graph: edges between entities
CREATE TABLE edges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation   text NOT NULL,
  confidence float NOT NULL DEFAULT 1.0,
  source     text,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source_id, target_id, relation)
);

CREATE INDEX idx_edges_source ON edges (source_id);
CREATE INDEX idx_edges_target ON edges (target_id);
CREATE INDEX idx_edges_relation ON edges (relation);

-- LLM extraction status tracking
ALTER TABLE entities
  ADD COLUMN extraction_status text CHECK (extraction_status IN ('pending', 'completed', 'failed'));
```

- [ ] **Step 2: Add config vars**

Add to `src/config.ts` configSchema:

```typescript
EXTRACTION_ENABLED: z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true'),
EXTRACTION_MODEL: z.string().default('gpt-4o-mini')
```

- [ ] **Step 3: Update test helper**

Add `edges` to the TRUNCATE list in `tests/helpers/postgres.ts`.

- [ ] **Step 4: Verify migration runs**

Run: `npm test -- --run tests/contract/health.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/004_knowledge_graph.sql src/config.ts tests/helpers/postgres.ts
git commit -m "feat: add edges table, extraction_status, and extraction config"
```

---

## Task 2: Edge Service — CRUD

**Files:**
- Create: `src/services/edge-service.ts`
- Create: `tests/integration/edge-service.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
// tests/integration/edge-service.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEdge, deleteEdge, listEdges } from '../../src/services/edge-service.js';
import { storeEntity } from '../../src/services/entity-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase, resetTestDatabase, seedApiKey, type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000301',
    keyName: 'edge-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

describe('edge-service', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) throw new Error('test database not initialized');
    await resetTestDatabase(database.pool);
    await seedApiKey(database.pool, {
      id: '00000000-0000-0000-0000-000000000301',
      name: 'edge-key'
    });
  });

  afterAll(async () => {
    if (database) await database.close();
  });

  it('creates, lists, and deletes edges between entities', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    const entityA = (await storeEntity(database.pool, auth, {
      type: 'person', content: 'Alice the engineer'
    }))._unsafeUnwrap();
    const entityB = (await storeEntity(database.pool, auth, {
      type: 'project', content: 'Project Alpha'
    }))._unsafeUnwrap();

    // Create edge
    const edge = await createEdge(database.pool, auth, {
      sourceId: entityA.id,
      targetId: entityB.id,
      relation: 'involves'
    });
    expect(edge.isOk()).toBe(true);
    const created = edge._unsafeUnwrap();
    expect(created.relation).toBe('involves');
    expect(created.confidence).toBe(1.0);

    // List edges
    const edges = await listEdges(database.pool, auth, entityA.id);
    expect(edges.isOk()).toBe(true);
    expect(edges._unsafeUnwrap()).toHaveLength(1);

    // Delete edge
    const deleted = await deleteEdge(database.pool, auth, created.id);
    expect(deleted.isOk()).toBe(true);

    // Verify deleted
    const afterDelete = await listEdges(database.pool, auth, entityA.id);
    expect(afterDelete._unsafeUnwrap()).toHaveLength(0);
  }, 120_000);

  it('upserts edges with same source+target+relation', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    const entityA = (await storeEntity(database.pool, auth, {
      type: 'person', content: 'Bob'
    }))._unsafeUnwrap();
    const entityB = (await storeEntity(database.pool, auth, {
      type: 'project', content: 'Beta'
    }))._unsafeUnwrap();

    await createEdge(database.pool, auth, {
      sourceId: entityA.id, targetId: entityB.id,
      relation: 'involves', confidence: 0.5
    });

    // Upsert with higher confidence
    const upserted = await createEdge(database.pool, auth, {
      sourceId: entityA.id, targetId: entityB.id,
      relation: 'involves', confidence: 0.9
    });
    expect(upserted.isOk()).toBe(true);
    expect(upserted._unsafeUnwrap().confidence).toBe(0.9);

    // Should still be one edge
    const edges = await listEdges(database.pool, auth, entityA.id);
    expect(edges._unsafeUnwrap()).toHaveLength(1);
  }, 120_000);
});
```

- [ ] **Step 2: Implement edge-service.ts**

```typescript
// src/services/edge-service.ts
import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';

export type Edge = {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  confidence: number;
  source: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type EdgeRow = {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  confidence: number;
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
};

type CreateEdgeInput = {
  sourceId: string;
  targetId: string;
  relation: string;
  confidence?: number;
  source?: string;
  metadata?: Record<string, unknown>;
};

function mapEdge(row: EdgeRow): Edge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relation: row.relation,
    confidence: row.confidence,
    source: row.source,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString()
  };
}

function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error)
    return new AppError(ErrorCode.INTERNAL, fallbackMessage, { cause: error.message });
  return new AppError(ErrorCode.INTERNAL, fallbackMessage);
}

export function createEdge(
  pool: Pool, auth: AuthContext, input: CreateEdgeInput
): ServiceResult<Edge> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'write');

      // Verify both entities exist
      const entities = await pool.query(
        'SELECT id FROM entities WHERE id = ANY($1)',
        [[input.sourceId, input.targetId]]
      );
      if (entities.rows.length < 2) {
        throw new AppError(ErrorCode.NOT_FOUND, 'One or both entities not found');
      }

      const result = await pool.query<EdgeRow>(
        `
          INSERT INTO edges (source_id, target_id, relation, confidence, source, metadata)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (source_id, target_id, relation)
          DO UPDATE SET confidence = $4, metadata = $6, source = $5
          RETURNING *
        `,
        [
          input.sourceId, input.targetId, input.relation,
          input.confidence ?? 1.0, input.source ?? 'manual',
          input.metadata ?? {}
        ]
      );

      const row = result.rows[0];
      if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create edge');

      await appendAuditEntry(pool, {
        apiKeyId: auth.apiKeyId,
        operation: 'edge.create',
        entityId: input.sourceId,
        details: { targetId: input.targetId, relation: input.relation }
      });

      return mapEdge(row);
    })(),
    (error) => toAppError(error, 'Failed to create edge')
  );
}

export function deleteEdge(
  pool: Pool, auth: AuthContext, edgeId: string
): ServiceResult<{ id: string; deleted: true }> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'delete');

      const result = await pool.query(
        'DELETE FROM edges WHERE id = $1 RETURNING id',
        [edgeId]
      );
      if (result.rowCount === 0) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Edge not found');
      }

      await appendAuditEntry(pool, {
        apiKeyId: auth.apiKeyId,
        operation: 'edge.delete',
        details: { edgeId }
      });

      return { id: edgeId, deleted: true as const };
    })(),
    (error) => toAppError(error, 'Failed to delete edge')
  );
}

export function listEdges(
  pool: Pool, auth: AuthContext, entityId: string,
  options: { relation?: string; direction?: 'source' | 'target' | 'both' } = {}
): ServiceResult<Edge[]> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const direction = options.direction ?? 'both';
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (direction === 'source' || direction === 'both') {
        conditions.push(`source_id = $1`);
      }
      if (direction === 'target' || direction === 'both') {
        conditions.push(`target_id = $1`);
      }
      params.push(entityId);

      let whereClause = conditions.join(' OR ');
      if (options.relation) {
        params.push(options.relation);
        whereClause = `(${whereClause}) AND relation = $${params.length}`;
      }

      const result = await pool.query<EdgeRow>(
        `SELECT * FROM edges WHERE ${whereClause} ORDER BY created_at DESC`,
        params
      );

      return result.rows.map(mapEdge);
    })(),
    (error) => toAppError(error, 'Failed to list edges')
  );
}

type ExpandResult = {
  entities: Array<{
    id: string;
    type: string;
    content: string | null;
    metadata: Record<string, unknown>;
  }>;
  edges: Edge[];
};

type ExpandEntityRow = {
  id: string;
  type: string;
  content: string | null;
  metadata: Record<string, unknown>;
};

export function expandGraph(
  pool: Pool, auth: AuthContext,
  entityId: string,
  options: { depth?: number; relationTypes?: string[] } = {}
): ServiceResult<ExpandResult> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const depth = Math.min(options.depth ?? 1, 3);
      const relationFilter = options.relationTypes?.length
        ? options.relationTypes
        : null;

      const edgeRows = await pool.query<EdgeRow>(
        `
          WITH RECURSIVE graph AS (
            SELECT e.*, 1 AS depth
            FROM edges e
            WHERE (e.source_id = $1 OR e.target_id = $1)
              AND ($3::text[] IS NULL OR e.relation = ANY($3))

            UNION

            SELECT e.*, g.depth + 1
            FROM edges e
            JOIN graph g ON (
              e.source_id = g.target_id OR e.source_id = g.source_id
              OR e.target_id = g.source_id OR e.target_id = g.target_id
            )
            WHERE g.depth < $2
              AND ($3::text[] IS NULL OR e.relation = ANY($3))
              AND e.id != g.id
          )
          SELECT DISTINCT ON (id) id, source_id, target_id, relation, confidence, source, metadata, created_at
          FROM graph
        `,
        [entityId, depth, relationFilter]
      );

      // Collect unique entity IDs
      const entityIds = new Set<string>([entityId]);
      for (const row of edgeRows.rows) {
        entityIds.add(row.source_id);
        entityIds.add(row.target_id);
      }

      const entityRows = await pool.query<ExpandEntityRow>(
        'SELECT id, type, content, metadata FROM entities WHERE id = ANY($1)',
        [Array.from(entityIds)]
      );

      return {
        entities: entityRows.rows,
        edges: edgeRows.rows.map(mapEdge)
      };
    })(),
    (error) => toAppError(error, 'Failed to expand graph')
  );
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --run tests/integration/edge-service.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/services/edge-service.ts tests/integration/edge-service.test.ts
git commit -m "feat: implement edge service with CRUD and graph traversal"
```

---

## Task 3: Extraction Service

**Files:**
- Create: `src/services/extraction-service.ts`
- Create: `tests/unit/extraction.test.ts`
- Create: `tests/integration/extraction-service.test.ts`

- [ ] **Step 1: Write unit tests for response parsing**

```typescript
// tests/unit/extraction.test.ts
import { describe, expect, it } from 'vitest';
import { parseExtractionResponse } from '../../src/services/extraction-service.js';

describe('parseExtractionResponse', () => {
  it('parses valid extraction response', () => {
    const response = JSON.stringify([
      { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.9 },
      { target_name: 'Project X', target_type: 'project', relation: 'part_of', confidence: 0.8 }
    ]);
    const result = parseExtractionResponse(response);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ targetName: 'Alice', relation: 'involves' });
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseExtractionResponse('not json')).toEqual([]);
  });

  it('returns empty array for non-array response', () => {
    expect(parseExtractionResponse('{"key": "value"}')).toEqual([]);
  });

  it('filters out entries with missing required fields', () => {
    const response = JSON.stringify([
      { target_name: 'Valid', target_type: 'person', relation: 'involves', confidence: 0.9 },
      { target_name: '', relation: 'involves', confidence: 0.5 },
      { target_type: 'person', relation: 'involves' }
    ]);
    const result = parseExtractionResponse(response);
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement extraction-service.ts**

```typescript
// src/services/extraction-service.ts
import type { Pool } from 'pg';
import type { AuthContext } from '../auth/types.js';
import { createEdge } from './edge-service.js';

type ExtractionResult = {
  targetName: string;
  targetType: string;
  relation: string;
  confidence: number;
};

type RawExtraction = {
  target_name?: string;
  target_type?: string;
  relation?: string;
  confidence?: number;
};

export function parseExtractionResponse(response: string): ExtractionResult[] {
  try {
    const parsed: unknown = JSON.parse(response);
    if (!Array.isArray(parsed)) return [];

    return (parsed as RawExtraction[])
      .filter((item) =>
        typeof item.target_name === 'string' && item.target_name.length > 0 &&
        typeof item.relation === 'string' && item.relation.length > 0
      )
      .map((item) => ({
        targetName: item.target_name!,
        targetType: item.target_type ?? 'memory',
        relation: item.relation!,
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.5
      }));
  } catch {
    return [];
  }
}

export function buildExtractionPrompt(type: string, content: string): string {
  return `Given this knowledge entity, identify relationships to other entities.

Entity type: ${type}
Content: ${content}

Return a JSON array of relationships:
[
  {
    "target_name": "name of the referenced entity",
    "target_type": "person|project|task|memory|interaction|document",
    "relation": "involves|assigned_to|part_of|blocked_by|mentioned_in|related_to",
    "confidence": 0.0-1.0
  }
]

Only include clear, explicit relationships. Do not infer or speculate.
Return [] if no relationships are found.`;
}

type ExtractionOptions = {
  callLlm?: (prompt: string) => Promise<string>;
};

export async function extractAndLinkRelationships(
  pool: Pool,
  auth: AuthContext,
  entityId: string,
  entityType: string,
  content: string,
  options: ExtractionOptions = {}
): Promise<number> {
  const prompt = buildExtractionPrompt(entityType, content);
  const callLlm = options.callLlm ?? defaultCallLlm;

  const response = await callLlm(prompt);
  const extractions = parseExtractionResponse(response);

  let linked = 0;

  for (const extraction of extractions) {
    // Simple name matching against existing entities
    const matches = await pool.query<{ id: string }>(
      `
        SELECT id FROM entities
        WHERE status IS DISTINCT FROM 'archived'
          AND id != $1
          AND (
            metadata->>'title' ILIKE $2
            OR content ILIKE $3
          )
        LIMIT 1
      `,
      [entityId, extraction.targetName, `%${extraction.targetName}%`]
    );

    const matchedEntity = matches.rows[0];
    if (!matchedEntity) continue;

    const result = await createEdge(pool, auth, {
      sourceId: entityId,
      targetId: matchedEntity.id,
      relation: extraction.relation,
      confidence: extraction.confidence,
      source: 'llm-extraction'
    });

    if (result.isOk()) linked += 1;
  }

  return linked;
}

async function defaultCallLlm(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const model = process.env.EXTRACTION_MODEL ?? 'gpt-4o-mini';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`);
  }

  const body = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return body.choices[0]?.message?.content ?? '[]';
}
```

- [ ] **Step 3: Write integration test**

```typescript
// tests/integration/extraction-service.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { extractAndLinkRelationships } from '../../src/services/extraction-service.js';
import { storeEntity } from '../../src/services/entity-service.js';
import { listEdges } from '../../src/services/edge-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase, resetTestDatabase, seedApiKey, type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000302',
    keyName: 'extraction-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

describe('extraction-service', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) throw new Error('test database not initialized');
    await resetTestDatabase(database.pool);
    await seedApiKey(database.pool, {
      id: '00000000-0000-0000-0000-000000000302',
      name: 'extraction-key'
    });
  });

  afterAll(async () => {
    if (database) await database.close();
  });

  it('creates edges when LLM identifies matching entities', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    // Create target entities
    await storeEntity(database.pool, auth, {
      type: 'person', content: 'Alice is a senior engineer',
      metadata: { title: 'Alice' }
    });
    await storeEntity(database.pool, auth, {
      type: 'project', content: 'Project Alpha is a knowledge store',
      metadata: { title: 'Project Alpha' }
    });

    // Create source entity
    const source = (await storeEntity(database.pool, auth, {
      type: 'memory',
      content: 'Alice is working on Project Alpha to build the knowledge graph'
    }))._unsafeUnwrap();

    // Run extraction with mocked LLM
    const mockLlm = async () => JSON.stringify([
      { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.95 },
      { target_name: 'Project Alpha', target_type: 'project', relation: 'part_of', confidence: 0.9 },
      { target_name: 'Nonexistent', target_type: 'person', relation: 'involves', confidence: 0.8 }
    ]);

    const linked = await extractAndLinkRelationships(
      database.pool, auth, source.id, source.type, source.content!,
      { callLlm: mockLlm }
    );

    expect(linked).toBe(2); // Alice + Project Alpha matched, Nonexistent skipped

    const edges = await listEdges(database.pool, auth, source.id);
    expect(edges.isOk()).toBe(true);
    expect(edges._unsafeUnwrap()).toHaveLength(2);
    expect(edges._unsafeUnwrap().map((e) => e.relation).sort()).toEqual(['involves', 'part_of']);
  }, 120_000);
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run tests/unit/extraction.test.ts tests/integration/extraction-service.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/services/extraction-service.ts tests/unit/extraction.test.ts tests/integration/extraction-service.test.ts
git commit -m "feat: implement LLM extraction service with entity matching"
```

---

## Task 4: Wire Extraction into Enrichment Worker

**Files:**
- Modify: `src/services/enrichment-worker.ts`

- [ ] **Step 1: Add extraction stage**

After the enrichment worker sets `enrichment_status = 'completed'`, if `EXTRACTION_ENABLED` is true, set `extraction_status = 'pending'`. Then pick up entities with `extraction_status = 'pending'` and run extraction.

Add an `extractionEnabled` option to `EnrichmentWorkerOptions`. In `runOnce`, after the existing enrichment loop, add a second loop for extraction:

```typescript
// After existing enrichment processing, add extraction stage
if (options.extractionEnabled) {
  const extractionPending = await options.pool.query<PendingEntityRow & { type: string }>(
    `
      SELECT id, content, type
      FROM entities
      WHERE extraction_status = 'pending'
        AND content IS NOT NULL
      ORDER BY created_at ASC
    `
  );

  for (const entity of extractionPending.rows) {
    try {
      await extractAndLinkRelationships(
        options.pool, extractionAuth, entity.id,
        entity.type, entity.content, { callLlm: options.callLlm }
      );
      await options.pool.query(
        "UPDATE entities SET extraction_status = 'completed' WHERE id = $1",
        [entity.id]
      );
    } catch {
      await options.pool.query(
        "UPDATE entities SET extraction_status = 'failed' WHERE id = $1",
        [entity.id]
      );
    }
  }
}
```

Also update the enrichment success path to set `extraction_status = 'pending'` when extraction is enabled.

The worker needs an internal auth context for extraction (system-level, not tied to a user key). Use `apiKeyId: null` with full scopes.

- [ ] **Step 2: Run existing enrichment tests**

Run: `npm test -- --run tests/integration/enrichment-worker.test.ts`
Expected: All existing tests still pass (extraction is disabled by default).

- [ ] **Step 3: Commit**

```bash
git add src/services/enrichment-worker.ts
git commit -m "feat: wire LLM extraction into enrichment worker"
```

---

## Task 5: REST Endpoints for Edges

**Files:**
- Modify: `src/transport/rest.ts`
- Modify: `tests/contract/rest-api.test.ts`

- [ ] **Step 1: Add edge routes to rest.ts**

Add import: `import { createEdge, deleteEdge, listEdges, expandGraph } from '../services/edge-service.js';`

Add zod schemas:
```typescript
const createEdgeSchema = z.object({
  source_id: z.string().min(1),
  target_id: z.string().min(1),
  relation: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional()
});
```

Add routes at the end of `registerRestRoutes`:
- `POST /api/edges` — createEdge
- `DELETE /api/edges/:id` — deleteEdge
- `GET /api/entities/:id/edges` — listEdges (with ?relation, ?direction query params)
- `GET /api/entities/:id/graph` — expandGraph (with ?depth, ?relation_types query params)

- [ ] **Step 2: Add contract tests**

Add to `tests/contract/rest-api.test.ts`:

```typescript
it('creates edges and expands graph between entities', async () => {
  const { app, apiKey } = await createAuthorizedApp();

  // Create two entities
  const personRes = await app.request('/api/entities', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'person', content: 'Alice' })
  });
  const person = ((await personRes.json()) as { entity: { id: string } }).entity;

  const projectRes = await app.request('/api/entities', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'project', content: 'Alpha' })
  });
  const project = ((await projectRes.json()) as { entity: { id: string } }).entity;

  // Create edge
  const edgeRes = await app.request('/api/edges', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_id: person.id, target_id: project.id, relation: 'involves'
    })
  });
  expect(edgeRes.status).toBe(201);
  const edge = ((await edgeRes.json()) as { edge: { id: string; relation: string } }).edge;
  expect(edge.relation).toBe('involves');

  // List edges
  const listRes = await app.request(`/api/entities/${person.id}/edges`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  expect(listRes.status).toBe(200);
  const edges = ((await listRes.json()) as { edges: Array<{ id: string }> }).edges;
  expect(edges).toHaveLength(1);

  // Expand graph
  const graphRes = await app.request(`/api/entities/${person.id}/graph`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  expect(graphRes.status).toBe(200);
  const graph = (await graphRes.json()) as {
    entities: Array<{ id: string }>;
    edges: Array<{ id: string }>;
  };
  expect(graph.entities.length).toBeGreaterThanOrEqual(2);
  expect(graph.edges).toHaveLength(1);

  // Delete edge
  const deleteRes = await app.request(`/api/edges/${edge.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  expect(deleteRes.status).toBe(200);
}, 120_000);
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --run tests/contract/rest-api.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/transport/rest.ts tests/contract/rest-api.test.ts
git commit -m "feat: add REST endpoints for edges and graph traversal"
```

---

## Task 6: MCP Tools for Edges

**Files:**
- Modify: `src/transport/mcp.ts`
- Modify: `tests/contract/mcp-tools.test.ts`

- [ ] **Step 1: Add MCP tools**

Add import: `import { createEdge, deleteEdge, expandGraph } from '../services/edge-service.js';`

Register `link`, `unlink`, `expand` tools in `createSessionServer`.

- [ ] **Step 2: Add contract test**

Add test that creates entities, links them via MCP `link` tool, expands via `expand` tool, and unlinks via `unlink` tool. Update the tool list test to expect the 3 new tools.

- [ ] **Step 3: Run tests**

Run: `npm test -- --run tests/contract/mcp-tools.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/transport/mcp.ts tests/contract/mcp-tools.test.ts
git commit -m "feat: add link, unlink, expand MCP tools"
```

---

## Task 7: CLI Commands for Edges

**Files:**
- Modify: `src/cli/client.ts`
- Modify: `src/cli/pgm.ts`
- Modify: `tests/integration/cli-pgm.test.ts`

- [ ] **Step 1: Add client methods**

Add `createEdge`, `deleteEdge`, `listEdges`, `expandGraph` methods to the client.

- [ ] **Step 2: Add CLI commands**

Add `pgm link <source-id> <target-id> --relation <type>`, `pgm unlink <edge-id>`, `pgm expand <entity-id>` commands.

- [ ] **Step 3: Add CLI integration test**

Test that creates two entities, links them, expands graph, and unlinks.

- [ ] **Step 4: Run tests**

Run: `npm test -- --run tests/integration/cli-pgm.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/cli/client.ts src/cli/pgm.ts tests/integration/cli-pgm.test.ts
git commit -m "feat: add pgm link, unlink, expand CLI commands"
```

---

## Task 8: Graph-Enhanced Search

**Files:**
- Modify: `src/services/search-service.ts`
- Modify: `src/transport/rest.ts`
- Modify: `src/transport/mcp.ts`

- [ ] **Step 1: Add expand_graph option to search**

Add `expandGraph?: boolean` to `SearchInput`. When true, after deduplication, for each result entity, fetch 1-hop edges and related entities. Add a `related` field to `SearchResult`.

In `rest.ts`, add `expand_graph: z.boolean().optional()` to `searchEntitiesSchema`.
In `mcp.ts`, add `expand_graph: z.boolean().optional()` to the search tool inputSchema.

- [ ] **Step 2: Run all search tests**

Run: `npm test -- --run tests/unit/search-scoring.test.ts tests/integration/search-service.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/services/search-service.ts src/transport/rest.ts src/transport/mcp.ts
git commit -m "feat: add expand_graph option to search"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`

- [ ] **Step 2: Build + lint**

Run: `npm run build && npm run lint`

- [ ] **Step 3: Commit any remaining changes**

---

## Task 10: E2E Sprite Smoke Test

- [ ] **Step 1: Create sprite and deploy**

Follow the sprite testing pattern from CLAUDE.md.

- [ ] **Step 2: Test edge CRUD + graph traversal + search**

Create entities, link them, expand graph, search with expand_graph=true.

- [ ] **Step 3: Destroy sprite**
