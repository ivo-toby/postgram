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

  it('supports owner-scoped create, list, search, and graph queries', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();
    const { app, apiKey } = await createAuthorizedApp({ embeddingService });

    const createEntity = async (body: Record<string, unknown>) => {
      const response = await app.request('/api/entities', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      expect(response.status).toBe(201);
      return (await response.json()) as {
        entity: { id: string; owner: string | null };
      };
    };

    const shared = await createEntity({
      type: 'memory',
      content: 'shared planning notes for all personas'
    });
    const productManager = await createEntity({
      type: 'memory',
      content: 'product manager planning notes',
      owner: 'product-manager'
    });
    const developer = await createEntity({
      type: 'memory',
      content: 'developer planning notes',
      owner: 'developer'
    });

    expect(productManager.entity.owner).toBe('product-manager');

    const edgeResponseA = await app.request('/api/edges', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source_id: productManager.entity.id,
        target_id: shared.entity.id,
        relation: 'references'
      })
    });
    expect(edgeResponseA.status).toBe(201);

    const edgeResponseB = await app.request('/api/edges', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source_id: productManager.entity.id,
        target_id: developer.entity.id,
        relation: 'references'
      })
    });
    expect(edgeResponseB.status).toBe(201);

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const listResponse = await app.request('/api/entities?owner=product-manager&limit=10', {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    const listBody = (await listResponse.json()) as {
      items: Array<{ id: string }>;
    };

    expect(listResponse.status).toBe(200);
    expect(listBody.items.map((item) => item.id).sort()).toEqual(
      [shared.entity.id, productManager.entity.id].sort()
    );

    const searchResponse = await app.request('/api/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: 'planning notes',
        owner: 'product-manager',
        threshold: 0
      })
    });
    const searchBody = (await searchResponse.json()) as {
      results: Array<{ entity: { id: string } }>;
    };

    expect(searchResponse.status).toBe(200);
    expect(searchBody.results.map((entry) => entry.entity.id).sort()).toEqual(
      [shared.entity.id, productManager.entity.id].sort()
    );

    const graphResponse = await app.request(
      `/api/entities/${productManager.entity.id}/graph?owner=product-manager&depth=1`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );
    const graphBody = (await graphResponse.json()) as {
      entities: Array<{ id: string }>;
      edges: Array<{ id: string }>;
    };

    expect(graphResponse.status).toBe(200);
    expect(graphBody.entities.map((entity) => entity.id).sort()).toEqual(
      [shared.entity.id, productManager.entity.id].sort()
    );
    expect(graphBody.edges).toHaveLength(1);
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

  it('returns EMBEDDING_FAILED when query embedding fails', async () => {
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
    const body: unknown = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: {
        code: ErrorCode.EMBEDDING_FAILED,
        message: 'forced query embedding failure',
        details: {}
      }
    });
  }, 120_000);

  it('supports source, visibility-filtered search, and task metadata over REST', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();
    const { app, apiKey } = await createAuthorizedApp({ embeddingService });

    const sharedStore = await app.request('/api/entities', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'memory',
        content: 'postgres notes for shared visibility',
        visibility: 'shared',
        source: 'rest-shared'
      })
    });
    const sharedBody = (await sharedStore.json()) as {
      entity: { id: string; source: string | null };
    };

    expect(sharedStore.status).toBe(201);
    expect(sharedBody.entity.source).toBe('rest-shared');

    await app.request('/api/entities', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'memory',
        content: 'postgres notes for work visibility',
        visibility: 'work',
        source: 'rest-work'
      })
    });

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const searchResponse = await app.request('/api/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: 'postgres notes',
        visibility: 'work',
        threshold: 0
      })
    });
    const searchBody = (await searchResponse.json()) as {
      results: Array<{ entity: { visibility: string } }>;
    };

    expect(searchResponse.status).toBe(200);
    expect(searchBody.results.length).toBeGreaterThan(0);
    expect(searchBody.results.every((entry) => entry.entity.visibility === 'work')).toBe(true);

    const taskCreateResponse = await app.request('/api/tasks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'write docs',
        context: '@dev',
        metadata: {
          priority: 'high'
        }
      })
    });
    const taskCreateBody = (await taskCreateResponse.json()) as {
      entity: { id: string; version: number; metadata: Record<string, string> };
    };

    expect(taskCreateResponse.status).toBe(201);
    expect(taskCreateBody.entity.metadata).toMatchObject({
      context: '@dev',
      priority: 'high'
    });

    const taskUpdateResponse = await app.request(
      `/api/tasks/${taskCreateBody.entity.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          version: taskCreateBody.entity.version,
          metadata: {
            owner: 'ivo'
          }
        })
      }
    );
    const taskUpdateBody = (await taskUpdateResponse.json()) as {
      entity: { metadata: Record<string, string> };
    };

    expect(taskUpdateResponse.status).toBe(200);
    expect(taskUpdateBody.entity.metadata).toMatchObject({
      context: '@dev',
      priority: 'high',
      owner: 'ivo'
    });
  }, 120_000);

  it('syncs a document repo and returns sync status', async () => {
    const { app, apiKey } = await createAuthorizedApp();

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

  it('syncs via three-phase protocol (diff, upload, finalize)', async () => {
    const { app, apiKey } = await createAuthorizedApp();

    const callJson = async (path: string, body: unknown) =>
      app.request(path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

    // Seed one file with the single-shot endpoint so diff has existing state.
    await callJson('/api/sync', {
      repo: 'tp-contract',
      files: [
        { path: 'keep.md', sha: 'sha-keep', content: '# Keep' },
        { path: 'drop.md', sha: 'sha-drop', content: '# Drop' }
      ]
    });

    const diffRes = await callJson('/api/sync/diff', {
      repo: 'tp-contract',
      files: [
        { path: 'keep.md', sha: 'sha-keep' },
        { path: 'added.md', sha: 'sha-added' }
      ]
    });
    expect(diffRes.status).toBe(200);
    const diff = (await diffRes.json()) as {
      toUpload: Array<{ path: string; sha: string; reason: string }>;
      unchanged: number;
      toDelete: string[];
    };
    expect(diff.unchanged).toBe(1);
    expect(diff.toDelete).toEqual(['drop.md']);
    expect(diff.toUpload).toEqual([
      { path: 'added.md', sha: 'sha-added', reason: 'new' }
    ]);

    const uploadRes = await callJson('/api/sync/upload', {
      repo: 'tp-contract',
      files: [{ path: 'added.md', sha: 'sha-added', content: '# Added' }]
    });
    expect(uploadRes.status).toBe(200);
    expect(await uploadRes.json()).toEqual({ created: 1, updated: 0 });

    const finalizeRes = await callJson('/api/sync/finalize', {
      repo: 'tp-contract',
      files: [
        { path: 'keep.md', sha: 'sha-keep' },
        { path: 'added.md', sha: 'sha-added' }
      ]
    });
    expect(finalizeRes.status).toBe(200);
    expect(await finalizeRes.json()).toEqual({ deleted: 1 });
  }, 120_000);

  it('creates edges and expands graph between entities', async () => {
    const { app, apiKey } = await createAuthorizedApp();

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

    const listRes = await app.request(`/api/entities/${person.id}/edges`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    expect(listRes.status).toBe(200);
    const edges = ((await listRes.json()) as { edges: Array<{ id: string }> }).edges;
    expect(edges).toHaveLength(1);

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

    const deleteRes = await app.request(`/api/edges/${edge.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    expect(deleteRes.status).toBe(200);
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

  it('returns averaged chunk embeddings for the requested entity IDs', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();
    const { app, apiKey } = await createAuthorizedApp({ embeddingService });

    const createEntity = async (body: Record<string, unknown>) => {
      const response = await app.request('/api/entities', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      expect(response.status).toBe(201);
      return (await response.json()) as { entity: { id: string } };
    };

    const a = await createEntity({
      type: 'memory',
      content: 'alpha memory about gardening',
      visibility: 'shared'
    });
    const b = await createEntity({
      type: 'memory',
      content: 'beta memory about cooking',
      visibility: 'shared'
    });
    const pending = await createEntity({
      type: 'memory',
      content: 'pending entity not yet enriched',
      visibility: 'shared'
    });

    // Run enrichment only for a and b by running the worker before creating `pending`?
    // The worker processes all pending entities at once, so we need a different approach.
    // We'll delete chunks for `pending` after enrichment to simulate missing embeddings.
    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    await database.pool.query('DELETE FROM chunks WHERE entity_id = $1', [
      pending.entity.id
    ]);

    const response = await app.request('/api/entities/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ids: [a.entity.id, b.entity.id, pending.entity.id]
      })
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    if (!body || typeof body !== 'object') {
      throw new Error('expected JSON object');
    }

    const { embeddings } = body as {
      embeddings: { id: string; embedding: number[] }[];
    };

    // Pending entity (no chunks) is omitted.
    const returnedIds = embeddings.map((e) => e.id).sort();
    expect(returnedIds).toEqual([a.entity.id, b.entity.id].sort());

    for (const entry of embeddings) {
      expect(Array.isArray(entry.embedding)).toBe(true);
      expect(entry.embedding.length).toBe(1536);
      expect(entry.embedding.every((v) => typeof v === 'number')).toBe(true);
    }
  }, 120_000);

  it('rejects embeddings requests with invalid or missing ids', async () => {
    const { app, apiKey } = await createAuthorizedApp();

    const postJson = (payload: unknown) =>
      app.request('/api/entities/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

    const missing = await postJson({});
    expect(missing.status).toBe(400);

    const invalid = await postJson({ ids: ['not-a-uuid'] });
    expect(invalid.status).toBe(400);

    const empty = await postJson({ ids: [] });
    expect(empty.status).toBe(400);

    const tooMany = await postJson({
      ids: Array.from({ length: 501 }, () => crypto.randomUUID())
    });
    expect(tooMany.status).toBe(400);
  }, 120_000);

  it('filters embeddings by visibility scope', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();

    // Key limited to shared visibility only.
    const restrictedKey = (await createKey(database.pool, {
      name: `rest-${crypto.randomUUID()}`,
      scopes: ['read', 'write'],
      allowedVisibility: ['shared']
    }))._unsafeUnwrap();
    const writerKey = (await createKey(database.pool, {
      name: `rest-${crypto.randomUUID()}`,
      scopes: ['read', 'write'],
      allowedVisibility: ['shared', 'work']
    }))._unsafeUnwrap();

    const app = createApp({
      pool: database.pool,
      embeddingService
    });

    const createEntity = async (key: string, body: Record<string, unknown>) => {
      const response = await app.request('/api/entities', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      expect(response.status).toBe(201);
      return (await response.json()) as { entity: { id: string } };
    };

    const sharedEntity = await createEntity(writerKey.plaintextKey, {
      type: 'memory',
      content: 'shared content',
      visibility: 'shared'
    });
    const workEntity = await createEntity(writerKey.plaintextKey, {
      type: 'memory',
      content: 'work-only content',
      visibility: 'work'
    });

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const response = await app.request('/api/entities/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${restrictedKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ids: [sharedEntity.entity.id, workEntity.entity.id]
      })
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    const { embeddings } = body as {
      embeddings: { id: string; embedding: number[] }[];
    };

    expect(embeddings.map((e) => e.id)).toEqual([sharedEntity.entity.id]);
  }, 120_000);
});
