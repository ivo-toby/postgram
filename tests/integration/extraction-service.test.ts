import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chunkText } from '../../src/services/chunking-service.js';
import {
  createEmbeddingService,
  vectorToSql,
  type EmbeddingService
} from '../../src/services/embedding-service.js';
import { extractAndLinkRelationships } from '../../src/services/extraction-service.js';
import { storeEntity } from '../../src/services/entity-service.js';
import { listEdges } from '../../src/services/edge-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import type { Entity } from '../../src/types/entities.js';
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

// The extraction service now matches targets by vector similarity against
// existing chunks. In production this is populated by the enrichment
// worker; for tests we seed it directly so each `it` block stays focused
// on the extraction behaviour rather than the full enrichment pipeline.
async function seedChunksFor(
  pool: Pool,
  embeddingService: EmbeddingService,
  entity: Pick<Entity, 'id' | 'content'>
): Promise<void> {
  const content = entity.content ?? '';
  const drafts = chunkText(content);
  if (drafts.length === 0) return;
  const modelResult = await pool.query<{ id: string }>(
    `SELECT id FROM embedding_models WHERE is_active = true LIMIT 1`
  );
  const modelId = modelResult.rows[0]?.id;
  if (!modelId) throw new Error('no active embedding model in test db');

  const embeddings = await embeddingService.embedBatch(
    drafts.map((d) => d.content)
  );

  for (const draft of drafts) {
    const embedding = embeddings[draft.chunkIndex];
    if (!embedding) throw new Error('missing embedding for chunk');
    await pool.query(
      `
        INSERT INTO chunks (entity_id, chunk_index, content, embedding, model_id, token_count)
        VALUES ($1, $2, $3, $4::vector, $5, $6)
      `,
      [
        entity.id,
        draft.chunkIndex,
        draft.content,
        vectorToSql(embedding),
        modelId,
        draft.tokenCount
      ]
    );
  }
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

  it('creates edges when semantic match clears the similarity threshold', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();
    const embeddingService = createEmbeddingService();

    // Content is deliberately the same single token as the target name so
    // the deterministic test embedder yields cosine similarity ≈ 1.0.
    // Real-world embedders tolerate much looser matches.
    const alice = (await storeEntity(database.pool, auth, {
      type: 'person', content: 'Alice', metadata: { title: 'Alice' }
    }))._unsafeUnwrap();
    await seedChunksFor(database.pool, embeddingService, alice);

    const projectAlpha = (await storeEntity(database.pool, auth, {
      type: 'project', content: 'Project Alpha',
      metadata: { title: 'Project Alpha' }
    }))._unsafeUnwrap();
    await seedChunksFor(database.pool, embeddingService, projectAlpha);

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
      { callLlm: mockLlm, embeddingService, matchMinSimilarity: 0.5 }
    );

    expect(linked).toBe(2);

    const edges = await listEdges(database.pool, auth, source.id);
    expect(edges.isOk()).toBe(true);
    expect(edges._unsafeUnwrap()).toHaveLength(2);
    expect(edges._unsafeUnwrap().map((e) => e.relation).sort()).toEqual(['involves', 'part_of']);
  }, 120_000);

  it('skips matches whose similarity is below the threshold', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();
    const embeddingService = createEmbeddingService();

    // Entity content shares no tokens with the target name, so under the
    // deterministic embedder cosine ≈ 0 — well below any sane threshold.
    const unrelated = (await storeEntity(database.pool, auth, {
      type: 'person', content: 'entirely unrelated content xyzzy',
      metadata: { title: 'Unrelated' }
    }))._unsafeUnwrap();
    await seedChunksFor(database.pool, embeddingService, unrelated);

    const source = (await storeEntity(database.pool, auth, {
      type: 'memory', content: 'Memo mentioning someone called Alice'
    }))._unsafeUnwrap();

    const mockLlm = () => Promise.resolve(JSON.stringify([
      { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.9 }
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
      { callLlm: mockLlm, embeddingService, matchMinSimilarity: 0.5 }
    );

    expect(linked).toBe(0);
  }, 120_000);

  it('still links via chunks when the LLM omits target_type (schema-less providers)', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();
    const embeddingService = createEmbeddingService();

    const bob = (await storeEntity(database.pool, auth, {
      type: 'person', content: 'Bob Smith',
      metadata: { title: 'Bob Smith' }
    }))._unsafeUnwrap();
    await seedChunksFor(database.pool, embeddingService, bob);

    const source = (await storeEntity(database.pool, auth, {
      type: 'memory', content: 'Bob Smith joined the review'
    }))._unsafeUnwrap();

    // Provider (e.g. OpenAI without structured-output JSON) returns no
    // target_type. Extraction must still be able to resolve `Bob` → Bob Smith
    // via the chunk-stage match, since the type filter is relaxed when the
    // target_type is unknown.
    const mockLlm = () => Promise.resolve(JSON.stringify([
      { target_name: 'Bob', relation: 'involves', confidence: 0.9 }
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
      { callLlm: mockLlm, embeddingService, matchMinSimilarity: 0.5 }
    );

    expect(linked).toBe(1);
  }, 120_000);

  it('matches an existing entity with no title and no chunks yet (exact content)', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();
    const embeddingService = createEmbeddingService();

    // A freshly-stored entity whose enrichment has not yet run: no title in
    // metadata, no chunks in the DB. Matching must still work for these —
    // auto-created stubs and user-stored entities both fall into this state
    // briefly.
    (await storeEntity(database.pool, auth, {
      type: 'person', content: 'Alice'
    }))._unsafeUnwrap();

    const source = (await storeEntity(database.pool, auth, {
      type: 'memory', content: 'Alice helped review the design'
    }))._unsafeUnwrap();

    const mockLlm = () => Promise.resolve(JSON.stringify([
      { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.9 }
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
      { callLlm: mockLlm, embeddingService, matchMinSimilarity: 0.5 }
    );

    expect(linked).toBe(1);
    const edges = await listEdges(database.pool, auth, source.id);
    expect(edges._unsafeUnwrap()).toHaveLength(1);
  }, 120_000);

  it('chunk-stage match filters by target_type (no cross-type hub links)', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();
    const embeddingService = createEmbeddingService();

    // Title and content are intentionally *not* exactly "Alice", so stage 1
    // (exact title/content match) misses. The chunk similarity "Alice" vs
    // "Alice Person" is ~0.71 under the deterministic embedder — well above
    // threshold — so the only thing preventing a match is the type filter
    // on the chunk-stage query.
    const wrongType = (await storeEntity(database.pool, auth, {
      type: 'project', content: 'Alice Person',
      metadata: { title: 'Alice Person' }
    }))._unsafeUnwrap();
    await seedChunksFor(database.pool, embeddingService, wrongType);

    const source = (await storeEntity(database.pool, auth, {
      type: 'memory', content: 'Alice reviewed the draft'
    }))._unsafeUnwrap();

    const mockLlm = () => Promise.resolve(JSON.stringify([
      { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.95 }
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
      { callLlm: mockLlm, embeddingService, matchMinSimilarity: 0.5 }
    );

    expect(linked).toBe(0);
  }, 120_000);

  it('skips extraction (and does not call the LLM) when content is below minContentChars', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();
    const embeddingService = createEmbeddingService();

    const source = (await storeEntity(database.pool, auth, {
      type: 'memory', content: 'tiny'
    }))._unsafeUnwrap();

    let llmCalls = 0;
    const mockLlm = () => {
      llmCalls += 1;
      return Promise.resolve(JSON.stringify([
        { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.95 }
      ]));
    };

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
      { callLlm: mockLlm, embeddingService, matchMinSimilarity: 0.5, minContentChars: 80 }
    );

    expect(linked).toBe(0);
    expect(llmCalls).toBe(0);
  }, 120_000);

  it('treats whitespace-only padding as below minContentChars', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();
    const embeddingService = createEmbeddingService();

    const source = (await storeEntity(database.pool, auth, {
      type: 'memory', content: '   \n\nhi\n   '
    }))._unsafeUnwrap();

    let llmCalls = 0;
    const mockLlm = () => {
      llmCalls += 1;
      return Promise.resolve(JSON.stringify([]));
    };

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
      { callLlm: mockLlm, embeddingService, matchMinSimilarity: 0.5, minContentChars: 20 }
    );
    expect(llmCalls).toBe(0);
  }, 120_000);

  describe('debugLog diagnostic callback', () => {
    it('emits llm_response and a matched_existing decision', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();
      const embeddingService = createEmbeddingService();

      const alice = (await storeEntity(database.pool, auth, {
        type: 'person', content: 'Alice', metadata: { title: 'Alice' }
      }))._unsafeUnwrap();
      await seedChunksFor(database.pool, embeddingService, alice);

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory',
        content: 'Alice helped review the design and approved the change'
      }))._unsafeUnwrap();

      const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
      const debugLog = (event: string, payload: Record<string, unknown>) => {
        events.push({ event, payload });
      };

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
        { callLlm: mockLlm, embeddingService, matchMinSimilarity: 0.5, debugLog }
      );

      const response = events.find((e) => e.event === 'extraction.llm_response');
      expect(response).toBeDefined();
      expect(response!.payload).toMatchObject({
        entityId: source.id,
        parsedCount: 1
      });

      const decision = events.find((e) => e.event === 'extraction.decision');
      expect(decision).toBeDefined();
      expect(decision!.payload).toMatchObject({
        entityId: source.id,
        target: 'Alice',
        decision: 'matched_existing'
      });
    }, 120_000);

    it('emits skipped_below_confidence when per-type floor blocks auto-create', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();
      const embeddingService = createEmbeddingService();

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory',
        content: 'Quick note that mentions Alice in passing'
      }))._unsafeUnwrap();

      const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
      const debugLog = (event: string, payload: Record<string, unknown>) => {
        events.push({ event, payload });
      };

      const mockLlm = () =>
        Promise.resolve(
          JSON.stringify([
            { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.4 }
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
          embeddingService,
          matchMinSimilarity: 0.5,
          autoCreate: {
            enabled: true,
            types: ['person'],
            minConfidence: 0.7,
            minConfidenceByType: { person: 0.5 }
          },
          debugLog
        }
      );

      const decision = events.find((e) => e.event === 'extraction.decision');
      expect(decision!.payload).toMatchObject({
        decision: 'skipped_below_confidence',
        target: 'Alice',
        confidence: 0.4,
        requiredConfidence: 0.5
      });
    }, 120_000);

    it('emits skipped_type_not_allowed and skipped_auto_create_disabled per scenario', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();
      const embeddingService = createEmbeddingService();

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory',
        content: 'Alice and a task called Run tests are mentioned here'
      }))._unsafeUnwrap();

      const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
      const debugLog = (event: string, payload: Record<string, unknown>) => {
        events.push({ event, payload });
      };

      const mockLlm = () =>
        Promise.resolve(
          JSON.stringify([
            { target_name: 'Run tests', target_type: 'task', relation: 'mentioned_in', confidence: 0.95 },
            { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.95 }
          ])
        );

      // First call: auto-create disabled → both should emit skipped_auto_create_disabled
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
        { callLlm: mockLlm, embeddingService, matchMinSimilarity: 0.5, debugLog }
      );

      expect(
        events.filter(
          (e) =>
            e.event === 'extraction.decision' &&
            e.payload.decision === 'skipped_auto_create_disabled'
        )
      ).toHaveLength(2);

      // Second call: enable auto-create but exclude `task` → task should
      // emit skipped_type_not_allowed, person should auto-create.
      events.length = 0;
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
          embeddingService,
          matchMinSimilarity: 0.5,
          autoCreate: {
            enabled: true,
            types: ['person'],
            minConfidence: 0.7
          },
          debugLog
        }
      );

      const taskDecision = events.find(
        (e) =>
          e.event === 'extraction.decision' && e.payload.target === 'Run tests'
      );
      expect(taskDecision!.payload).toMatchObject({
        decision: 'skipped_type_not_allowed'
      });
      expect(taskDecision!.payload.allowedTypes).toEqual(['person']);

      const personDecision = events.find(
        (e) =>
          e.event === 'extraction.decision' && e.payload.target === 'Alice'
      );
      expect(personDecision!.payload).toMatchObject({
        decision: 'auto_created'
      });
    }, 120_000);

    it('emits skipped_min_chars when content is below the threshold', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();
      const embeddingService = createEmbeddingService();

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory', content: 'tiny'
      }))._unsafeUnwrap();

      const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
      const debugLog = (event: string, payload: Record<string, unknown>) => {
        events.push({ event, payload });
      };

      const mockLlm = () => Promise.resolve('[]');

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
          embeddingService,
          matchMinSimilarity: 0.5,
          minContentChars: 80,
          debugLog
        }
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event: 'extraction.skipped_min_chars',
        payload: { entityId: source.id, contentChars: 4, minContentChars: 80 }
      });
    }, 120_000);
  });

  it('preserves the new relation vocabulary on extracted edges', async () => {
    if (!database) throw new Error('test database not initialized');
    const auth = makeAuthContext();
    const embeddingService = createEmbeddingService();

    const target = (await storeEntity(database.pool, auth, {
      type: 'document', content: 'ADR-012',
      metadata: { title: 'ADR-012' }
    }))._unsafeUnwrap();
    await seedChunksFor(database.pool, embeddingService, target);

    const source = (await storeEntity(database.pool, auth, {
      type: 'document',
      content: 'ADR-013 supersedes the earlier ADR-012 decision on auth'
    }))._unsafeUnwrap();

    const mockLlm = () => Promise.resolve(JSON.stringify([
      { target_name: 'ADR-012', target_type: 'document', relation: 'supersedes', confidence: 0.95 }
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
      { callLlm: mockLlm, embeddingService, matchMinSimilarity: 0.5 }
    );
    expect(linked).toBe(1);

    const edges = await listEdges(database.pool, auth, source.id);
    expect(edges._unsafeUnwrap()[0]?.relation).toBe('supersedes');
  }, 120_000);

  describe('auto-create entities', () => {
    it('skips missing targets when auto-create is disabled (default)', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();
      const embeddingService = createEmbeddingService();

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
        { callLlm: mockLlm, embeddingService, matchMinSimilarity: 0.5 }
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
      const embeddingService = createEmbeddingService();

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
          embeddingService,
          matchMinSimilarity: 0.5,
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
      const embeddingService = createEmbeddingService();

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
          embeddingService,
          matchMinSimilarity: 0.5,
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
      const embeddingService = createEmbeddingService();

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
          embeddingService,
          matchMinSimilarity: 0.5,
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
      const embeddingService = createEmbeddingService();

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
          embeddingService,
          matchMinSimilarity: 0.5,
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

    it('uses minConfidenceByType when present (lets first-mention persons through)', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();
      const embeddingService = createEmbeddingService();

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory',
        content: 'Quick note that mentions Alice'
      }))._unsafeUnwrap();

      // 0.55 is below the global 0.7 floor but above the per-type 0.5 floor
      // for `person`. This is the production scenario the issue describes:
      // first-mention persons emit at 0.5–0.7 and would otherwise never
      // become nodes.
      const mockLlm = () =>
        Promise.resolve(
          JSON.stringify([
            { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.55 }
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
          embeddingService,
          matchMinSimilarity: 0.5,
          autoCreate: {
            enabled: true,
            types: ['person', 'project', 'interaction'],
            minConfidence: 0.7,
            minConfidenceByType: { person: 0.5 }
          }
        }
      );
      expect(linked).toBe(1);

      const count = await database.pool.query<{ count: string }>(
        "SELECT count(*)::text FROM entities WHERE type = 'person'"
      );
      expect(Number(count.rows[0]?.count)).toBe(1);
    }, 120_000);

    it('still rejects below the per-type floor', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();
      const embeddingService = createEmbeddingService();

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory',
        content: 'Vague reference to someone called Alice'
      }))._unsafeUnwrap();

      const mockLlm = () =>
        Promise.resolve(
          JSON.stringify([
            { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.4 }
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
          embeddingService,
          matchMinSimilarity: 0.5,
          autoCreate: {
            enabled: true,
            types: ['person', 'project', 'interaction'],
            minConfidence: 0.7,
            minConfidenceByType: { person: 0.5 }
          }
        }
      );
      expect(linked).toBe(0);
    }, 120_000);

    it('falls back to global minConfidence for types without an override', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();
      const embeddingService = createEmbeddingService();

      const source = (await storeEntity(database.pool, auth, {
        type: 'memory',
        content: 'Reference to the Alpha initiative'
      }))._unsafeUnwrap();

      const mockLlm = () =>
        Promise.resolve(
          JSON.stringify([
            { target_name: 'Alpha', target_type: 'project', relation: 'part_of', confidence: 0.65 }
          ])
        );

      // No `project` override → falls back to global 0.7. 0.65 < 0.7, so no
      // edge.
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
          embeddingService,
          matchMinSimilarity: 0.5,
          autoCreate: {
            enabled: true,
            types: ['person', 'project'],
            minConfidence: 0.7,
            minConfidenceByType: { person: 0.5 }
          }
        }
      );
      expect(linked).toBe(0);
    }, 120_000);

    it('dedupes repeated mentions within a single extraction pass', async () => {
      if (!database) throw new Error('test database not initialized');
      const auth = makeAuthContext();
      const embeddingService = createEmbeddingService();

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
          embeddingService,
          matchMinSimilarity: 0.5,
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
