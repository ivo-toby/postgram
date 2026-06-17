import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { createApp } from '../../src/index.js';
import type { AuthContext } from '../../src/auth/types.js';
import { createKey } from '../../src/auth/key-service.js';
import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import { storeEntity } from '../../src/services/entity-service.js';
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
  }, 240_000);

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
      apiKey: created.plaintextKey,
      clientId: created.record.clientId
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

  it('stores entities with skipped extraction', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const { app, apiKey } = await createAuthorizedApp();

    const storeResponse = await app.request('/api/entities', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'interaction',
        content: 'conversation import that should not be graph extracted',
        visibility: 'shared',
        skip_extraction: true
      })
    });
    const storedBody = (await storeResponse.json()) as {
      entity: { id: string; enrichment_status: string };
    };

    expect(storeResponse.status).toBe(201);
    expect(storedBody.entity.enrichment_status).toBe('pending');

    const row = await database.pool.query<{ extraction_status: string | null }>(
      'SELECT extraction_status FROM entities WHERE id = $1',
      [storedBody.entity.id]
    );
    expect(row.rows[0]?.extraction_status).toBe('skipped');
  }, 120_000);

  it('lists memories by memory_role', async () => {
    const { app, apiKey, clientId } = await createAuthorizedApp();

    const createMemory = async (content: string, metadata: Record<string, unknown>) => {
      const response = await app.request('/api/entities', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'memory',
          content,
          visibility: 'shared',
          metadata
        })
      });

      expect(response.status).toBe(201);
      return (await response.json()) as { entity: { id: string } };
    };

    const sessionContext = await createMemory(
      'Session context visible through the role filter.',
      {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: clientId }
      }
    );
    await createMemory('Durable memory excluded by the role filter.', {
      memory_role: 'durable_memory'
    });

    const listResponse = await app.request(
      '/api/entities?type=memory&memory_role=session_context',
      {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      }
    );
    const listBody = (await listResponse.json()) as {
      items: Array<{ id: string; metadata: Record<string, unknown> }>;
    };

    expect(listResponse.status).toBe(200);
    expect(listBody.items.map((item) => item.id)).toEqual([
      sessionContext.entity.id
    ]);
    expect(listBody.items[0]?.metadata.memory_role).toBe('session_context');
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

  it('self-grooms session-context memories through auth-derived scope only', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({
      pool: database.pool,
      embeddingService: createEmbeddingService()
    });

    const ownKey = (
      await createKey(database.pool, {
        name: `rest-groom-own-${crypto.randomUUID()}`,
        clientId: 'rest-groom-own',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['personal']
      })
    )._unsafeUnwrap();
    const otherKey = (
      await createKey(database.pool, {
        name: `rest-groom-other-${crypto.randomUUID()}`,
        clientId: 'rest-groom-other',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['personal']
      })
    )._unsafeUnwrap();

    const storeOwn = await app.request('/api/memory/session-context', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'self-groom own context',
        visibility: 'personal',
        topic: 'groom-topic',
        session_id: 'groom-session',
        tags: ['groom', 'alpha'],
        groom_after: '2026-01-01T00:00:00.000Z'
      })
    });
    expect(storeOwn.status).toBe(201);
    const ownBody = (await storeOwn.json()) as { entity: { id: string } };

    const storeOther = await app.request('/api/memory/session-context', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${otherKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: 'self-groom other context',
        visibility: 'personal',
        topic: 'groom-topic',
        session_id: 'groom-session',
        tags: ['groom', 'beta'],
        groom_after: '2026-01-01T00:00:00.000Z'
      })
    });
    expect(storeOther.status).toBe(201);
    const otherBody = (await storeOther.json()) as { entity: { id: string } };

    const dryRunResponse = await app.request('/api/memory/session-context/groom', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dry_run: true,
        older_than_ms: 30 * 24 * 60 * 60 * 1000,
        limit: 5,
        topic: 'groom-topic',
        session_id: 'groom-session',
        tags: ['groom', 'alpha']
      })
    });
    const dryRunBody = (await dryRunResponse.json()) as {
      dryRun: boolean;
      eligible: Array<{ id: string }>;
    };

    expect(dryRunResponse.status).toBe(200);
    expect(dryRunBody.dryRun).toBe(true);
    expect(dryRunBody.eligible.map((entry) => entry.id)).toEqual([ownBody.entity.id]);

    const archiveResponse = await app.request('/api/memory/session-context/groom', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        confirmed: true,
        older_than_ms: 30 * 24 * 60 * 60 * 1000,
        limit: 5,
        topic: 'groom-topic',
        session_id: 'groom-session',
        tags: ['groom', 'alpha']
      })
    });
    const archiveBody = (await archiveResponse.json()) as {
      dryRun: boolean;
      archived: number;
      mode: string;
    };

    expect(archiveResponse.status).toBe(200);
    expect(archiveBody).toMatchObject({
      dryRun: false,
      archived: 1,
      mode: 'archive'
    });

    const rows = await database.pool.query<{ id: string; status: string | null }>(
      'SELECT id, status FROM entities WHERE id = ANY($1)',
      [[ownBody.entity.id, otherBody.entity.id]]
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row.status]));
    expect(byId[ownBody.entity.id]).toBe('archived');
    expect(byId[otherBody.entity.id]).toBeNull();

    const rejectedResponse = await app.request('/api/memory/session-context/groom', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dry_run: true,
        mode: 'promote'
      })
    });
    const rejectedBody = (await rejectedResponse.json()) as {
      error: { code: string };
    };

    expect(rejectedResponse.status).toBe(400);
    expect(rejectedBody.error.code).toBe('VALIDATION');
  }, 120_000);

  it('filters self-groom previews and archives by visibility and delete scope', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({
      pool: database.pool,
      embeddingService: createEmbeddingService()
    });

    const seedKey = (
      await createKey(database.pool, {
        name: `rest-groom-seed-${crypto.randomUUID()}`,
        clientId: 'rest-groom-same-client',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared', 'work', 'personal']
      })
    )._unsafeUnwrap();
    const previewKey = (
      await createKey(database.pool, {
        name: `rest-groom-preview-${crypto.randomUUID()}`,
        clientId: 'rest-groom-same-client',
        scopes: ['read', 'write'],
        allowedVisibility: ['shared']
      })
    )._unsafeUnwrap();
    const archiveKey = (
      await createKey(database.pool, {
        name: `rest-groom-archive-${crypto.randomUUID()}`,
        clientId: 'rest-groom-same-client',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared']
      })
    )._unsafeUnwrap();
    const emptyVisibilityKey = (
      await createKey(database.pool, {
        name: `rest-groom-empty-${crypto.randomUUID()}`,
        clientId: 'rest-groom-same-client',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: []
      })
    )._unsafeUnwrap();

    const seedSessionContext = async (body: Record<string, unknown>) => {
      const response = await app.request('/api/memory/session-context', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${seedKey.plaintextKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      expect(response.status).toBe(201);
      return (await response.json()) as { entity: { id: string; visibility: string } };
    };

    const shared = await seedSessionContext({
      content: 'shared groomable context',
      visibility: 'shared',
      topic: 'groom-topic',
      session_id: 'groom-session',
      tags: ['groom', 'shared'],
      groom_after: '2026-01-01T00:00:00.000Z'
    });
    const personal = await seedSessionContext({
      content: 'personal groomable context',
      visibility: 'personal',
      topic: 'groom-topic',
      session_id: 'groom-session',
      tags: ['groom', 'personal'],
      groom_after: '2026-01-01T00:00:00.000Z'
    });
    const work = await seedSessionContext({
      content: 'work groomable context',
      visibility: 'work',
      topic: 'groom-topic',
      session_id: 'groom-session',
      tags: ['groom', 'work'],
      groom_after: '2026-01-01T00:00:00.000Z'
    });

    const previewResponse = await app.request('/api/memory/session-context/groom', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${previewKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dry_run: true,
        older_than_ms: 30 * 24 * 60 * 60 * 1000,
        limit: 10,
        topic: 'groom-topic',
        session_id: 'groom-session',
        tags: ['groom']
      })
    });
    const previewBody = (await previewResponse.json()) as {
      eligible: Array<{ id: string; visibility: string }>;
    };

    expect(previewResponse.status).toBe(200);
    expect(previewBody.eligible).toEqual([
      expect.objectContaining({
        id: shared.entity.id,
        visibility: 'shared'
      })
    ]);

    const emptyPreviewResponse = await app.request('/api/memory/session-context/groom', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${emptyVisibilityKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dry_run: true,
        older_than_ms: 30 * 24 * 60 * 60 * 1000,
        limit: 10,
        topic: 'groom-topic',
        session_id: 'groom-session',
        tags: ['groom']
      })
    });
    const emptyPreviewBody = (await emptyPreviewResponse.json()) as {
      eligible: Array<{ id: string; visibility: string }>;
    };

    expect(emptyPreviewResponse.status).toBe(200);
    expect(emptyPreviewBody.eligible).toEqual([]);

    const noDeleteResponse = await app.request('/api/memory/session-context/groom', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${previewKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        confirmed: true,
        older_than_ms: 30 * 24 * 60 * 60 * 1000,
        limit: 10,
        topic: 'groom-topic',
        session_id: 'groom-session',
        tags: ['groom']
      })
    });
    const noDeleteBody = (await noDeleteResponse.json()) as {
      error: { code: string };
    };

    expect(noDeleteResponse.status).toBe(403);
    expect(noDeleteBody.error.code).toBe('FORBIDDEN');

    const archiveResponse = await app.request('/api/memory/session-context/groom', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${archiveKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        confirmed: true,
        older_than_ms: 30 * 24 * 60 * 60 * 1000,
        limit: 10,
        topic: 'groom-topic',
        session_id: 'groom-session',
        tags: ['groom']
      })
    });
    const archiveBody = (await archiveResponse.json()) as {
      archived: number;
      promoted: number;
      skipped: number;
      mode: string;
    };

    expect(archiveResponse.status).toBe(200);
    expect(archiveBody).toMatchObject({
      archived: 1,
      promoted: 0,
      skipped: 0,
      mode: 'archive'
    });

    const emptyArchiveResponse = await app.request('/api/memory/session-context/groom', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${emptyVisibilityKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        confirmed: true,
        older_than_ms: 30 * 24 * 60 * 60 * 1000,
        limit: 10,
        topic: 'groom-topic',
        session_id: 'groom-session',
        tags: ['groom']
      })
    });
    const emptyArchiveBody = (await emptyArchiveResponse.json()) as {
      archived: number;
      promoted: number;
      skipped: number;
      mode: string;
    };

    expect(emptyArchiveResponse.status).toBe(200);
    expect(emptyArchiveBody).toMatchObject({
      archived: 0,
      promoted: 0,
      skipped: 0,
      mode: 'archive'
    });

    const rows = await database.pool.query<{ id: string; status: string | null }>(
      'SELECT id, status FROM entities WHERE id = ANY($1)',
      [[shared.entity.id, personal.entity.id, work.entity.id]]
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row.status]));
    expect(byId[shared.entity.id]).toBe('archived');
    expect(byId[personal.entity.id]).toBeNull();
    expect(byId[work.entity.id]).toBeNull();
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

  it('rejects bulk archive requests with invalid body shapes', async () => {
    const { app, apiKey } = await createAuthorizedApp();

    const postJson = (payload: unknown) =>
      app.request('/api/entities/bulk/archive', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

    const missingIds = await postJson({});
    const missingIdsBody = (await missingIds.json()) as {
      error: { code: string };
    };

    expect(missingIds.status).toBe(400);
    expect(missingIdsBody.error.code).toBe(ErrorCode.VALIDATION);

    const emptyIds = await postJson({ ids: [] });
    const emptyIdsBody = (await emptyIds.json()) as {
      error: { code: string };
    };

    expect(emptyIds.status).toBe(400);
    expect(emptyIdsBody.error.code).toBe(ErrorCode.VALIDATION);
  }, 120_000);

  it('rejects bulk archive requests with non-UUID ids', async () => {
    const { app, apiKey } = await createAuthorizedApp();

    const response = await app.request('/api/entities/bulk/archive', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ids: ['not-a-uuid']
      })
    });
    const body = (await response.json()) as {
      error: { code: string };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe(ErrorCode.VALIDATION);
  }, 120_000);

  it('rejects bulk archive requests with more than 500 ids', async () => {
    const { app, apiKey } = await createAuthorizedApp();

    const response = await app.request('/api/entities/bulk/archive', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ids: Array.from({ length: 501 }, () => crypto.randomUUID())
      })
    });
    const body = (await response.json()) as {
      error: { code: string };
    };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe(ErrorCode.VALIDATION);
  }, 120_000);

  it('requires auth and delete scope for bulk archive', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({ pool: database.pool });
    const writerKey = (await createKey(database.pool, {
      name: `rest-bulk-writer-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete'],
      allowedVisibility: ['shared']
    }))._unsafeUnwrap();
    const noDeleteKey = (await createKey(database.pool, {
      name: `rest-bulk-no-delete-${crypto.randomUUID()}`,
      scopes: ['read', 'write'],
      allowedVisibility: ['shared']
    }))._unsafeUnwrap();

    const storeResponse = await app.request('/api/entities', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${writerKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'memory',
        content: 'bulk archive auth check',
        visibility: 'shared'
      })
    });
    const storeBody = (await storeResponse.json()) as {
      entity: { id: string };
    };

    expect(storeResponse.status).toBe(201);

    const unauthenticated = await app.request('/api/entities/bulk/archive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ids: [storeBody.entity.id]
      })
    });
    const unauthenticatedBody = (await unauthenticated.json()) as {
      error: { code: string };
    };

    expect(unauthenticated.status).toBe(401);
    expect(unauthenticatedBody.error.code).toBe(ErrorCode.UNAUTHORIZED);

    const forbidden = await app.request('/api/entities/bulk/archive', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${noDeleteKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ids: [storeBody.entity.id]
      })
    });
    const forbiddenBody = (await forbidden.json()) as {
      error: { code: string };
    };

    expect(forbidden.status).toBe(403);
    expect(forbiddenBody.error.code).toBe(ErrorCode.FORBIDDEN);

    const statusRows = await database.pool.query<{ status: string | null }>(
      'SELECT status FROM entities WHERE id = $1',
      [storeBody.entity.id]
    );
    expect(statusRows.rows[0]?.status).toBeNull();
  }, 120_000);

  it('bulk archives accessible ids and returns mixed failures', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({ pool: database.pool });
    const writerKey = (await createKey(database.pool, {
      name: `rest-bulk-writer-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete'],
      allowedVisibility: ['shared', 'work']
    }))._unsafeUnwrap();
    const archiveKey = (await createKey(database.pool, {
      name: `rest-bulk-archive-${crypto.randomUUID()}`,
      scopes: ['delete'],
      allowedVisibility: ['shared']
    }))._unsafeUnwrap();
    const missingId = '00000000-0000-0000-0000-000000000404';

    const createEntity = async (body: Record<string, unknown>) => {
      const response = await app.request('/api/entities', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${writerKey.plaintextKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      expect(response.status).toBe(201);
      return (await response.json()) as { entity: { id: string } };
    };

    const archived = await createEntity({
      type: 'memory',
      content: 'bulk archive success',
      visibility: 'shared'
    });
    const inaccessible = await createEntity({
      type: 'memory',
      content: 'bulk archive inaccessible',
      visibility: 'work'
    });

    const response = await app.request('/api/entities/bulk/archive', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${archiveKey.plaintextKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ids: [archived.entity.id, missingId, inaccessible.entity.id]
      })
    });
    const body = (await response.json()) as {
      archived: Array<{ id: string }>;
      failed: Array<{ id: string; code: string; message: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.archived).toEqual([{ id: archived.entity.id }]);
    expect(body.failed).toEqual([
      {
        id: missingId,
        code: ErrorCode.NOT_FOUND,
        message: 'Entity not found'
      },
      expect.objectContaining({
        id: inaccessible.entity.id,
        code: ErrorCode.FORBIDDEN,
        message: expect.any(String)
      })
    ]);

    const rows = await database.pool.query<{ id: string; status: string | null }>(
      'SELECT id, status FROM entities WHERE id = ANY($1)',
      [[archived.entity.id, inaccessible.entity.id]]
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row.status]));
    expect(byId[archived.entity.id]).toBe('archived');
    expect(byId[inaccessible.entity.id]).toBeNull();
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

  it('does not allow scoped-memory bypass via REST search payloads', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();
    const { app, apiKey, clientId } = await createAuthorizedApp({
      embeddingService
    });

    const viewerAuth: AuthContext = {
      apiKeyId: '00000000-0000-0000-0000-000000000902',
      keyName: 'rest-viewer-seed',
      clientId,
      scopes: ['read', 'write', 'delete'],
      allowedTypes: null,
      allowedVisibility: ['personal', 'work', 'shared']
    };
    const otherAuth = {
      ...viewerAuth,
      apiKeyId: '00000000-0000-0000-0000-000000000903',
      clientId: `${clientId}-other`,
      keyName: 'rest-other-seed'
    };

    await storeEntity(database.pool, viewerAuth, {
      type: 'memory',
      visibility: 'shared',
      content: 'Viewer scoped durable memory for REST bypass regression.',
      metadata: {
        memory_role: 'durable_memory',
        session_scope: { kind: 'client', client_id: clientId }
      }
    });

    await storeEntity(database.pool, otherAuth, {
      type: 'memory',
      visibility: 'shared',
      content: 'Other scoped durable memory for REST bypass regression.',
      metadata: {
        memory_role: 'durable_memory',
        session_scope: { kind: 'client', client_id: otherAuth.clientId }
      }
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
        query: 'scoped durable memory REST bypass regression',
        type: 'memory',
        threshold: 0,
        limit: 10,
        include_other_clients_session_context: true
      })
    });
    const searchBody = (await searchResponse.json()) as {
      results: Array<{ entity: { content: string | null } }>;
    };

    expect(searchResponse.status).toBe(200);
    const contents = searchBody.results.map((entry) => entry.entity.content);
    expect(contents).toContain('Viewer scoped durable memory for REST bypass regression.');
    expect(contents).not.toContain('Other scoped durable memory for REST bypass regression.');
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
