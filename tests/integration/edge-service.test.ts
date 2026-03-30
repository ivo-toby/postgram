import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEdge, deleteEdge, expandGraph, listEdges } from '../../src/services/edge-service.js';
import { storeEntity } from '../../src/services/entity-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase, resetTestDatabase, seedApiKey, type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000301',
    keyName: 'edge-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

describe('edge-service', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) throw new Error('test database not initialized');
    await resetTestDatabase(database.pool);
    await seedApiKey(database.pool, {
      id: '00000000-0000-0000-0000-000000000301',
      name: 'edge-key'
    });
  });

  afterAll(async () => {
    if (database) await database.close();
  });

  it('creates, lists, and deletes edges between entities', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    const entityA = (await storeEntity(database.pool, auth, {
      type: 'person', content: 'Alice the engineer'
    }))._unsafeUnwrap();
    const entityB = (await storeEntity(database.pool, auth, {
      type: 'project', content: 'Project Alpha'
    }))._unsafeUnwrap();

    const edge = await createEdge(database.pool, auth, {
      sourceId: entityA.id, targetId: entityB.id, relation: 'involves'
    });
    expect(edge.isOk()).toBe(true);
    const created = edge._unsafeUnwrap();
    expect(created.relation).toBe('involves');
    expect(created.confidence).toBe(1.0);

    const edges = await listEdges(database.pool, auth, entityA.id);
    expect(edges.isOk()).toBe(true);
    expect(edges._unsafeUnwrap()).toHaveLength(1);

    const deleted = await deleteEdge(database.pool, auth, created.id);
    expect(deleted.isOk()).toBe(true);

    const afterDelete = await listEdges(database.pool, auth, entityA.id);
    expect(afterDelete._unsafeUnwrap()).toHaveLength(0);
  }, 120_000);

  it('upserts edges with same source+target+relation', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    const entityA = (await storeEntity(database.pool, auth, {
      type: 'person', content: 'Bob'
    }))._unsafeUnwrap();
    const entityB = (await storeEntity(database.pool, auth, {
      type: 'project', content: 'Beta'
    }))._unsafeUnwrap();

    await createEdge(database.pool, auth, {
      sourceId: entityA.id, targetId: entityB.id,
      relation: 'involves', confidence: 0.5
    });

    const upserted = await createEdge(database.pool, auth, {
      sourceId: entityA.id, targetId: entityB.id,
      relation: 'involves', confidence: 0.9
    });
    expect(upserted.isOk()).toBe(true);
    expect(upserted._unsafeUnwrap().confidence).toBe(0.9);

    const edges = await listEdges(database.pool, auth, entityA.id);
    expect(edges._unsafeUnwrap()).toHaveLength(1);
  }, 120_000);

  it('expands graph neighborhood', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    const alice = (await storeEntity(database.pool, auth, {
      type: 'person', content: 'Alice'
    }))._unsafeUnwrap();
    const project = (await storeEntity(database.pool, auth, {
      type: 'project', content: 'Alpha'
    }))._unsafeUnwrap();
    const task = (await storeEntity(database.pool, auth, {
      type: 'task', content: 'Build graph', status: 'inbox'
    }))._unsafeUnwrap();

    await createEdge(database.pool, auth, {
      sourceId: alice.id, targetId: project.id, relation: 'involves'
    });
    await createEdge(database.pool, auth, {
      sourceId: task.id, targetId: project.id, relation: 'part_of'
    });

    // Depth 1 from alice: should find project but not task
    const depth1 = await expandGraph(database.pool, auth, alice.id, { depth: 1 });
    expect(depth1.isOk()).toBe(true);
    const result1 = depth1._unsafeUnwrap();
    expect(result1.edges).toHaveLength(1);
    expect(result1.entities.map((e) => e.id).sort()).toEqual(
      [alice.id, project.id].sort()
    );

    // Depth 2 from alice: should find project AND task
    const depth2 = await expandGraph(database.pool, auth, alice.id, { depth: 2 });
    expect(depth2.isOk()).toBe(true);
    const result2 = depth2._unsafeUnwrap();
    expect(result2.edges).toHaveLength(2);
    expect(result2.entities.map((e) => e.id).sort()).toEqual(
      [alice.id, project.id, task.id].sort()
    );
  }, 120_000);
});
