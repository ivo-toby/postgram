import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { extractAndLinkRelationships } from '../../src/services/extraction-service.js';
import { storeEntity } from '../../src/services/entity-service.js';
import { listEdges } from '../../src/services/edge-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase, resetTestDatabase, seedApiKey, type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000302',
    keyName: 'extraction-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

describe('extraction-service', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) throw new Error('test database not initialized');
    await resetTestDatabase(database.pool);
    await seedApiKey(database.pool, {
      id: '00000000-0000-0000-0000-000000000302',
      name: 'extraction-key'
    });
  });

  afterAll(async () => {
    if (database) await database.close();
  });

  it('creates edges when LLM identifies matching entities', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();

    await storeEntity(database.pool, auth, {
      type: 'person', content: 'Alice is a senior engineer',
      metadata: { title: 'Alice' }
    });
    await storeEntity(database.pool, auth, {
      type: 'project', content: 'Project Alpha is a knowledge store',
      metadata: { title: 'Project Alpha' }
    });

    const source = (await storeEntity(database.pool, auth, {
      type: 'memory',
      content: 'Alice is working on Project Alpha to build the knowledge graph'
    }))._unsafeUnwrap();

    const mockLlm = async () => JSON.stringify([
      { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.95 },
      { target_name: 'Project Alpha', target_type: 'project', relation: 'part_of', confidence: 0.9 },
      { target_name: 'Nonexistent', target_type: 'person', relation: 'involves', confidence: 0.8 }
    ]);

    const linked = await extractAndLinkRelationships(
      database.pool, auth, source.id, source.type, source.content!,
      { callLlm: mockLlm }
    );

    expect(linked).toBe(2);

    const edges = await listEdges(database.pool, auth, source.id);
    expect(edges.isOk()).toBe(true);
    expect(edges._unsafeUnwrap()).toHaveLength(2);
    expect(edges._unsafeUnwrap().map((e) => e.relation).sort()).toEqual(['involves', 'part_of']);
  }, 120_000);
});
