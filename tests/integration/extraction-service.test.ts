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

    const mockLlm = () => Promise.resolve(JSON.stringify([
      { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.95 },
      { target_name: 'Project Alpha', target_type: 'project', relation: 'part_of', confidence: 0.9 },
      { target_name: 'Nonexistent', target_type: 'person', relation: 'involves', confidence: 0.8 }
    ]));

    const linked = await extractAndLinkRelationships(
      database.pool,
      auth,
      {
        id: source.id,
        type: source.type,
        content: source.content!,
        visibility: source.visibility,
        owner: source.owner
      },
      { callLlm: mockLlm }
    );

    expect(linked).toBe(2);

    const edges = await listEdges(database.pool, auth, source.id);
    expect(edges.isOk()).toBe(true);
    expect(edges._unsafeUnwrap()).toHaveLength(2);
    expect(edges._unsafeUnwrap().map((e) => e.relation).sort()).toEqual(['involves', 'part_of']);
  }, 120_000);

  describe('auto-create entities', () => {
    it('skips missing targets when auto-create is disabled (default)', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory',
        content: 'Alice is working on Project Alpha'
      }))._unsafeUnwrap();

      const mockLlm = () =>
        Promise.resolve(
          JSON.stringify([
            { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.95 }
          ])
        );

      const linked = await extractAndLinkRelationships(
        database.pool,
        auth,
        {
          id: source.id,
          type: source.type,
          content: source.content!,
          visibility: source.visibility,
          owner: source.owner
        },
        { callLlm: mockLlm }
      );
      expect(linked).toBe(0);

      const count = await database.pool.query<{ count: string }>(
        "SELECT count(*)::text FROM entities WHERE type = 'person'"
      );
      expect(Number(count.rows[0]?.count)).toBe(0);
    }, 120_000);

    it('creates stub entity with provenance metadata and tag when enabled', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory',
        content: 'Alice is working on Project Alpha'
      }))._unsafeUnwrap();

      const mockLlm = () =>
        Promise.resolve(
          JSON.stringify([
            { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.95 }
          ])
        );

      const linked = await extractAndLinkRelationships(
        database.pool,
        auth,
        {
          id: source.id,
          type: source.type,
          content: source.content!,
          visibility: source.visibility,
          owner: source.owner
        },
        {
          callLlm: mockLlm,
          autoCreate: {
            enabled: true,
            types: ['person', 'project', 'interaction'],
            minConfidence: 0.7
          }
        }
      );
      expect(linked).toBe(1);

      const rows = await database.pool.query<{
        type: string;
        content: string | null;
        metadata: Record<string, unknown>;
        tags: string[];
        enrichment_status: string;
      }>(
        `SELECT type, content, metadata, tags, enrichment_status
         FROM entities WHERE type = 'person'`
      );
      expect(rows.rows).toHaveLength(1);
      const created = rows.rows[0]!;
      expect(created.content).toBe('Alice');
      expect(created.metadata).toMatchObject({
        title: 'Alice',
        auto_created_by: 'llm-extraction',
        source_entity_id: source.id
      });
      expect(created.tags).toContain('auto-created');
      expect(created.enrichment_status).toBe('pending');
    }, 120_000);

    it('skips auto-create below min confidence', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory',
        content: 'Alice might be involved'
      }))._unsafeUnwrap();

      const mockLlm = () =>
        Promise.resolve(
          JSON.stringify([
            { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.5 }
          ])
        );

      const linked = await extractAndLinkRelationships(
        database.pool,
        auth,
        {
          id: source.id,
          type: source.type,
          content: source.content!,
          visibility: source.visibility,
          owner: source.owner
        },
        {
          callLlm: mockLlm,
          autoCreate: {
            enabled: true,
            types: ['person', 'project', 'interaction'],
            minConfidence: 0.7
          }
        }
      );
      expect(linked).toBe(0);

      const count = await database.pool.query<{ count: string }>(
        "SELECT count(*)::text FROM entities WHERE type = 'person'"
      );
      expect(Number(count.rows[0]?.count)).toBe(0);
    }, 120_000);

    it('skips types not in the allowlist', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory',
        content: 'Mentions some task.md'
      }))._unsafeUnwrap();

      const mockLlm = () =>
        Promise.resolve(
          JSON.stringify([
            { target_name: 'Run tests', target_type: 'task', relation: 'mentioned_in', confidence: 0.95 }
          ])
        );

      const linked = await extractAndLinkRelationships(
        database.pool,
        auth,
        {
          id: source.id,
          type: source.type,
          content: source.content!,
          visibility: source.visibility,
          owner: source.owner
        },
        {
          callLlm: mockLlm,
          autoCreate: {
            enabled: true,
            types: ['person', 'project', 'interaction'], // task not included
            minConfidence: 0.7
          }
        }
      );
      expect(linked).toBe(0);

      const count = await database.pool.query<{ count: string }>(
        "SELECT count(*)::text FROM entities WHERE type = 'task'"
      );
      expect(Number(count.rows[0]?.count)).toBe(0);
    }, 120_000);

    it('inherits visibility and owner from the source entity', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory',
        content: '1:1 notes mentioning Alice',
        visibility: 'personal',
        owner: 'ivo'
      }))._unsafeUnwrap();

      const mockLlm = () =>
        Promise.resolve(
          JSON.stringify([
            { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.95 }
          ])
        );

      await extractAndLinkRelationships(
        database.pool,
        auth,
        {
          id: source.id,
          type: source.type,
          content: source.content!,
          visibility: source.visibility,
          owner: source.owner
        },
        {
          callLlm: mockLlm,
          autoCreate: {
            enabled: true,
            types: ['person', 'project', 'interaction'],
            minConfidence: 0.7
          }
        }
      );

      const rows = await database.pool.query<{
        visibility: string;
        owner: string | null;
      }>(
        "SELECT visibility, owner FROM entities WHERE type = 'person'"
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toEqual({ visibility: 'personal', owner: 'ivo' });
    }, 120_000);

    it('dedupes repeated mentions within a single extraction pass', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory',
        content: 'Alice reviewed Alice_s draft and Alice approved it'
      }))._unsafeUnwrap();

      const mockLlm = () =>
        Promise.resolve(
          JSON.stringify([
            { target_name: 'Alice', target_type: 'person', relation: 'involves',     confidence: 0.95 },
            { target_name: 'Alice', target_type: 'person', relation: 'assigned_to',  confidence: 0.9 },
            { target_name: 'Alice', target_type: 'person', relation: 'mentioned_in', confidence: 0.85 }
          ])
        );

      const linked = await extractAndLinkRelationships(
        database.pool,
        auth,
        {
          id: source.id,
          type: source.type,
          content: source.content!,
          visibility: source.visibility,
          owner: source.owner
        },
        {
          callLlm: mockLlm,
          autoCreate: {
            enabled: true,
            types: ['person', 'project', 'interaction'],
            minConfidence: 0.7
          }
        }
      );
      expect(linked).toBe(3);

      const count = await database.pool.query<{ count: string }>(
        "SELECT count(*)::text FROM entities WHERE type = 'person'"
      );
      expect(Number(count.rows[0]?.count)).toBe(1);
    }, 120_000);
  });
});
