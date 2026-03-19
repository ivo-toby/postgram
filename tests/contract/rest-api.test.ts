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

  async function createAuthorizedApp() {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const created = (await createKey(database.pool, {
      name: `rest-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete'],
      allowedVisibility: ['shared', 'work']
    }))._unsafeUnwrap();

    return {
      app: createApp({ pool: database.pool }),
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
});
