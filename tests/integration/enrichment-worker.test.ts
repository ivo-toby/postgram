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
});
