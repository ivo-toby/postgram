import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import { createEdge } from '../../src/services/edge-service.js';
import { searchEntities } from '../../src/services/search-service.js';
import { softDeleteEntity, storeEntity } from '../../src/services/entity-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000104',
    keyName: 'search-key',
    clientId: 'search-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

describe('search-service', () => {
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
      id: '00000000-0000-0000-0000-000000000104',
      name: 'search-key'
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('returns no vector results before enrichment completes', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'postgres vector search for work notes',
      tags: ['search']
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: 'vector search notes'
      },
      {
        embeddingService: createEmbeddingService()
      }
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().results).toHaveLength(0);
  }, 120_000);

  it('boosts exact keyword matches via hybrid BM25+vector scoring', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'pgvector lets postgres do vector search without a separate service',
      tags: ['database']
    });
    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'relational databases handle structured data well',
      tags: ['database']
    });

    const embeddingService = createEmbeddingService();
    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    });
    await worker.runOnce();

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      { query: 'pgvector' },
      { embeddingService }
    );

    expect(result.isOk()).toBe(true);
    const results = result._unsafeUnwrap().results;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.entity.content).toContain('pgvector');
  }, 120_000);

  it('returns enriched entities ranked by similarity with filters', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'postgres vector search for work notes',
      tags: ['search', 'postgres']
    });
    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'gardening checklist for spring herbs',
      tags: ['garden']
    });

    const embeddingService = createEmbeddingService();
    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    });
    await worker.runOnce();

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: 'postgres search',
        tags: ['search']
      },
      {
        embeddingService
      }
    );

    expect(result.isOk()).toBe(true);
    const [firstResult] = result._unsafeUnwrap().results;
    expect(firstResult).toBeDefined();
    expect(firstResult?.entity.type).toBe('memory');
    expect(firstResult?.chunkContent).toContain('postgres');
    expect(typeof firstResult?.similarity).toBe('number');
    expect(typeof firstResult?.score).toBe('number');
    expect(result._unsafeUnwrap().results).toHaveLength(1);
  }, 120_000);

  it('respects explicit visibility filters', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'postgres notes shared with everyone',
      tags: ['search'],
      visibility: 'shared'
    });
    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'postgres notes only for work',
      tags: ['search'],
      visibility: 'work'
    });

    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    });
    await worker.runOnce();

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: 'postgres notes',
        visibility: 'work' as never,
        threshold: 0
      },
      { embeddingService }
    );

    expect(result.isOk()).toBe(true);
    const results = result._unsafeUnwrap().results;
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((entry) => entry.entity.visibility === 'work')).toBe(true);
  }, 120_000);

  it('filters session-context search to the caller client', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();
    const auth = makeAuthContext();

    await storeEntity(database.pool, { ...auth, clientId: 'codex' }, {
      type: 'memory',
      visibility: 'personal',
      content: 'Memory lifecycle roles discussion for Codex.',
      tags: ['session-context'],
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'codex' }
      }
    });

    await storeEntity(database.pool, { ...auth, clientId: 'talon' }, {
      type: 'memory',
      visibility: 'personal',
      content: 'Memory lifecycle roles discussion for Talon.',
      tags: ['session-context'],
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'talon' }
      }
    });

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const result = await searchEntities(
      database.pool,
      { ...auth, clientId: 'codex' },
      {
        query: 'memory lifecycle roles discussion',
        type: 'memory',
        memoryRole: 'session_context',
        threshold: 0,
        limit: 10
      },
      { embeddingService }
    );

    expect(result.isOk()).toBe(true);
    const contents = result._unsafeUnwrap().results.map((entry) => entry.entity.content);
    expect(contents).toContain('Memory lifecycle roles discussion for Codex.');
    expect(contents).not.toContain('Memory lifecycle roles discussion for Talon.');
  }, 120_000);

  it('limits memory role search filters to memory entities', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();
    const auth = makeAuthContext();

    await storeEntity(database.pool, auth, {
      type: 'memory',
      visibility: 'personal',
      content: 'Durable memory role filter search target.',
      metadata: { memory_role: 'durable_memory' }
    });
    await storeEntity(database.pool, auth, {
      type: 'document',
      visibility: 'personal',
      content: 'Document role filter search target.'
    });

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const result = await searchEntities(
      database.pool,
      auth,
      {
        query: 'role filter search target',
        memoryRole: 'durable_memory',
        threshold: 0,
        limit: 10
      },
      { embeddingService }
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().results.map((entry) => entry.entity.type)).toEqual([
      'memory'
    ]);
  }, 120_000);

  it('keeps other clients session context out of unfiltered memory search', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();
    const auth = makeAuthContext();

    await storeEntity(database.pool, auth, {
      type: 'memory',
      visibility: 'personal',
      content: 'Durable memory lifecycle roles decision.',
      metadata: { memory_role: 'durable_memory' }
    });

    await storeEntity(database.pool, { ...auth, clientId: 'codex' }, {
      type: 'memory',
      visibility: 'personal',
      content: 'Codex session context about memory lifecycle roles.',
      tags: ['session-context'],
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'codex' }
      }
    });

    await storeEntity(database.pool, { ...auth, clientId: 'talon' }, {
      type: 'memory',
      visibility: 'personal',
      content: 'Talon session context about memory lifecycle roles.',
      tags: ['session-context'],
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'talon' }
      }
    });

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const result = await searchEntities(
      database.pool,
      { ...auth, clientId: 'codex' },
      {
        query: 'memory lifecycle roles',
        type: 'memory',
        threshold: 0,
        limit: 10
      },
      { embeddingService }
    );

    expect(result.isOk()).toBe(true);
    const contents = result._unsafeUnwrap().results.map((entry) => entry.entity.content);
    expect(contents).toContain('Durable memory lifecycle roles decision.');
    expect(contents).toContain('Codex session context about memory lifecycle roles.');
    expect(contents).not.toContain('Talon session context about memory lifecycle roles.');
  }, 120_000);

  it('filters scoped durable memories to the authenticated client while keeping unscoped durable memories global', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();
    const auth = makeAuthContext();

    await storeEntity(database.pool, { ...auth, clientId: 'codex' }, {
      type: 'memory',
      visibility: 'personal',
      content: 'Scoped durable memory for Codex only.',
      metadata: {
        memory_role: 'durable_memory',
        session_scope: { kind: 'client', client_id: 'codex' }
      }
    });

    await storeEntity(database.pool, { ...auth, clientId: 'talon' }, {
      type: 'memory',
      visibility: 'personal',
      content: 'Global durable memory for everyone.',
      metadata: {
        memory_role: 'durable_memory'
      }
    });

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const codexSearch = await searchEntities(
      database.pool,
      { ...auth, clientId: 'codex' },
      {
        query: 'durable memory',
        type: 'memory',
        threshold: 0,
        limit: 10
      },
      { embeddingService }
    );

    expect(codexSearch.isOk()).toBe(true);
    const codexContents = codexSearch._unsafeUnwrap().results.map((entry) => entry.entity.content);
    expect(codexContents).toContain('Scoped durable memory for Codex only.');
    expect(codexContents).toContain('Global durable memory for everyone.');

    const talonSearch = await searchEntities(
      database.pool,
      { ...auth, clientId: 'talon' },
      {
        query: 'durable memory',
        type: 'memory',
        threshold: 0,
        limit: 10
      },
      { embeddingService }
    );

    expect(talonSearch.isOk()).toBe(true);
    const talonContents = talonSearch._unsafeUnwrap().results.map((entry) => entry.entity.content);
    expect(talonContents).toContain('Global durable memory for everyone.');
    expect(talonContents).not.toContain('Scoped durable memory for Codex only.');
  }, 120_000);

  it('keeps other clients session context out of graph-expanded search results', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();
    const auth = makeAuthContext();

    const durable = (await storeEntity(database.pool, auth, {
      type: 'memory',
      visibility: 'personal',
      content: 'Durable graph expansion anchor for session scope.'
    }))._unsafeUnwrap();

    const ownContext = (await storeEntity(database.pool, { ...auth, clientId: 'codex' }, {
      type: 'memory',
      visibility: 'personal',
      content: 'Codex private working context.',
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'codex' }
      }
    }))._unsafeUnwrap();

    const otherContext = (await storeEntity(database.pool, { ...auth, clientId: 'talon' }, {
      type: 'memory',
      visibility: 'personal',
      content: 'Talon private working context.',
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'talon' }
      }
    }))._unsafeUnwrap();

    expect((await createEdge(database.pool, auth, {
      sourceId: durable.id,
      targetId: ownContext.id,
      relation: 'related_to'
    })).isOk()).toBe(true);
    expect((await createEdge(database.pool, auth, {
      sourceId: durable.id,
      targetId: otherContext.id,
      relation: 'related_to'
    })).isOk()).toBe(true);

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const result = await searchEntities(
      database.pool,
      { ...auth, clientId: 'codex' },
      {
        query: 'durable graph expansion anchor',
        type: 'memory',
        threshold: 0,
        limit: 10,
        expandGraph: true
      },
      { embeddingService }
    );

    expect(result.isOk()).toBe(true);
    const durableResult = result
      ._unsafeUnwrap()
      .results.find((entry) => entry.entityId === durable.id);
    expect(durableResult).toBeDefined();
    const relatedIds = durableResult?.related?.map((entry) => entry.entity.id) ?? [];
    expect(relatedIds).toContain(ownContext.id);
    expect(relatedIds).not.toContain(otherContext.id);
  }, 120_000);

  it('keeps scoped durable memories out of graph-expanded search results for other clients', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();
    const auth = makeAuthContext();

    const durable = (await storeEntity(database.pool, auth, {
      type: 'memory',
      visibility: 'personal',
      content: 'Durable graph expansion anchor for durable scope.'
    }))._unsafeUnwrap();

    const scopedDurable = (await storeEntity(database.pool, { ...auth, clientId: 'codex' }, {
      type: 'memory',
      visibility: 'personal',
      content: 'Codex scoped durable graph neighbor.',
      metadata: {
        memory_role: 'durable_memory',
        session_scope: { kind: 'client', client_id: 'codex' }
      }
    }))._unsafeUnwrap();

    const otherScopedDurable = (await storeEntity(database.pool, { ...auth, clientId: 'talon' }, {
      type: 'memory',
      visibility: 'personal',
      content: 'Talon scoped durable graph neighbor.',
      metadata: {
        memory_role: 'durable_memory',
        session_scope: { kind: 'client', client_id: 'talon' }
      }
    }))._unsafeUnwrap();

    expect((await createEdge(database.pool, auth, {
      sourceId: durable.id,
      targetId: scopedDurable.id,
      relation: 'related_to'
    })).isOk()).toBe(true);
    expect((await createEdge(database.pool, auth, {
      sourceId: durable.id,
      targetId: otherScopedDurable.id,
      relation: 'related_to'
    })).isOk()).toBe(true);

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const result = await searchEntities(
      database.pool,
      { ...auth, clientId: 'codex' },
      {
        query: 'durable graph expansion anchor',
        type: 'memory',
        threshold: 0,
        limit: 10,
        expandGraph: true
      },
      { embeddingService }
    );

    expect(result.isOk()).toBe(true);
    const durableResult = result
      ._unsafeUnwrap()
      .results.find((entry) => entry.entityId === durable.id);
    expect(durableResult).toBeDefined();
    const relatedIds = durableResult?.related?.map((entry) => entry.entity.id) ?? [];
    expect(relatedIds).toContain(scopedDurable.id);
    expect(relatedIds).not.toContain(otherScopedDurable.id);
  }, 120_000);

  it('excludes archived entities from search by default', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();

    const stored = await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'archived entity about quantum computing research',
      tags: ['science']
    });
    expect(stored.isOk()).toBe(true);
    const entityId = stored._unsafeUnwrap().id;

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'active entity about quantum computing research',
      tags: ['science']
    });

    const worker = createEnrichmentWorker({ pool: database.pool, embeddingService });
    await worker.runOnce();

    expect((await softDeleteEntity(database.pool, makeAuthContext(), entityId)).isOk()).toBe(true);

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      { query: 'quantum computing research', threshold: 0 },
      { embeddingService }
    );

    expect(result.isOk()).toBe(true);
    const results = result._unsafeUnwrap().results;
    expect(results.every((r) => r.entityId !== entityId)).toBe(true);
    expect(results.some((r) => r.entity.content?.includes('active entity'))).toBe(true);
  }, 120_000);

  it('includes archived entities in search when includeArchived is true', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService();

    const stored = await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'archived entity about quantum computing research',
      tags: ['science']
    });
    expect(stored.isOk()).toBe(true);
    const entityId = stored._unsafeUnwrap().id;

    const worker = createEnrichmentWorker({ pool: database.pool, embeddingService });
    await worker.runOnce();

    expect((await softDeleteEntity(database.pool, makeAuthContext(), entityId)).isOk()).toBe(true);

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      { query: 'quantum computing research', threshold: 0, includeArchived: true },
      { embeddingService }
    );

    expect(result.isOk()).toBe(true);
    const results = result._unsafeUnwrap().results;
    expect(results.some((r) => r.entityId === entityId)).toBe(true);
  }, 120_000);

  it('returns EMBEDDING_FAILED when query embedding fails', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const goodEmbeddingService = createEmbeddingService();

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'kubernetes deployment strategies for production',
      tags: ['infra']
    });

    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService: goodEmbeddingService
    });
    await worker.runOnce();

    const failingEmbeddingService = createEmbeddingService({
      embedQuery: () => Promise.reject(new Error('OpenAI is down')),
      embedBatch: () => Promise.reject(new Error('OpenAI is down'))
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      { query: 'kubernetes', threshold: 0 },
      { embeddingService: failingEmbeddingService }
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('EMBEDDING_FAILED');
  }, 120_000);
});
