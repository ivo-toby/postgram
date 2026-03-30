import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { createApp } from '../../src/index.js';
import { createKey } from '../../src/auth/key-service.js';
import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import { AppError, ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

describe('REST entity endpoints', () => {
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

  async function createAuthorizedApp(options: {
    embeddingService?: ReturnType<typeof createEmbeddingService>;
  } = {}) {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const created = (await createKey(database.pool, {
      name: `rest-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete'],
      allowedVisibility: ['shared', 'work']
    }))._unsafeUnwrap();

    return {
      app: createApp({
        pool: database.pool,
        embeddingService: options.embeddingService
      }),
      apiKey: created.plaintextKey
    };
  }

  it('stores, recalls, and lists entities', async () => {
    const { app, apiKey } = await createAuthorizedApp();

    const storeResponse = await app.request('/api/entities', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'memory',
        content: 'use pgvector',
        visibility: 'shared',
        tags: ['architecture']
      })
    });
    const storedBody: unknown = await storeResponse.json();

    expect(storeResponse.status).toBe(201);
    expect(storedBody).toMatchObject({
      entity: {
        type: 'memory',
        content: 'use pgvector',
        visibility: 'shared',
        enrichment_status: 'pending',
        version: 1,
        tags: ['architecture']
      }
    });

    if (!storedBody || typeof storedBody !== 'object') {
      throw new Error('expected JSON object');
    }

    const entityId = (storedBody as {
      entity: { id: string };
    }).entity.id;

    const recallResponse = await app.request(`/api/entities/${entityId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    const recallBody: unknown = await recallResponse.json();

    expect(recallResponse.status).toBe(200);
    expect(recallBody).toMatchObject({
      entity: {
        id: entityId,
        type: 'memory'
      }
    });

    const listResponse = await app.request('/api/entities?type=memory&limit=10', {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    const listBody: unknown = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody).toMatchObject({
      total: 1,
      limit: 10,
      offset: 0
    });
  }, 120_000);

  it('returns conflicts for stale updates and supports soft delete', async () => {
    const { app, apiKey } = await createAuthorizedApp();

    const storeResponse = await app.request('/api/entities', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'memory',
        content: 'initial content'
      })
    });
    const storedBody = (await storeResponse.json()) as {
      entity: { id: string; version: number };
    };

    const updateResponse = await app.request(
      `/api/entities/${storedBody.entity.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          version: storedBody.entity.version,
          content: 'updated content'
        })
      }
    );
    expect(updateResponse.status).toBe(200);

    const staleResponse = await app.request(
      `/api/entities/${storedBody.entity.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          version: storedBody.entity.version,
          content: 'stale content'
        })
      }
    );
    const staleBody: unknown = await staleResponse.json();

    expect(staleResponse.status).toBe(409);
    expect(staleBody).toMatchObject({
      error: {
        code: 'CONFLICT'
      }
    });

    const deleteResponse = await app.request(
      `/api/entities/${storedBody.entity.id}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );
    const deleteBody: unknown = await deleteResponse.json();

    expect(deleteResponse.status).toBe(200);
    expect(deleteBody).toEqual({
      id: storedBody.entity.id,
      deleted: true
    });
  }, 120_000);

  it('searches enriched entities and validates empty queries', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();
    const { app, apiKey } = await createAuthorizedApp({ embeddingService });

    const storeResponse = await app.request('/api/entities', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'memory',
        content: 'postgres vector search for work notes',
        tags: ['search']
      })
    });
    const storedBody = (await storeResponse.json()) as {
      entity: { id: string };
    };

    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    });
    await worker.runOnce();

    const searchResponse = await app.request('/api/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: 'postgres search',
        tags: ['search']
      })
    });
    const searchBody: unknown = await searchResponse.json();

    expect(searchResponse.status).toBe(200);
    if (!searchBody || typeof searchBody !== 'object') {
      throw new Error('expected JSON object');
    }

    const firstResult = (searchBody as {
      results: Array<{
        entity: { id: string };
        chunk_content: string;
      }>;
    }).results[0];
    expect(firstResult?.entity.id).toBe(storedBody.entity.id);
    expect(firstResult?.chunk_content).toContain('postgres');

    const invalidResponse = await app.request('/api/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: ''
      })
    });
    const invalidBody: unknown = await invalidResponse.json();

    expect(invalidResponse.status).toBe(400);
    expect(invalidBody).toEqual({
      error: {
        code: 'VALIDATION',
        message: 'String must contain at least 1 character(s)',
        details: {}
      }
    });
  }, 120_000);

  it('falls back to BM25 when query embedding fails', async () => {
    const { app, apiKey } = await createAuthorizedApp({
      embeddingService: createEmbeddingService({
        embedQuery: () =>
          Promise.reject(
            new AppError(
              ErrorCode.EMBEDDING_FAILED,
              'forced query embedding failure'
            )
          )
      })
    });

    const response = await app.request('/api/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: 'postgres search'
      })
    });
    const body = (await response.json()) as { results: unknown[] };

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
  }, 120_000);

  it('creates, lists, updates, and completes tasks', async () => {
    const { app, apiKey } = await createAuthorizedApp();

    const createResponse = await app.request('/api/tasks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'write MCP transport',
        context: '@dev',
        due_date: '2026-03-25'
      })
    });
    const createBody = (await createResponse.json()) as {
      entity: { id: string; version: number };
    };

    expect(createResponse.status).toBe(201);
    expect(createBody).toMatchObject({
      entity: {
        type: 'task',
        status: 'inbox',
        metadata: {
          context: '@dev',
          due_date: '2026-03-25'
        }
      }
    });

    const listResponse = await app.request('/api/tasks?status=inbox&context=@dev', {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    const listBody: unknown = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listBody).toMatchObject({
      total: 1,
      items: [
        {
          id: createBody.entity.id
        }
      ]
    });

    const updateResponse = await app.request(`/api/tasks/${createBody.entity.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: createBody.entity.version,
        status: 'next',
        context: '@deep-work'
      })
    });
    const updateBody = (await updateResponse.json()) as {
      entity: { version: number };
    };

    expect(updateResponse.status).toBe(200);
    expect(updateBody).toMatchObject({
      entity: {
        status: 'next',
        metadata: {
          context: '@deep-work'
        }
      }
    });

    const completeResponse = await app.request(
      `/api/tasks/${createBody.entity.id}/complete`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          version: updateBody.entity.version
        })
      }
    );
    const completeBody: unknown = await completeResponse.json();

    expect(completeResponse.status).toBe(200);
    if (!completeBody || typeof completeBody !== 'object') {
      throw new Error('expected JSON object');
    }

    const completedEntity = (completeBody as {
      entity: {
        status: string;
        metadata: { completed_at: string };
      };
    }).entity;
    expect(completedEntity.status).toBe('done');
    expect(typeof completedEntity.metadata.completed_at).toBe('string');
  }, 120_000);
});
