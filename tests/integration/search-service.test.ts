import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import { searchEntities } from '../../src/services/search-service.js';
import { storeEntity } from '../../src/services/entity-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000104',
    keyName: 'search-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

describe('search-service', () => {
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
      id: '00000000-0000-0000-0000-000000000104',
      name: 'search-key'
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('returns no vector results before enrichment completes', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'postgres vector search for work notes',
      tags: ['search']
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: 'vector search notes'
      },
      {
        embeddingService: createEmbeddingService()
      }
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().results).toHaveLength(0);
  }, 120_000);

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
    expect(results[0]?.entity.content).toContain('pgvector');
  }, 120_000);

  it('returns enriched entities ranked by similarity with filters', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'postgres vector search for work notes',
      tags: ['search', 'postgres']
    });
    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'gardening checklist for spring herbs',
      tags: ['garden']
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
      {
        query: 'postgres search',
        tags: ['search']
      },
      {
        embeddingService
      }
    );

    expect(result.isOk()).toBe(true);
    const [firstResult] = result._unsafeUnwrap().results;
    expect(firstResult).toBeDefined();
    expect(firstResult?.entity.type).toBe('memory');
    expect(firstResult?.chunkContent).toContain('postgres');
    expect(typeof firstResult?.similarity).toBe('number');
    expect(typeof firstResult?.score).toBe('number');
    expect(result._unsafeUnwrap().results).toHaveLength(1);
  }, 120_000);

  it('respects explicit visibility filters', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'postgres notes shared with everyone',
      tags: ['search'],
      visibility: 'shared'
    });
    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'postgres notes only for work',
      tags: ['search'],
      visibility: 'work'
    });

    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    });
    await worker.runOnce();

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: 'postgres notes',
        visibility: 'work' as never,
        threshold: 0
      },
      { embeddingService }
    );

    expect(result.isOk()).toBe(true);
    const results = result._unsafeUnwrap().results;
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((entry) => entry.entity.visibility === 'work')).toBe(true);
  }, 120_000);

  it('returns EMBEDDING_FAILED when query embedding fails', async () => {
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

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('EMBEDDING_FAILED');
  }, 120_000);
});
