import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { recallEntity, storeEntity } from '../../src/services/entity-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import { AppError, ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000103',
    keyName: 'worker-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

describe('enrichment-worker', () => {
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
      id: '00000000-0000-0000-0000-000000000103',
      name: 'worker-key'
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('processes pending entities into chunks and marks them completed', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'pgvector lets postgres do vector search without a separate service'
    }))._unsafeUnwrap();

    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService: createEmbeddingService()
    });

    const processed = await worker.runOnce();
    expect(processed).toBe(1);

    const recalled = await recallEntity(
      database.pool,
      makeAuthContext(),
      stored.id
    );
    expect(recalled.isOk()).toBe(true);
    expect(recalled._unsafeUnwrap().enrichmentStatus).toBe('completed');

    const chunkRows = await database.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM chunks WHERE entity_id = $1',
      [stored.id]
    );
    expect(Number(chunkRows.rows[0]?.count ?? '0')).toBeGreaterThan(0);
  }, 120_000);

  it('marks entities failed when embedding generation fails', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'this enrichment should fail'
    }))._unsafeUnwrap();

    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService: createEmbeddingService({
        embedBatch: () =>
          Promise.reject(
            new AppError(
            ErrorCode.EMBEDDING_FAILED,
            'forced embedding failure'
            )
          )
      })
    });

    const processed = await worker.runOnce();
    expect(processed).toBe(1);

    const recalled = await recallEntity(
      database.pool,
      makeAuthContext(),
      stored.id
    );
    expect(recalled.isOk()).toBe(true);
    expect(recalled._unsafeUnwrap().enrichmentStatus).toBe('failed');
  }, 120_000);

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

    // Simulate 5-minute backoff by updating updated_at (disable trigger to bypass auto-update)
    await database.pool.query('ALTER TABLE entities DISABLE TRIGGER trg_entities_updated_at');
    await database.pool.query(
      "UPDATE entities SET updated_at = now() - interval '10 minutes' WHERE id = $1",
      [stored.id]
    );
    await database.pool.query('ALTER TABLE entities ENABLE TRIGGER trg_entities_updated_at');

    // Second failure
    await failingWorker.runOnce();
    row = await database.pool.query(
      'SELECT enrichment_status, enrichment_attempts FROM entities WHERE id = $1',
      [stored.id]
    );
    expect(row.rows[0]?.enrichment_attempts).toBe(2);

    // Simulate backoff again
    await database.pool.query('ALTER TABLE entities DISABLE TRIGGER trg_entities_updated_at');
    await database.pool.query(
      "UPDATE entities SET updated_at = now() - interval '10 minutes' WHERE id = $1",
      [stored.id]
    );
    await database.pool.query('ALTER TABLE entities ENABLE TRIGGER trg_entities_updated_at');

    // Third failure — should be final
    await failingWorker.runOnce();
    row = await database.pool.query(
      'SELECT enrichment_status, enrichment_attempts FROM entities WHERE id = $1',
      [stored.id]
    );
    expect(row.rows[0]?.enrichment_attempts).toBe(3);

    // Simulate backoff again
    await database.pool.query('ALTER TABLE entities DISABLE TRIGGER trg_entities_updated_at');
    await database.pool.query(
      "UPDATE entities SET updated_at = now() - interval '10 minutes' WHERE id = $1",
      [stored.id]
    );
    await database.pool.query('ALTER TABLE entities ENABLE TRIGGER trg_entities_updated_at');

    // Fourth run — should NOT pick up the entity (max 3 attempts reached)
    const processed = await failingWorker.runOnce();
    expect(processed).toBe(0);
  }, 120_000);

  it('does not queue auto-created entities for extraction', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    // Stub auto-created entity, as if produced by extraction-service.
    const inserted = await database.pool.query<{ id: string }>(
      `INSERT INTO entities (type, content, visibility, enrichment_status, tags, metadata)
       VALUES ('person', 'Alice', 'shared', 'pending', ARRAY['auto-created'], '{}'::jsonb)
       RETURNING id`
    );
    const autoId = inserted.rows[0]!.id;

    // And a regular entity, to confirm the normal path still queues extraction.
    const normal = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'normal entity that should get extracted'
    }))._unsafeUnwrap();

    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService: createEmbeddingService(),
      extractionEnabled: true,
      callLlm: () => Promise.resolve('[]')
    });

    await worker.runOnce();
    await worker.runOnce();

    const rows = await database.pool.query<{
      id: string;
      enrichment_status: string;
      extraction_status: string | null;
    }>(
      'SELECT id, enrichment_status, extraction_status FROM entities WHERE id = ANY($1)',
      [[autoId, normal.id]]
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));

    // Auto-created: embedded, but NOT pushed into the extraction queue —
    // extraction_status must stay NULL so the loop terminates.
    expect(byId[autoId]?.enrichment_status).toBe('completed');
    expect(byId[autoId]?.extraction_status).toBeNull();

    // Normal entity: embedded AND processed by extraction (LLM returned [],
    // so it transitions pending → completed in the same pass).
    expect(byId[normal.id]?.enrichment_status).toBe('completed');
    expect(byId[normal.id]?.extraction_status).toBe('completed');
  }, 120_000);

  it('does not process the same entity twice when workers run concurrently', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'only one worker should process this'
    });

    const delayedEmbeddingService = createEmbeddingService({
      embedBatch: async (texts) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return texts.map(() => new Array<number>(1536).fill(0));
      }
    });

    const workerA = createEnrichmentWorker({
      pool: database.pool,
      embeddingService: delayedEmbeddingService
    });
    const workerB = createEnrichmentWorker({
      pool: database.pool,
      embeddingService: delayedEmbeddingService
    });

    const processed = await Promise.all([
      workerA.runOnce(),
      workerB.runOnce()
    ]);

    expect(processed.sort((left, right) => left - right)).toEqual([0, 1]);
  }, 120_000);
});
