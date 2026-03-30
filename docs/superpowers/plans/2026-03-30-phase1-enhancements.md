# Phase 1 Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hybrid BM25+vector search, enrichment retry with backoff, batch re-embedding, `pgm list` CLI command, and startup OpenAI validation to the Phase 1 MVP.

**Architecture:** Single migration adds a generated tsvector column and an enrichment_attempts counter. Search blends vector cosine similarity with BM25 keyword ranking (0.6/0.4 weights), falling back to BM25-only when embeddings fail. The enrichment worker retries failed entities with backoff (5 min delay, max 3 attempts). New `pgm-admin reembed` marks entities for re-processing by the existing worker.

**Tech Stack:** TypeScript, Postgres (tsvector, pgvector), Hono, Vitest, testcontainers

**Design spec:** `docs/superpowers/specs/2026-03-30-phase1-enhancements-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/db/migrations/002_phase1_enhancements.sql` | tsvector column + enrichment_attempts column |
| Modify | `src/services/search-service.ts` | Hybrid search query, BM25 normalization, fallback |
| Modify | `src/services/enrichment-worker.ts` | Retry failed entities, increment attempts |
| Modify | `src/services/entity-service.ts` | Reset enrichment_attempts on content change |
| Modify | `src/cli/client.ts` | Add `listEntities()` method |
| Modify | `src/cli/pgm.ts` | Add `list` command |
| Modify | `src/cli/admin/pgm-admin.ts` | Add `reembed` command |
| Modify | `src/index.ts` | Startup embedding validation |
| Modify | `tests/unit/search-scoring.test.ts` | BM25 normalization + blending tests |
| Modify | `tests/integration/search-service.test.ts` | Hybrid search + fallback tests |
| Modify | `tests/integration/enrichment-worker.test.ts` | Retry + max attempts tests |
| Modify | `tests/integration/cli-pgm.test.ts` | `pgm list` test |
| Modify | `tests/integration/cli-admin.test.ts` | `pgm-admin reembed` test |
| Modify | `tests/helpers/postgres.ts` | Update `resetTestDatabase` for new column |

---

## Task 1: Schema Migration

**Files:**
- Create: `src/db/migrations/002_phase1_enhancements.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 002_phase1_enhancements.sql
-- Hybrid search: generated tsvector column with 'simple' config (language-agnostic)
ALTER TABLE entities
  ADD COLUMN search_tsvector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;

CREATE INDEX idx_entities_search_tsvector ON entities USING gin (search_tsvector);

-- Enrichment retry: attempt counter with backoff
ALTER TABLE entities
  ADD COLUMN enrichment_attempts integer NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Verify migration runs against test database**

Run: `npm test -- --run tests/contract/health.test.ts`
Expected: PASS — health test boots a fresh testcontainers database and runs all migrations including the new one.

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/002_phase1_enhancements.sql
git commit -m "feat: add migration for tsvector column and enrichment_attempts"
```

---

## Task 2: BM25 Score Normalization and Blending (Unit Tests + Logic)

**Files:**
- Modify: `src/services/search-service.ts`
- Modify: `tests/unit/search-scoring.test.ts`

- [ ] **Step 1: Write failing unit tests for BM25 normalization and blending**

Add to `tests/unit/search-scoring.test.ts`:

```typescript
import {
  applyRecencyBoost,
  blendScores,
  deduplicateResults,
  normalizeBm25Scores
} from '../../src/services/search-service.js';

describe('normalizeBm25Scores', () => {
  it('normalizes scores to 0-1 range by dividing by max', () => {
    const results = [
      { bm25: 0.6, id: 'a' },
      { bm25: 0.3, id: 'b' },
      { bm25: 0.0, id: 'c' }
    ];
    const normalized = normalizeBm25Scores(results);

    expect(normalized[0]?.bm25).toBeCloseTo(1.0);
    expect(normalized[1]?.bm25).toBeCloseTo(0.5);
    expect(normalized[2]?.bm25).toBeCloseTo(0.0);
  });

  it('returns all zeros when no keyword matches', () => {
    const results = [
      { bm25: 0, id: 'a' },
      { bm25: 0, id: 'b' }
    ];
    const normalized = normalizeBm25Scores(results);

    expect(normalized[0]?.bm25).toBe(0);
    expect(normalized[1]?.bm25).toBe(0);
  });
});

describe('blendScores', () => {
  it('blends vector and bm25 scores with 0.6/0.4 weights', () => {
    const score = blendScores(0.8, 0.5);
    // 0.6 * 0.8 + 0.4 * 0.5 = 0.48 + 0.20 = 0.68
    expect(score).toBeCloseTo(0.68);
  });

  it('returns vector-only score when bm25 is zero', () => {
    const score = blendScores(0.8, 0);
    // 0.6 * 0.8 + 0.4 * 0 = 0.48
    expect(score).toBeCloseTo(0.48);
  });

  it('returns bm25-only score when vector is zero', () => {
    const score = blendScores(0, 1.0);
    // 0.6 * 0 + 0.4 * 1.0 = 0.4
    expect(score).toBeCloseTo(0.4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run tests/unit/search-scoring.test.ts`
Expected: FAIL — `normalizeBm25Scores` and `blendScores` are not exported.

- [ ] **Step 3: Implement and export the functions**

Add to `src/services/search-service.ts` after the existing `applyRecencyBoost` function:

```typescript
const VECTOR_WEIGHT = 0.6;
const BM25_WEIGHT = 0.4;

export function normalizeBm25Scores<T extends { bm25: number }>(
  results: T[]
): T[] {
  const maxBm25 = Math.max(...results.map((r) => r.bm25));

  if (maxBm25 === 0) {
    return results;
  }

  return results.map((r) => ({
    ...r,
    bm25: r.bm25 / maxBm25
  }));
}

export function blendScores(
  vectorScore: number,
  normalizedBm25Score: number
): number {
  return VECTOR_WEIGHT * vectorScore + BM25_WEIGHT * normalizedBm25Score;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run tests/unit/search-scoring.test.ts`
Expected: PASS — all 7 tests pass (2 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/services/search-service.ts tests/unit/search-scoring.test.ts
git commit -m "feat: add BM25 score normalization and blending functions"
```

---

## Task 3: Hybrid Search Query

**Files:**
- Modify: `src/services/search-service.ts`
- Modify: `tests/integration/search-service.test.ts`

- [ ] **Step 1: Write failing integration test for hybrid search**

Add a new test to `tests/integration/search-service.test.ts`:

```typescript
it('boosts exact keyword matches via hybrid BM25+vector scoring', async () => {
  if (!database) {
    throw new Error('test database not initialized');
  }

  await storeEntity(database.pool, makeAuthContext(), {
    type: 'memory',
    content: 'pgvector lets postgres do vector search without a separate service',
    tags: ['database']
  });
  await storeEntity(database.pool, makeAuthContext(), {
    type: 'memory',
    content: 'relational databases handle structured data well',
    tags: ['database']
  });

  const embeddingService = createEmbeddingService();
  const worker = createEnrichmentWorker({
    pool: database.pool,
    embeddingService
  });
  await worker.runOnce();

  const result = await searchEntities(
    database.pool,
    makeAuthContext(),
    { query: 'pgvector' },
    { embeddingService }
  );

  expect(result.isOk()).toBe(true);
  const results = result._unsafeUnwrap().results;
  expect(results.length).toBeGreaterThan(0);
  // The entity with "pgvector" in the content should rank first
  // because BM25 boosts the exact keyword match
  expect(results[0]?.entity.content).toContain('pgvector');
}, 120_000);
```

- [ ] **Step 2: Run test to verify it fails (or check current behavior)**

Run: `npm test -- --run tests/integration/search-service.test.ts`
Expected: The test may pass incidentally with pure vector search (deterministic embeddings hash "pgvector" uniquely), but we need to wire the hybrid query regardless.

- [ ] **Step 3: Rewrite `searchEntities` to use hybrid BM25+vector query**

Replace the query and scoring logic in `src/services/search-service.ts`. The `searchEntities` function body becomes:

```typescript
export function searchEntities(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  options: SearchOptions = {}
): ServiceResult<{ results: SearchResult[] }> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const threshold = input.threshold ?? 0.35;
      const recencyWeight = input.recencyWeight ?? 0.1;
      const limit = input.limit ?? 10;
      const now = options.now?.() ?? new Date();

      const embeddingService =
        options.embeddingService ?? createEmbeddingService();

      let queryEmbedding: number[] | null = null;
      try {
        queryEmbedding = await embeddingService.embedQuery(input.query);
      } catch {
        // Embedding failed — fall through to BM25-only
      }

      if (queryEmbedding) {
        return runHybridSearch(pool, auth, input, {
          queryEmbedding,
          threshold,
          recencyWeight,
          limit,
          now
        });
      }

      return runBm25OnlySearch(pool, auth, input, {
        threshold,
        recencyWeight,
        limit,
        now
      });
    })(),
    (error) => toAppError(error, 'Failed to search entities')
  );
}
```

Add the two helper functions:

```typescript
type SearchContext = {
  threshold: number;
  recencyWeight: number;
  limit: number;
  now: Date;
};

async function runHybridSearch(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  ctx: SearchContext & { queryEmbedding: number[] }
): Promise<{ results: SearchResult[] }> {
  const tsQuery = input.query;

  const rows = await pool.query<SearchRow & { bm25: number }>(
    `
      SELECT
        e.*,
        c.content AS chunk_content,
        1 - (c.embedding <=> $1::vector) AS similarity,
        ts_rank(e.search_tsvector, plainto_tsquery('simple', $6)) AS bm25
      FROM chunks c
      JOIN entities e ON e.id = c.entity_id
      WHERE e.status IS DISTINCT FROM 'archived'
        AND ($2::text IS NULL OR e.type = $2)
        AND ($3::text[] IS NULL OR e.tags @> $3)
        AND ($4::text[] IS NULL OR e.type = ANY($4))
        AND e.visibility = ANY($5)
    `,
    [
      vectorToSql(ctx.queryEmbedding),
      input.type ?? null,
      input.tags?.length ? input.tags : null,
      auth.allowedTypes,
      auth.allowedVisibility,
      tsQuery
    ]
  );

  const withNormalizedBm25 = normalizeBm25Scores(
    rows.rows.map((row) => ({
      row,
      bm25: Number(row.bm25)
    }))
  );

  const scored = withNormalizedBm25
    .map(({ row, bm25 }) => {
      const entity = mapEntity(row);
      const similarity = Number(row.similarity);
      const blended = blendScores(similarity, bm25);
      const ageDays =
        (ctx.now.getTime() - row.created_at.getTime()) / (1000 * 60 * 60 * 24);
      const score = applyRecencyBoost({
        similarity: blended,
        ageDays,
        recencyWeight: ctx.recencyWeight,
        halfLifeDays: 30
      });

      return {
        entity,
        entityId: entity.id,
        chunkContent: row.chunk_content,
        similarity,
        score
      };
    })
    .filter((result) => result.score >= ctx.threshold);

  return {
    results: deduplicateResults(scored).slice(0, ctx.limit)
  };
}

async function runBm25OnlySearch(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  ctx: SearchContext
): Promise<{ results: SearchResult[] }> {
  const rows = await pool.query<EntityRow & { bm25: number }>(
    `
      SELECT
        e.*,
        ts_rank(e.search_tsvector, plainto_tsquery('simple', $1)) AS bm25
      FROM entities e
      WHERE e.status IS DISTINCT FROM 'archived'
        AND e.content IS NOT NULL
        AND e.search_tsvector @@ plainto_tsquery('simple', $1)
        AND ($2::text IS NULL OR e.type = $2)
        AND ($3::text[] IS NULL OR e.tags @> $3)
        AND ($4::text[] IS NULL OR e.type = ANY($4))
        AND e.visibility = ANY($5)
      ORDER BY bm25 DESC
      LIMIT $6
    `,
    [
      input.query,
      input.type ?? null,
      input.tags?.length ? input.tags : null,
      auth.allowedTypes,
      auth.allowedVisibility,
      ctx.limit
    ]
  );

  const withNormalized = normalizeBm25Scores(
    rows.rows.map((row) => ({
      row,
      bm25: Number(row.bm25)
    }))
  );

  const scored = withNormalized.map(({ row, bm25 }) => {
    const entity = mapEntity(row);
    const ageDays =
      (ctx.now.getTime() - row.created_at.getTime()) / (1000 * 60 * 60 * 24);
    const score = applyRecencyBoost({
      similarity: bm25,
      ageDays,
      recencyWeight: ctx.recencyWeight,
      halfLifeDays: 30
    });

    return {
      entity,
      entityId: entity.id,
      chunkContent: row.content ?? '',
      similarity: 0,
      score
    };
  });

  return {
    results: scored
  };
}
```

Remove the `SearchRow` type alias (replaced by inline usage) and make `EntityRow` exported or keep it as-is since it's used in both paths. The existing `EntityRow` type in this file already has the right shape — just add `bm25` as needed inline in the query result types.

- [ ] **Step 4: Run all tests**

Run: `npm test -- --run tests/unit/search-scoring.test.ts tests/integration/search-service.test.ts`
Expected: PASS — all existing + new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/search-service.ts tests/integration/search-service.test.ts
git commit -m "feat: hybrid BM25+vector search with graceful fallback"
```

---

## Task 4: BM25-Only Fallback Test

**Files:**
- Modify: `tests/integration/search-service.test.ts`

- [ ] **Step 1: Write integration test for BM25-only fallback**

Add to `tests/integration/search-service.test.ts`:

```typescript
it('falls back to BM25-only search when embedding fails', async () => {
  if (!database) {
    throw new Error('test database not initialized');
  }

  const goodEmbeddingService = createEmbeddingService();

  await storeEntity(database.pool, makeAuthContext(), {
    type: 'memory',
    content: 'kubernetes deployment strategies for production',
    tags: ['infra']
  });

  const worker = createEnrichmentWorker({
    pool: database.pool,
    embeddingService: goodEmbeddingService
  });
  await worker.runOnce();

  // Search with a broken embedding service
  const failingEmbeddingService = createEmbeddingService({
    embedQuery: () => Promise.reject(new Error('OpenAI is down')),
    embedBatch: () => Promise.reject(new Error('OpenAI is down'))
  });

  const result = await searchEntities(
    database.pool,
    makeAuthContext(),
    { query: 'kubernetes', threshold: 0 },
    { embeddingService: failingEmbeddingService }
  );

  expect(result.isOk()).toBe(true);
  const results = result._unsafeUnwrap().results;
  expect(results.length).toBeGreaterThan(0);
  expect(results[0]?.entity.content).toContain('kubernetes');
  expect(results[0]?.similarity).toBe(0);
}, 120_000);
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- --run tests/integration/search-service.test.ts`
Expected: PASS — the fallback path from Task 3 handles this.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/search-service.test.ts
git commit -m "test: BM25-only fallback when embedding service fails"
```

---

## Task 5: Enrichment Retry with Backoff

**Files:**
- Modify: `src/services/enrichment-worker.ts`
- Modify: `src/services/entity-service.ts`
- Modify: `tests/integration/enrichment-worker.test.ts`

- [ ] **Step 1: Write failing test for retry behavior**

Add to `tests/integration/enrichment-worker.test.ts`:

```typescript
it('retries failed entities and stops after max attempts', async () => {
  if (!database) {
    throw new Error('test database not initialized');
  }

  const stored = (await storeEntity(database.pool, makeAuthContext(), {
    type: 'memory',
    content: 'this entity will keep failing'
  }))._unsafeUnwrap();

  const failingWorker = createEnrichmentWorker({
    pool: database.pool,
    embeddingService: createEmbeddingService({
      embedBatch: () =>
        Promise.reject(
          new AppError(ErrorCode.EMBEDDING_FAILED, 'always fails')
        )
    })
  });

  // First failure
  await failingWorker.runOnce();
  let row = await database.pool.query<{ enrichment_status: string; enrichment_attempts: number }>(
    'SELECT enrichment_status, enrichment_attempts FROM entities WHERE id = $1',
    [stored.id]
  );
  expect(row.rows[0]?.enrichment_status).toBe('failed');
  expect(row.rows[0]?.enrichment_attempts).toBe(1);

  // Simulate 5-minute backoff by updating updated_at
  await database.pool.query(
    "UPDATE entities SET updated_at = now() - interval '10 minutes' WHERE id = $1",
    [stored.id]
  );

  // Second failure
  await failingWorker.runOnce();
  row = await database.pool.query(
    'SELECT enrichment_status, enrichment_attempts FROM entities WHERE id = $1',
    [stored.id]
  );
  expect(row.rows[0]?.enrichment_attempts).toBe(2);

  // Simulate backoff again
  await database.pool.query(
    "UPDATE entities SET updated_at = now() - interval '10 minutes' WHERE id = $1",
    [stored.id]
  );

  // Third failure — should be final
  await failingWorker.runOnce();
  row = await database.pool.query(
    'SELECT enrichment_status, enrichment_attempts FROM entities WHERE id = $1',
    [stored.id]
  );
  expect(row.rows[0]?.enrichment_attempts).toBe(3);

  // Simulate backoff again
  await database.pool.query(
    "UPDATE entities SET updated_at = now() - interval '10 minutes' WHERE id = $1",
    [stored.id]
  );

  // Fourth run — should NOT pick up the entity (max 3 attempts reached)
  const processed = await failingWorker.runOnce();
  expect(processed).toBe(0);
}, 120_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/integration/enrichment-worker.test.ts`
Expected: FAIL — the worker doesn't query for `'failed'` entities and doesn't track `enrichment_attempts`.

- [ ] **Step 3: Update the enrichment worker**

In `src/services/enrichment-worker.ts`, change the pending query (line 25-31) to:

```typescript
const pending = await options.pool.query<PendingEntityRow>(
  `
    SELECT id, content
    FROM entities
    WHERE content IS NOT NULL
      AND (
        enrichment_status = 'pending'
        OR (
          enrichment_status = 'failed'
          AND enrichment_attempts < 3
          AND updated_at < now() - interval '5 minutes'
        )
      )
    ORDER BY
      CASE WHEN enrichment_status = 'pending' THEN 0 ELSE 1 END,
      created_at ASC
  `
);
```

Change the success path (line 85-90) to also reset `enrichment_attempts`:

```typescript
await client.query(
  `
    UPDATE entities
    SET enrichment_status = 'completed',
        enrichment_attempts = 0
    WHERE id = $1
  `,
  [entity.id]
);
```

Change the failure handler (line 100-107) to increment `enrichment_attempts`:

```typescript
} catch {
  await options.pool.query(
    `
      UPDATE entities
      SET enrichment_status = 'failed',
          enrichment_attempts = enrichment_attempts + 1
      WHERE id = $1
    `,
    [entity.id]
  );
}
```

- [ ] **Step 4: Update `entity-service.ts` to reset attempts on content change**

In `src/services/entity-service.ts`, in the `updateEntity` function, the UPDATE query (line 238-266) sets `enrichment_status` based on content change. Add `enrichment_attempts` reset. Change the query parameters:

Replace the `enrichment_status` parameter computation (line 258-260):

```typescript
hasContent(nextContent)
  ? contentChanged
    ? 'pending'
    : existing.enrichmentStatus
  : null,
```

And add `enrichment_attempts` reset to the SQL and parameters. Update the UPDATE query to:

```sql
UPDATE entities
SET
  content = $2,
  visibility = $3,
  status = $4,
  enrichment_status = $5,
  tags = $6,
  metadata = $7,
  version = version + 1,
  enrichment_attempts = CASE WHEN $9 THEN 0 ELSE enrichment_attempts END
WHERE id = $1
  AND version = $8
RETURNING *
```

And add `contentChanged` as boolean parameter at position 9:

```typescript
[
  input.id,
  nextContent ?? null,
  nextVisibility,
  input.status === undefined ? existing.status : input.status,
  hasContent(nextContent)
    ? contentChanged
      ? 'pending'
      : existing.enrichmentStatus
    : null,
  input.tags ?? existing.tags,
  nextMetadata,
  input.version,
  contentChanged
]
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --run tests/integration/enrichment-worker.test.ts`
Expected: PASS — all 3 tests pass (2 existing + 1 new).

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS — all tests pass. The entity-service integration tests still work with the updated UPDATE query.

- [ ] **Step 7: Commit**

```bash
git add src/services/enrichment-worker.ts src/services/entity-service.ts tests/integration/enrichment-worker.test.ts
git commit -m "feat: enrichment worker retries failed entities with backoff"
```

---

## Task 6: `pgm list` CLI Command

**Files:**
- Modify: `src/cli/client.ts`
- Modify: `src/cli/pgm.ts`
- Modify: `tests/integration/cli-pgm.test.ts`

- [ ] **Step 1: Write failing integration test**

Add a new test to `tests/integration/cli-pgm.test.ts` inside the `pgm CLI` describe block:

```typescript
it('lists entities filtered by type', async () => {
  if (!database) {
    throw new Error('test database not initialized');
  }

  const createdKey = (await createKey(database.pool, {
    name: `list-${crypto.randomUUID()}`,
    scopes: ['read', 'write'],
    allowedVisibility: ['shared']
  }))._unsafeUnwrap();

  const env = {
    PGM_API_URL: baseUrl,
    PGM_API_KEY: createdKey.plaintextKey
  };

  await runPgm(
    ['store', 'first memory', '--type', 'memory', '--json'],
    env
  );
  await runPgm(
    ['store', 'a project', '--type', 'project', '--json'],
    env
  );

  const listAll = await runPgm(['list', '--json'], env);
  const allBody = parseJson(listAll.stdout) as {
    items: Array<{ type: string }>;
    total: number;
  };
  expect(allBody.total).toBe(2);

  const listMemories = await runPgm(
    ['list', '--type', 'memory', '--json'],
    env
  );
  const memBody = parseJson(listMemories.stdout) as {
    items: Array<{ type: string }>;
    total: number;
  };
  expect(memBody.total).toBe(1);
  expect(memBody.items[0]?.type).toBe('memory');
}, 120_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/integration/cli-pgm.test.ts`
Expected: FAIL — `pgm list` command does not exist.

- [ ] **Step 3: Add `listEntities` to the client**

Add to `src/cli/client.ts` inside the `createPgmClient` return object, after the `deleteEntity` method:

```typescript
listEntities(input: {
  type?: string | undefined;
  status?: string | undefined;
  visibility?: string | undefined;
  tags?: string[] | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
} = {}) {
  const params = new URLSearchParams();
  if (input.type) {
    params.set('type', input.type);
  }
  if (input.status) {
    params.set('status', input.status);
  }
  if (input.visibility) {
    params.set('visibility', input.visibility);
  }
  if (input.tags?.length) {
    params.set('tags', input.tags.join(','));
  }
  if (input.limit !== undefined) {
    params.set('limit', String(input.limit));
  }
  if (input.offset !== undefined) {
    params.set('offset', String(input.offset));
  }

  const query = params.toString();
  return request<{
    items: StoredEntityResponse['entity'][];
    total: number;
    limit: number;
    offset: number;
  }>(options, `/api/entities${query ? `?${query}` : ''}`);
},
```

- [ ] **Step 4: Add `list` command to `pgm.ts`**

Add to `src/cli/pgm.ts` after the `recall` command block (after line 332):

```typescript
program
  .command('list')
  .description('List entities')
  .option('--type <type>', 'filter by type')
  .option('--status <status>', 'filter by status')
  .option('--visibility <visibility>', 'filter by visibility')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--limit <limit>', 'result limit', '50')
  .option('--offset <offset>', 'result offset', '0')
  .action(async (options, command) => {
    await runWithClient(command, async (client, json) => {
      const body = await client.listEntities({
        type: options.type,
        status: options.status,
        visibility: options.visibility,
        tags: parseCommaList(options.tags),
        limit: Number(options.limit),
        offset: Number(options.offset)
      });

      if (json) {
        return body;
      }

      if (body.items.length === 0) {
        return ['No entities'];
      }

      const lines = body.items.flatMap((item) => {
        const preview = item.content
          ? item.content.length > 60
            ? `${item.content.slice(0, 60)}...`
            : item.content
          : '-';
        return [
          `${item.type} ${shortId(item.id)}  ${preview}`,
          `  tags: ${item.tags.join(', ') || '-'} | ${item.visibility} | ${item.created_at.slice(0, 10)}`
        ];
      });

      lines.push('');
      lines.push(
        `${body.total} entities (showing ${body.offset + 1}-${body.offset + body.items.length})`
      );

      return lines;
    });
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run tests/integration/cli-pgm.test.ts`
Expected: PASS — all 3 tests pass (2 existing + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src/cli/client.ts src/cli/pgm.ts tests/integration/cli-pgm.test.ts
git commit -m "feat: add pgm list command for listing entities"
```

---

## Task 7: `pgm-admin reembed` Command

**Files:**
- Modify: `src/cli/admin/pgm-admin.ts`
- Modify: `tests/integration/cli-admin.test.ts`

- [ ] **Step 1: Write failing integration test**

Add a new test to `tests/integration/cli-admin.test.ts` inside the `pgm-admin CLI` describe block:

```typescript
it('re-embeds entities by clearing chunks and marking them pending', async () => {
  if (!database) {
    throw new Error('test database not initialized');
  }

  const databaseUrl = getDatabaseUrl(database);

  // Store an entity and enrich it
  const stored = (await storeEntity(database.pool, makeAuthContext(), {
    type: 'memory',
    content: 'memory that needs re-embedding'
  }))._unsafeUnwrap();

  const { createEnrichmentWorker } = await import(
    '../../src/services/enrichment-worker.js'
  );
  const { createEmbeddingService } = await import(
    '../../src/services/embedding-service.js'
  );
  const worker = createEnrichmentWorker({
    pool: database.pool,
    embeddingService: createEmbeddingService()
  });
  await worker.runOnce();

  // Verify entity is enriched with chunks
  const chunksBefore = await database.pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM chunks WHERE entity_id = $1',
    [stored.id]
  );
  expect(Number(chunksBefore.rows[0]?.count ?? '0')).toBeGreaterThan(0);

  // Run reembed --all
  const reembedResult = await runAdmin(
    ['reembed', '--all', '--json'],
    { DATABASE_URL: databaseUrl }
  );
  const reembedBody = parseJson(reembedResult.stdout) as {
    markedCount: number;
  };
  expect(reembedBody.markedCount).toBeGreaterThanOrEqual(1);

  // Verify chunks were deleted and entity is pending
  const chunksAfter = await database.pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM chunks WHERE entity_id = $1',
    [stored.id]
  );
  expect(Number(chunksAfter.rows[0]?.count ?? '0')).toBe(0);

  const entityRow = await database.pool.query<{
    enrichment_status: string;
    enrichment_attempts: number;
  }>(
    'SELECT enrichment_status, enrichment_attempts FROM entities WHERE id = $1',
    [stored.id]
  );
  expect(entityRow.rows[0]?.enrichment_status).toBe('pending');
  expect(entityRow.rows[0]?.enrichment_attempts).toBe(0);

  // Verify audit entry
  const auditRows = await database.pool.query<{ operation: string }>(
    "SELECT operation FROM audit_log WHERE operation = 'reembed.start' ORDER BY timestamp DESC LIMIT 1"
  );
  expect(auditRows.rows[0]?.operation).toBe('reembed.start');
}, 120_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/integration/cli-admin.test.ts`
Expected: FAIL — `reembed` command does not exist.

- [ ] **Step 3: Add the `reembed` command to `pgm-admin.ts`**

Add to `src/cli/admin/pgm-admin.ts` before the `stats` command (before line 436):

```typescript
program
  .command('reembed')
  .description('Mark entities for re-embedding')
  .option('--model <id>', 'switch active model before re-embedding')
  .option('--all', 're-embed all entities with content')
  .option('--type <type>', 're-embed entities of this type only')
  .action(async (options, command) => {
    const json = isJsonMode(command);

    if (!options.all && !options.type) {
      await handleCliFailure(
        new Error('Specify --all or --type <type> to confirm which entities to re-embed'),
        json
      );
      return;
    }

    await runWithPool(json, async (pool) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Optionally switch active model
        if (options.model) {
          await client.query('UPDATE embedding_models SET is_active = false');
          const modelResult = await client.query<{ id: string }>(
            'UPDATE embedding_models SET is_active = true WHERE id = $1 RETURNING id',
            [options.model]
          );
          if (!modelResult.rows[0]) {
            throw new Error('Model not found');
          }
        }

        // Build WHERE clause for target entities
        const conditions = ["content IS NOT NULL"];
        const params: unknown[] = [];

        if (options.type) {
          params.push(options.type);
          conditions.push(`type = $${params.length}`);
        }

        const whereClause = conditions.join(' AND ');

        // Delete stale chunks
        await client.query(
          `DELETE FROM chunks WHERE entity_id IN (SELECT id FROM entities WHERE ${whereClause})`,
          params
        );

        // Mark entities for re-processing
        const updateResult = await client.query(
          `UPDATE entities SET enrichment_status = 'pending', enrichment_attempts = 0 WHERE ${whereClause}`,
          params
        );

        await client.query('COMMIT');

        const markedCount = updateResult.rowCount ?? 0;

        await appendAuditEntry(pool, {
          operation: 'reembed.start',
          details: {
            markedCount,
            model: options.model ?? null,
            type: options.type ?? 'all'
          }
        });

        return json
          ? { markedCount }
          : [`Marked ${markedCount} entities for re-embedding`];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/integration/cli-admin.test.ts`
Expected: PASS — all 3 tests pass (2 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/cli/admin/pgm-admin.ts tests/integration/cli-admin.test.ts
git commit -m "feat: add pgm-admin reembed command"
```

---

## Task 8: Startup OpenAI Validation

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add validation call to `startServer()`**

In `src/index.ts`, add after line 140 (`const embeddingService = createEmbeddingService();`):

```typescript
try {
  await embeddingService.embedQuery('startup validation');
  logger.info('embedding service validated');
} catch (error) {
  logger.warn(
    { err: error },
    'embedding service unavailable — search and enrichment will fail'
  );
}
```

- [ ] **Step 2: Run full test suite to verify nothing breaks**

Run: `npm test`
Expected: PASS — all tests pass. The `createApp` function used in tests doesn't call `startServer()`, so the validation only runs in production startup.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: validate embedding service on startup"
```

---

## Task 9: Update Test Helper for New Column

**Files:**
- Modify: `tests/helpers/postgres.ts`

- [ ] **Step 1: Check if `resetTestDatabase` needs updating**

The `TRUNCATE` in `resetTestDatabase` already handles both new columns:
- `search_tsvector` is a generated column — automatically maintained, no reset needed.
- `enrichment_attempts` defaults to 0 — the TRUNCATE clears it.

No changes needed. The existing `resetTestDatabase` works as-is.

- [ ] **Step 2: Verify with full test suite**

Run: `npm test`
Expected: PASS — all tests pass.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS — no lint errors.

---

## Task 10: Final Verification

- [ ] **Step 1: Run full test suite with coverage**

Run: `npm run test:coverage`
Expected: PASS — all tests pass, coverage >= 80%.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Clean compilation with no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 4: Commit any remaining changes**

If any files were missed, stage and commit them.
