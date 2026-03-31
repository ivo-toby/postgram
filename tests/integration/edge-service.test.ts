import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEdge, deleteEdge, expandGraph, listEdges } from '../../src/services/edge-service.js';
import { storeEntity } from '../../src/services/entity-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import { ErrorCode } from '../../src/util/errors.js';
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

  it('rejects self-edges and out-of-range confidence values', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    const entity = (await storeEntity(database.pool, auth, {
      type: 'person', content: 'Self reference'
    }))._unsafeUnwrap();

    const selfEdge = await createEdge(database.pool, auth, {
      sourceId: entity.id,
      targetId: entity.id,
      relation: 'related_to'
    });
    expect(selfEdge.isErr()).toBe(true);
    expect(selfEdge._unsafeUnwrapErr().code).toBe(ErrorCode.VALIDATION);

    const other = (await storeEntity(database.pool, auth, {
      type: 'project', content: 'Confidence target'
    }))._unsafeUnwrap();

    const badConfidence = await createEdge(database.pool, auth, {
      sourceId: entity.id,
      targetId: other.id,
      relation: 'related_to',
      confidence: 1.5
    });
    expect(badConfidence.isErr()).toBe(true);
    expect(badConfidence._unsafeUnwrapErr().code).toBe(ErrorCode.VALIDATION);
  }, 120_000);

  it('validates list direction and graph depth at the service layer', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    const entity = (await storeEntity(database.pool, auth, {
      type: 'person', content: 'Validation root'
    }))._unsafeUnwrap();

    const badDirection = await listEdges(
      database.pool,
      auth,
      entity.id,
      { direction: 'sideways' as never }
    );
    expect(badDirection.isErr()).toBe(true);
    expect(badDirection._unsafeUnwrapErr().code).toBe(ErrorCode.VALIDATION);

    const badDepth = await expandGraph(
      database.pool,
      auth,
      entity.id,
      { depth: Number.NaN as never }
    );
    expect(badDepth.isErr()).toBe(true);
    expect(badDepth._unsafeUnwrapErr().code).toBe(ErrorCode.VALIDATION);
  }, 120_000);

  it('does not allow traversing through hidden entities during graph expansion', async () => {
    if (!database) throw new Error('test database not initialized');
    const fullAuth = makeAuthContext();
    const restrictedAuth: AuthContext = {
      ...makeAuthContext(),
      allowedVisibility: ['shared']
    };

    const alice = (await storeEntity(database.pool, fullAuth, {
      type: 'person', content: 'Alice', visibility: 'shared'
    }))._unsafeUnwrap();
    const hiddenProject = (await storeEntity(database.pool, fullAuth, {
      type: 'project', content: 'Hidden Project', visibility: 'work'
    }))._unsafeUnwrap();
    const publicTask = (await storeEntity(database.pool, fullAuth, {
      type: 'task', content: 'Public Task', visibility: 'shared', status: 'inbox'
    }))._unsafeUnwrap();

    await createEdge(database.pool, fullAuth, {
      sourceId: alice.id, targetId: hiddenProject.id, relation: 'involves'
    });
    await createEdge(database.pool, fullAuth, {
      sourceId: hiddenProject.id, targetId: publicTask.id, relation: 'part_of'
    });

    const hiddenList = await listEdges(
      database.pool,
      restrictedAuth,
      hiddenProject.id
    );
    expect(hiddenList.isErr()).toBe(true);
    expect(hiddenList._unsafeUnwrapErr().code).toBe(ErrorCode.FORBIDDEN);

    const expanded = await expandGraph(
      database.pool,
      restrictedAuth,
      alice.id,
      { depth: 2 }
    );
    expect(expanded.isOk()).toBe(true);
    const graph = expanded._unsafeUnwrap();

    expect(graph.entities.map((entity) => entity.id)).toEqual([alice.id]);
    expect(graph.edges).toEqual([]);
  }, 120_000);
});
