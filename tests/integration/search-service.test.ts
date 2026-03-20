import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import { searchEntities } from '../../src/services/search-service.js';
import { storeEntity } from '../../src/services/entity-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: 'search-key',
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
});
