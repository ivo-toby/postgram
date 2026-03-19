import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  listEntities,
  recallEntity,
  softDeleteEntity,
  storeEntity,
  updateEntity
} from '../../src/services/entity-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(
  overrides: Partial<AuthContext> = {}
): AuthContext {
  return {
    apiKeyId: 'service-key',
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
});
