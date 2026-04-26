import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createEmbeddingService,
} from '../../src/services/embedding-service.js';
import {
  createEnrichmentWorker
} from '../../src/services/enrichment-worker.js';
import {
  listEntities,
  recallEntity,
  softDeleteEntity,
  storeEntity,
  updateEntity
} from '../../src/services/entity-service.js';
import { searchEntities } from '../../src/services/search-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(
  overrides: Partial<AuthContext> = {}
): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000101',
    keyName: 'service-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared'],
    ...overrides
  };
}

describe('entity-service', () => {
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
      id: '00000000-0000-0000-0000-000000000101',
      name: 'service-key'
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('stores and recalls entities with pending enrichment', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'decided to use pgvector',
      visibility: 'shared',
      tags: ['decisions', 'architecture'],
      metadata: { source: 'test' }
    });
    expect(stored.isOk()).toBe(true);

    const entity = stored._unsafeUnwrap();
    expect(entity).toMatchObject({
      type: 'memory',
      content: 'decided to use pgvector',
      visibility: 'shared',
      enrichmentStatus: 'pending',
      version: 1,
      tags: ['decisions', 'architecture']
    });

    const recalled = await recallEntity(
      database.pool,
      makeAuthContext(),
      entity.id
    );
    expect(recalled.isOk()).toBe(true);
    expect(recalled._unsafeUnwrap()).toEqual(entity);
  }, 120_000);

  it('returns a conflict with the current entity when the version is stale', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'initial content'
    }))._unsafeUnwrap();

    const updated = await updateEntity(database.pool, makeAuthContext(), {
      id: stored.id,
      version: stored.version,
      content: 'updated content'
    });
    expect(updated.isOk()).toBe(true);

    const stale = await updateEntity(database.pool, makeAuthContext(), {
      id: stored.id,
      version: stored.version,
      content: 'stale write'
    });

    expect(stale.isErr()).toBe(true);
    const error = stale._unsafeUnwrapErr();
    expect(error.code).toBe(ErrorCode.CONFLICT);
    expect(error.details.current).toMatchObject({
      id: stored.id,
      content: 'updated content',
      version: 2
    });
  }, 120_000);

  it('archives deleted entities and lists using filters', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const sharedMemory = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'ship the CLI',
      visibility: 'shared',
      tags: ['roadmap']
    }))._unsafeUnwrap();

    const workTask = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'task',
      content: 'write tests',
      visibility: 'work',
      status: 'next',
      tags: ['roadmap', 'gtd']
    }))._unsafeUnwrap();

    const deleted = await softDeleteEntity(
      database.pool,
      makeAuthContext(),
      sharedMemory.id
    );
    expect(deleted.isOk()).toBe(true);

    const recalledDeleted = await recallEntity(
      database.pool,
      makeAuthContext(),
      sharedMemory.id
    );
    expect(recalledDeleted.isOk()).toBe(true);
    expect(recalledDeleted._unsafeUnwrap().status).toBe('archived');

    const listed = await listEntities(database.pool, makeAuthContext(), {
      type: 'task',
      status: 'next',
      tags: ['roadmap']
    });

    expect(listed.isOk()).toBe(true);
    expect(listed._unsafeUnwrap()).toMatchObject({
      total: 1,
      items: [
        {
          id: workTask.id,
          type: 'task',
          status: 'next',
          visibility: 'work'
        }
      ]
    });
  }, 120_000);

  it('filters owner-scoped list and search results while keeping shared entities visible', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const auth = makeAuthContext();
    const embeddingService = createEmbeddingService();

    const shared = (await storeEntity(database.pool, auth, {
      type: 'memory',
      content: 'shared planning notes for the whole team',
      tags: ['owner-scope']
    }))._unsafeUnwrap();
    const productManager = (await storeEntity(database.pool, auth, {
      type: 'memory',
      content: 'product manager planning notes for sprint goals',
      tags: ['owner-scope'],
      owner: 'product-manager'
    } as never))._unsafeUnwrap();
    await storeEntity(database.pool, auth, {
      type: 'memory',
      content: 'developer planning notes for implementation spikes',
      tags: ['owner-scope'],
      owner: 'developer'
    } as never);

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const listed = await listEntities(database.pool, auth, {
      tags: ['owner-scope'],
      owner: 'product-manager'
    } as never);

    expect(listed.isOk()).toBe(true);
    expect(listed._unsafeUnwrap().items.map((entity) => entity.id).sort()).toEqual(
      [shared.id, productManager.id].sort()
    );

    const searched = await searchEntities(
      database.pool,
      auth,
      {
        query: 'planning notes',
        owner: 'product-manager',
        threshold: 0
      } as never,
      {
        embeddingService
      }
    );

    expect(searched.isOk()).toBe(true);
    expect(searched._unsafeUnwrap().results.map((entry) => entry.entity.id).sort()).toEqual(
      [shared.id, productManager.id].sort()
    );
  }, 120_000);

  it('allows delete-only keys to soft delete accessible entities', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await seedApiKey(database.pool, {
      id: '00000000-0000-0000-0000-000000000105',
      name: 'delete-only-key',
      scopes: ['delete'],
      allowedVisibility: ['shared']
    });

    const stored = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'delete me',
      visibility: 'shared'
    }))._unsafeUnwrap();

    const deleted = await softDeleteEntity(
      database.pool,
      makeAuthContext({
        apiKeyId: '00000000-0000-0000-0000-000000000105',
        keyName: 'delete-only-key',
        scopes: ['delete'],
        allowedVisibility: ['shared']
      }),
      stored.id
    );

    expect(deleted.isOk()).toBe(true);

    const recalled = await recallEntity(
      database.pool,
      makeAuthContext(),
      stored.id
    );
    expect(recalled.isOk()).toBe(true);
    expect(recalled._unsafeUnwrap().status).toBe('archived');
  }, 120_000);

  it('removes stale chunks when content is cleared', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'pgvector keeps old chunks around'
    }))._unsafeUnwrap();

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService: createEmbeddingService()
    }).runOnce();

    const before = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM chunks WHERE entity_id = $1',
      [stored.id]
    );
    expect(Number(before.rows[0]?.count ?? '0')).toBeGreaterThan(0);

    const updated = await updateEntity(database.pool, makeAuthContext(), {
      id: stored.id,
      version: stored.version,
      content: ''
    });
    expect(updated.isOk()).toBe(true);

    const after = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM chunks WHERE entity_id = $1',
      [stored.id]
    );
    expect(Number(after.rows[0]?.count ?? '0')).toBe(0);
  }, 120_000);

  it('emits audit rows for mutating operations but not recall, list, or search', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const auth = makeAuthContext();
    const stored = (await storeEntity(database.pool, auth, {
      type: 'memory',
      content: 'audit trail content'
    }))._unsafeUnwrap();

    await recallEntity(database.pool, auth, stored.id);
    await listEntities(database.pool, auth, { type: 'memory' });
    await updateEntity(database.pool, auth, {
      id: stored.id,
      version: stored.version,
      content: 'audit trail updated'
    });

    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService: createEmbeddingService()
    });
    await worker.runOnce();
    await searchEntities(
      database.pool,
      auth,
      { query: 'audit trail' },
      { embeddingService: createEmbeddingService() }
    );

    await softDeleteEntity(database.pool, auth, stored.id);

    const auditRows = await database.pool.query<{
      operation: string;
      entity_id: string | null;
    }>(
      `
        SELECT operation, entity_id
        FROM audit_log
        ORDER BY timestamp ASC
      `
    );

    expect(auditRows.rows).toEqual([
      { operation: 'store', entity_id: stored.id },
      { operation: 'update', entity_id: stored.id },
      { operation: 'delete', entity_id: stored.id }
    ]);
  }, 120_000);

  it('excludes archived entities from listEntities by default', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    await storeEntity(database.pool, auth, {
      type: 'memory', content: 'active entity', visibility: 'personal'
    });
    const archivedResult = await storeEntity(database.pool, auth, {
      type: 'memory', content: 'archived entity', visibility: 'personal'
    });
    expect(archivedResult.isOk()).toBe(true);
    const archived = archivedResult._unsafeUnwrap();
    await softDeleteEntity(database.pool, auth, archived.id);

    const result = await listEntities(database.pool, auth, {});
    expect(result.isOk()).toBe(true);
    const ids = result._unsafeUnwrap().items.map(e => e.id);
    expect(ids).not.toContain(archived.id);
  }, 120_000);

  it('includes archived entities when includeArchived is true', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    const archivedResult = await storeEntity(database.pool, auth, {
      type: 'memory', content: 'archived entity', visibility: 'personal'
    });
    expect(archivedResult.isOk()).toBe(true);
    const archived = archivedResult._unsafeUnwrap();
    await softDeleteEntity(database.pool, auth, archived.id);

    const result = await listEntities(database.pool, auth, { includeArchived: true });
    expect(result.isOk()).toBe(true);
    const ids = result._unsafeUnwrap().items.map(e => e.id);
    expect(ids).toContain(archived.id);
  }, 120_000);
});
