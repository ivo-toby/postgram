import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createEmbeddingService,
  pruneQueryEmbeddingCache,
  vectorToSql
} from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import { createEdge } from '../../src/services/edge-service.js';
import { searchEntities } from '../../src/services/search-service.js';
import {
  softDeleteEntity,
  storeEntity
} from '../../src/services/entity-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import type { EntityType, Visibility } from '../../src/types/entities.js';
import { ErrorCode } from '../../src/util/errors.js';
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

function unitVector(first: number, second = 0): number[] {
  const vector = new Array<number>(1536).fill(0);
  vector[0] = first;
  vector[1] = second;
  return vector;
}

function lowSimilarityVector(similarity = 0.1): number[] {
  return unitVector(similarity, Math.sqrt(1 - similarity ** 2));
}

type SearchFixtureInput = {
  entityContent: string;
  chunkContent: string;
  embedding?: number[];
  type?: EntityType;
  visibility?: Visibility;
  owner?: string | null;
  status?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: Date;
};

type SearchFixtureOverrides = Omit<
  SearchFixtureInput,
  'entityContent' | 'chunkContent'
>;

async function insertSearchFixture(
  pool: TestDatabase['pool'],
  input: SearchFixtureInput
): Promise<string> {
  const entityId = crypto.randomUUID();
  const createdAt = input.createdAt ?? new Date('2026-10-14T12:00:00.000Z');
  await pool.query(
    `INSERT INTO entities (
       id,
       type,
       content,
       visibility,
       owner,
       status,
       enrichment_status,
       tags,
       metadata,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8::jsonb, $9, $9)`,
    [
      entityId,
      input.type ?? 'memory',
      input.entityContent,
      input.visibility ?? 'shared',
      input.owner ?? null,
      input.status ?? 'active',
      input.tags ?? [],
      JSON.stringify(input.metadata ?? {}),
      createdAt
    ]
  );

  await pool.query(
    `INSERT INTO chunks (
       entity_id,
       chunk_index,
       content,
       embedding,
       model_id,
       token_count
     )
     VALUES (
       $1,
       0,
       $2,
       $3::vector,
       (SELECT id FROM embedding_models WHERE is_active = true),
       8
     )`,
    [
      entityId,
      input.chunkContent,
      vectorToSql(input.embedding ?? unitVector(1))
    ]
  );

  return entityId;
}

async function insertSearchDistractors(
  pool: TestDatabase['pool'],
  count: number,
  overrides: SearchFixtureOverrides = {}
): Promise<void> {
  await pool.query(
    `WITH rows AS (
       SELECT gen_random_uuid() AS id
       FROM generate_series(1, $8::integer)
     ), inserted AS (
       INSERT INTO entities (
         id,
         type,
         content,
         visibility,
         owner,
         status,
         enrichment_status,
         tags,
         metadata
       )
       SELECT
         id,
         $1,
         'vector distractor content only',
         $2,
         $3,
         $4,
         'completed',
         $5,
         $6::jsonb
       FROM rows
       RETURNING id
     )
     INSERT INTO chunks (
       entity_id,
       chunk_index,
       content,
       embedding,
       model_id,
       token_count
     )
     SELECT
       id,
       0,
       'vector distractor content only',
       $7::vector,
       (SELECT id FROM embedding_models WHERE is_active = true),
       6
     FROM inserted`,
    [
      overrides.type ?? 'memory',
      overrides.visibility ?? 'shared',
      overrides.owner ?? null,
      overrides.status ?? 'active',
      overrides.tags ?? ['allowed'],
      JSON.stringify(
        overrides.metadata ?? {
          memory_role: 'session_context',
          session_scope: { kind: 'client', client_id: 'codex' }
        }
      ),
      vectorToSql(overrides.embedding ?? lowSimilarityVector(0.7)),
      count
    ]
  );
}

async function insertCommonKeywordDistractors(
  pool: TestDatabase['pool'],
  count: number,
  content: string
): Promise<void> {
  await pool.query(
    `WITH rows AS (
       SELECT gen_random_uuid() AS id
       FROM generate_series(1, $1::integer)
     ), inserted AS (
       INSERT INTO entities (
         id,
         type,
         content,
         visibility,
         status,
         enrichment_status,
         tags,
         metadata
       )
       SELECT
         id,
         'memory',
         $2::text,
         'shared',
         'active',
         'completed',
         ARRAY[]::text[],
         '{}'::jsonb
       FROM rows
       RETURNING id
     )
     INSERT INTO chunks (
       entity_id,
       chunk_index,
       content,
       embedding,
       model_id,
       token_count
     )
     SELECT
       id,
       0,
       $2::text,
       $3::vector,
       (SELECT id FROM embedding_models WHERE is_active = true),
       6
     FROM inserted`,
    [count, content, vectorToSql(lowSimilarityVector(0.6))]
  );
}

function fixedEmbeddingService(
  queryVector: number[]
): ReturnType<typeof createEmbeddingService> {
  return createEmbeddingService({
    embedQuery: () => Promise.resolve(queryVector)
  });
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

  it('boosts exact keyword matches via hybrid RRF scoring', async () => {
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

  it.each(['exact', 'hnsw'] as const)(
    'finds a chunk keyword match outside the vector cap with the %s strategy',
    async (strategy) => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      for (let index = 0; index < 28; index += 1) {
        await insertSearchFixture(database.pool, {
          entityContent: `vector decoy ${index}`,
          chunkContent: `vector decoy chunk ${index}`,
          embedding: lowSimilarityVector(0.9)
        });
      }

      await insertSearchFixture(database.pool, {
        entityContent: 'A related identifier without the requested suffix.',
        chunkContent: Array.from(
          { length: 48 },
          () => 'release ID Q4 1140 incidental reference'
        ).join(' '),
        embedding: lowSimilarityVector(0.1)
      });

      const targetId = await insertSearchFixture(database.pool, {
        entityContent: 'Identifier details are stored in a separate section.',
        chunkContent: 'release-ID-Q4-114 candidate',
        embedding: unitVector(-1)
      });

      let selectedStrategy: string | undefined;
      const result = await searchEntities(
        database.pool,
        makeAuthContext(),
        {
          query: 'release-ID-Q4-114',
          limit: 1,
          threshold: 0.95
        },
        {
          embeddingService: fixedEmbeddingService(unitVector(1)),
          strategyOverride: strategy,
          onStrategy: (value) => {
            selectedStrategy = value;
          }
        }
      );

      expect(result.isOk()).toBe(true);
      expect(
        result._unsafeUnwrap().results.map((entry) => entry.entityId)
      ).toContain(targetId);
      expect(selectedStrategy).toBe(strategy === 'exact' ? 'exact' : 'hnsw');
    },
    120_000
  );

  it.each(['exact', 'hnsw'] as const)(
    'finds late exact identifiers at the 201-hit OR boundary with the %s strategy',
    async (strategy) => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      const cases = [
        {
          query: 'ticket ABC-1234',
          commonContent: 'ticket common identifier distractor',
          targetContent: 'ticket ABC-1234'
        },
        {
          query: 'order 998877665544332211',
          commonContent: 'order common identifier distractor',
          targetContent: 'order 998877665544332211'
        },
        {
          query: 'release-date ABC-1234',
          commonContent: 'release-date common identifier distractor',
          targetContent: 'release-date ABC-1234'
        }
      ];

      for (const testCase of cases) {
        await resetTestDatabase(database.pool);
        await seedApiKey(database.pool, {
          id: '00000000-0000-0000-0000-000000000104',
          name: 'search-key'
        });
        await insertSearchDistractors(database.pool, 28, { metadata: {} });
        await insertCommonKeywordDistractors(
          database.pool,
          200,
          testCase.commonContent
        );
        const targetId = await insertSearchFixture(database.pool, {
          entityContent: 'The requested identifier.',
          chunkContent: testCase.targetContent,
          embedding: lowSimilarityVector(0.1)
        });

        const result = await searchEntities(
          database.pool,
          makeAuthContext(),
          {
            query: testCase.query,
            limit: 1,
            threshold: 0.95
          },
          {
            embeddingService: fixedEmbeddingService(unitVector(1)),
            strategyOverride: strategy
          }
        );

        expect(result.isOk()).toBe(true);
        expect(
          result._unsafeUnwrap().results.map((entry) => entry.entityId)
        ).toContain(targetId);
      }
    },
    120_000
  );

  it.each(['exact', 'hnsw'] as const)(
    'prioritizes late all-term intersections over crowded per-term probes with the %s strategy',
    async (strategy) => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      const terms = [
        'saturated-alpha',
        'saturated-beta',
        'saturated-gamma'
      ];
      await insertSearchDistractors(database.pool, 120, { metadata: {} });
      for (const term of terms) {
        await insertCommonKeywordDistractors(
          database.pool,
          240,
          `${term} common-only distractor`
        );
      }

      const targetIds: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        targetIds.push(
          await insertSearchFixture(database.pool, {
            entityContent: 'Late all-term intersection target.',
            chunkContent: `${terms.join(' ')} intersection ${index}`,
            embedding: lowSimilarityVector(0.1)
          })
        );
      }

      const result = await searchEntities(
        database.pool,
        makeAuthContext(),
        {
          query: terms.join(' '),
          limit: 5,
          threshold: 0.95
        },
        {
          embeddingService: fixedEmbeddingService(unitVector(1)),
          strategyOverride: strategy
        }
      );

      expect(result.isOk()).toBe(true);
      expect(
        result._unsafeUnwrap().results.map((entry) => entry.entityId)
      ).toEqual(expect.arrayContaining(targetIds));
    },
    120_000
  );

  it('keeps a full conjunction at the keyword cap as the complete pool', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const terms = ['full-cap-alpha', 'full-cap-beta'];
    await insertSearchDistractors(database.pool, 21, { metadata: {} });
    await insertCommonKeywordDistractors(
      database.pool,
      200,
      `${terms.join(' ')} full conjunction distractor`
    );
    const partialId = await insertSearchFixture(database.pool, {
      entityContent: 'Partial full-cap candidate.',
      chunkContent: terms[0] ?? '',
      embedding: lowSimilarityVector(0.1)
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: terms.join(' '),
        limit: 1,
        threshold: 0.95
      },
      {
        embeddingService: fixedEmbeddingService(unitVector(1)),
        strategyOverride: 'exact'
      }
    );

    expect(result.isOk()).toBe(true);
    const results = result._unsafeUnwrap().results;
    expect(results).toHaveLength(1);
    expect(results[0]?.chunkContent).toContain(terms.join(' '));
    expect(results.map((entry) => entry.entityId)).not.toContain(partialId);
  }, 120_000);

  it.each(['exact', 'hnsw'] as const)(
    'admits a below-floor half-coverage vector candidate outside the keyword pool with the %s strategy',
    async (strategy) => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      const terms = [
        'coverage-alpha',
        'coverage-beta',
        'coverage-gamma',
        'coverage-delta'
      ];
      for (const term of terms.slice(0, 2)) {
        await insertCommonKeywordDistractors(
          database.pool,
          240,
          `${term} common-only distractor`
        );
      }
      const targetId = await insertSearchFixture(database.pool, {
        entityContent: 'Half coverage vector target.',
        chunkContent: `${terms[0]} ${terms[1]} partial intersection`,
        embedding: lowSimilarityVector(0.1)
      });

      let selectedStrategy: string | undefined;
      const result = await searchEntities(
        database.pool,
        makeAuthContext(),
        {
          query: terms.join(' '),
          limit: 25,
          threshold: 0.95
        },
        {
          embeddingService: fixedEmbeddingService(unitVector(1)),
          strategyOverride: strategy,
          onStrategy: (value) => {
            selectedStrategy = value;
          }
        }
      );

      expect(result.isOk()).toBe(true);
      expect(
        result._unsafeUnwrap().results.map((entry) => entry.entityId)
      ).toContain(targetId);
      expect(selectedStrategy).toBe(
        strategy === 'exact' ? 'exact' : 'hnsw_exact_fallback'
      );
    },
    120_000
  );

  it.each(['exact', 'hnsw'] as const)(
    'counts actual content coverage for a late partial keyword candidate with the %s strategy',
    async (strategy) => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      await insertSearchDistractors(database.pool, 21, { metadata: {} });
      await insertCommonKeywordDistractors(
        database.pool,
        220,
        'postgram common-only distractor'
      );
      const targetId = await insertSearchFixture(database.pool, {
        entityContent: 'Late partial coverage target.',
        chunkContent: 'postgram ranking',
        embedding: lowSimilarityVector(0.1)
      });

      const result = await searchEntities(
        database.pool,
        makeAuthContext(),
        {
          query: 'postgram search ranking',
          limit: 1,
          threshold: 0.95
        },
        {
          embeddingService: fixedEmbeddingService(unitVector(1)),
          strategyOverride: strategy
        }
      );

      expect(result.isOk()).toBe(true);
      expect(
        result._unsafeUnwrap().results.map((entry) => entry.entityId)
      ).toContain(targetId);
    },
    120_000
  );

  it.each([
    {
      name: 'common terms',
      terms: ['notes', 'project', 'migration'],
      matchingTerm: 'notes'
    },
    {
      name: 'Dutch terms',
      terms: ['de', 'zoekindex', 'ranking'],
      matchingTerm: 'de'
    },
    {
      name: 'generic terms',
      terms: ['generic', 'project', 'migration'],
      matchingTerm: 'generic'
    }
  ])(
    'rejects below-floor keyword candidates with less than half coverage for $name',
    async ({ terms, matchingTerm }) => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      await insertSearchFixture(database.pool, {
        entityContent: 'Insufficient coverage target.',
        chunkContent: `${matchingTerm} only`,
        embedding: lowSimilarityVector(0.1)
      });

      const result = await searchEntities(
        database.pool,
        makeAuthContext(),
        {
          query: terms.join(' '),
          limit: 1,
          threshold: 0.95
        },
        {
          embeddingService: fixedEmbeddingService(unitVector(1)),
          strategyOverride: 'exact'
        }
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().results).toHaveLength(0);
    },
    120_000
  );

  it('retrieves a partial match when it covers half the retained terms and no row matches all terms', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const terms = [
      'partial-alpha',
      'partial-beta',
      'partial-gamma',
      'partial-delta'
    ];
    await insertSearchDistractors(database.pool, 21, { metadata: {} });
    const targetId = await insertSearchFixture(database.pool, {
      entityContent: 'Partial coverage target.',
      chunkContent: `${terms[0]} ${terms[1]} only`,
      embedding: lowSimilarityVector(0.1)
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: terms.join(' '),
        limit: 1,
        threshold: 0.95
      },
      {
        embeddingService: fixedEmbeddingService(unitVector(1)),
        strategyOverride: 'exact'
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      result._unsafeUnwrap().results.map((entry) => entry.entityId)
    ).toEqual([targetId]);
  }, 120_000);

  it('requires coverage only from the first 24 distinct parsed terms', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const firstTerms = Array.from(
      { length: 24 },
      (_, index) => `important-${index}`
    );
    const query = [
      ...firstTerms,
      'tail-only-marker',
      ...Array.from({ length: 275 }, (_, index) => `tail-padding-${index}`)
    ].join(' ');
    const targetTerms = firstTerms.slice(0, 12);
    const targetId = await insertSearchFixture(database.pool, {
      entityContent: 'Retained keyword target.',
      chunkContent: targetTerms.join(' '),
      embedding: lowSimilarityVector(0.1)
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      { query, limit: 1, threshold: 0.95 },
      {
        embeddingService: fixedEmbeddingService(unitVector(1)),
        strategyOverride: 'exact'
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      result._unsafeUnwrap().results.map((entry) => entry.entityId)
    ).toEqual([targetId]);
  }, 120_000);

  it.each(['exact', 'hnsw'] as const)(
    'does not retrieve a tail-only keyword after the first 24 terms with the %s strategy',
    async (strategy) => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      const firstTerms = Array.from(
        { length: 24 },
        (_, index) => `important-${index}`
      );
      const query = [
        ...firstTerms,
        'tail-only-marker',
        ...Array.from({ length: 275 }, (_, index) => `tail-padding-${index}`)
      ].join(' ');
      await insertSearchDistractors(database.pool, 21, {
        embedding: lowSimilarityVector(0.9),
        metadata: {}
      });
      const targetId = await insertSearchFixture(database.pool, {
        entityContent: 'Tail keyword target.',
        chunkContent: 'tail-only-marker',
        embedding: lowSimilarityVector(0.8)
      });

      const result = await searchEntities(
        database.pool,
        makeAuthContext(),
        { query, limit: 1, threshold: 0.7 },
        {
          embeddingService: fixedEmbeddingService(unitVector(1)),
          strategyOverride: strategy
        }
      );

      expect(result.isOk()).toBe(true);
      expect(
        result._unsafeUnwrap().results.map((entry) => entry.entityId)
      ).not.toContain(targetId);
    },
    120_000
  );

  it('counts equivalent parsed terms once when retaining the 24th distinct term', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const query = [
      'DUPLICATE-MARKER',
      'duplicate-marker',
      ...Array.from({ length: 22 }, (_, index) => `distinct-${index}`),
      'retained-marker'
    ].join(' ');
    const targetId = await insertSearchFixture(database.pool, {
      entityContent: 'Retained duplicate accounting target.',
      chunkContent: [
        ...Array.from({ length: 11 }, (_, index) => `distinct-${index}`),
        'retained-marker'
      ].join(' '),
      embedding: lowSimilarityVector(0.1)
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      { query, limit: 1, threshold: 0.95 },
      {
        embeddingService: fixedEmbeddingService(unitVector(1)),
        strategyOverride: 'exact'
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      result._unsafeUnwrap().results.map((entry) => entry.entityId)
    ).toEqual([targetId]);
  }, 120_000);

  it('does not count standalone stopwords toward the 24-term keyword cap', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const query = [
      'the',
      'the',
      ...Array.from({ length: 23 }, (_, index) => `retained-${index}`),
      'retained-marker'
    ].join(' ');
    const targetId = await insertSearchFixture(database.pool, {
      entityContent: 'Stopword accounting target.',
      chunkContent: [
        ...Array.from({ length: 11 }, (_, index) => `retained-${index}`),
        'retained-marker'
      ].join(' '),
      embedding: lowSimilarityVector(0.1)
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      { query, limit: 1, threshold: 0.95 },
      {
        embeddingService: fixedEmbeddingService(unitVector(1)),
        strategyOverride: 'exact'
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      result._unsafeUnwrap().results.map((entry) => entry.entityId)
    ).toEqual([targetId]);
  }, 120_000);

  it.each(['exact', 'hnsw'] as const)(
    'admits a below-threshold vector match outside the keyword cap with the %s strategy',
    async (strategy) => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      const query = 'keyword-cap-marker';
      await insertCommonKeywordDistractors(
        database.pool,
        240,
        `${query} common distractor`
      );
      const targetId = await insertSearchFixture(database.pool, {
        entityContent: 'The late vector keyword target.',
        chunkContent: query,
        embedding: lowSimilarityVector(0.1)
      });

      const result = await searchEntities(
        database.pool,
        makeAuthContext(),
        {
          query,
          limit: 250,
          threshold: 0.95
        },
        {
          embeddingService: fixedEmbeddingService(unitVector(1)),
          strategyOverride: strategy
        }
      );

      expect(result.isOk()).toBe(true);
      expect(
        result._unsafeUnwrap().results.map((entry) => entry.entityId)
      ).toContain(targetId);
    },
    120_000
  );

  it('scores chunk content without leaking keywords from the whole entity', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await insertSearchFixture(database.pool, {
      entityContent:
        'The whole entity mentions whole-entity-secret in a distant section.',
      chunkContent: 'This chunk contains an unrelated paragraph.',
      embedding: lowSimilarityVector(0.1)
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: 'whole-entity-secret',
        threshold: 0.35,
        limit: 10
      },
      {
        embeddingService: fixedEmbeddingService(unitVector(1)),
        strategyOverride: 'exact'
      }
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().results).toHaveLength(0);
  }, 120_000);

  it('lets a low-vector keyword match pass threshold while rejecting a low-vector semantic candidate', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const keywordId = await insertSearchFixture(database.pool, {
      entityContent: 'A concise answer without the query lexemes.',
      chunkContent: 'threshold-marker appears only in this chunk.',
      embedding: lowSimilarityVector(0.1)
    });
    await insertSearchFixture(database.pool, {
      entityContent: 'A semantic neighbor without the query lexemes.',
      chunkContent: 'A semantic neighbor without the query lexemes.',
      embedding: lowSimilarityVector(0.7)
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: 'threshold-marker',
        threshold: 0.8,
        limit: 10
      },
      {
        embeddingService: fixedEmbeddingService(unitVector(1)),
        strategyOverride: 'exact'
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      result._unsafeUnwrap().results.map((entry) => entry.entityId)
    ).toEqual([keywordId]);
  }, 120_000);

  it('treats query punctuation as text while building keyword candidates', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const targetId = await insertSearchFixture(database.pool, {
      entityContent: 'Punctuation fixture entity.',
      chunkContent: 'literal punctuation probe',
      embedding: lowSimilarityVector(0.1)
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: 'literal punctuation probe | ! & : ( )',
        threshold: 0.8,
        limit: 1
      },
      {
        embeddingService: fixedEmbeddingService(unitVector(1)),
        strategyOverride: 'exact'
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      result._unsafeUnwrap().results.map((entry) => entry.entityId)
    ).toEqual([targetId]);
  }, 120_000);

  it('handles quoted and backslash lexemes without making punctuation syntax', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const quotedKeywordId = await insertSearchFixture(database.pool, {
      entityContent: 'Quoted keyword fixture.',
      chunkContent: "O'Reilly quote\\slash marker",
      embedding: lowSimilarityVector(0.1)
    });
    const semanticId = await insertSearchFixture(database.pool, {
      entityContent: 'Punctuation semantic fixture.',
      chunkContent: 'semantic punctuation candidate',
      embedding: unitVector(1)
    });

    const quotedKeywordResult = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: "O'Reilly quote\\slash",
        threshold: 0.8,
        limit: 1
      },
      {
        embeddingService: fixedEmbeddingService(unitVector(1)),
        strategyOverride: 'exact'
      }
    );

    expect(quotedKeywordResult.isOk()).toBe(true);
    expect(
      quotedKeywordResult._unsafeUnwrap().results.map((entry) => entry.entityId)
    ).toEqual([quotedKeywordId]);

    const punctuationOnlyQuery = ['!', '&', ':', '(', ')', '\\'].join(' ');
    const punctuationOnlyResult = await searchEntities(
      database.pool,
      makeAuthContext(),
      { query: punctuationOnlyQuery, threshold: 0.8, limit: 1 },
      {
        embeddingService: fixedEmbeddingService(unitVector(1)),
        strategyOverride: 'exact'
      }
    );

    expect(punctuationOnlyResult.isOk()).toBe(true);
    expect(
      punctuationOnlyResult._unsafeUnwrap().results.map((entry) => entry.entityId)
    ).toEqual([semanticId]);
  }, 120_000);

  it('fuses vector and keyword ranks while assigning zero to a missing branch', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const vectorOnlyId = await insertSearchFixture(database.pool, {
      entityContent: 'An incidental vector neighbor.',
      chunkContent: 'An incidental vector neighbor.',
      embedding: unitVector(1)
    });
    const bothBranchesId = await insertSearchFixture(database.pool, {
      entityContent: 'A concise answer without the query lexemes.',
      chunkContent: 'rrf-anchor is present in this chunk.',
      embedding: lowSimilarityVector(0.99)
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: 'rrf-anchor',
        threshold: 0,
        recencyWeight: 0,
        limit: 2
      },
      {
        embeddingService: fixedEmbeddingService(unitVector(1)),
        strategyOverride: 'exact'
      }
    );

    expect(result.isOk()).toBe(true);
    const results = result._unsafeUnwrap().results;
    expect(results.map((entry) => entry.entityId)).toEqual([
      bothBranchesId,
      vectorOnlyId
    ]);
    expect(results[0]?.score).toBeCloseTo(1 / 61 + 1 / 62, 6);
    expect(results[1]?.score).toBeCloseTo(1 / 61, 6);
  }, 120_000);

  it('uses keyword rank to break equal fused scores for concise chunks', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdAt = new Date('2026-10-14T12:00:00.000Z');
    const conciseId = await insertSearchFixture(database.pool, {
      entityContent: 'A concise deployment answer.',
      chunkContent: 'deployment window Tuesday concise answer',
      embedding: lowSimilarityVector(0.49),
      createdAt
    });
    const incidentalId = await insertSearchFixture(database.pool, {
      entityContent: 'A long deployment planning document.',
      chunkContent: Array.from(
        { length: 48 },
        () => 'deployment window Tuesday incidental planning context'
      ).join(' '),
      embedding: lowSimilarityVector(0.69),
      createdAt
    });

    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      {
        query: 'deployment window Tuesday',
        threshold: 0.8,
        recencyWeight: 0,
        limit: 2
      },
      {
        embeddingService: fixedEmbeddingService(unitVector(1)),
        strategyOverride: 'exact'
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      result._unsafeUnwrap().results.map((entry) => entry.entityId)
    ).toEqual([conciseId, incidentalId]);
  }, 120_000);

  it('uses a true thirty-day half-life for recency boosts', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const pool = database.pool;
    const now = new Date('2026-10-14T12:00:00.000Z');
    const searchOne = async (createdAt: Date): Promise<number> => {
      await resetTestDatabase(pool);
      await seedApiKey(pool, {
        id: '00000000-0000-0000-0000-000000000104',
        name: 'search-key'
      });
      await insertSearchFixture(pool, {
        entityContent: 'Recency half-life fixture.',
        chunkContent: 'half-life marker',
        embedding: unitVector(1),
        createdAt
      });

      const result = await searchEntities(
        pool,
        makeAuthContext(),
        {
          query: 'half-life marker',
          threshold: 0,
          recencyWeight: 1,
          limit: 1
        },
        {
          embeddingService: fixedEmbeddingService(unitVector(1)),
          strategyOverride: 'exact',
          now: () => now
        }
      );
      expect(result.isOk()).toBe(true);
      return result._unsafeUnwrap().results[0]?.score ?? 0;
    };

    const recentScore = await searchOne(now);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oldScore = await searchOne(thirtyDaysAgo);

    expect(oldScore / recentScore).toBeCloseTo(0.75, 2);
  }, 120_000);

  type SearchRequest = Parameters<typeof searchEntities>[2];
  type KeywordScopeCase = {
    name: string;
    auth: (base: AuthContext) => AuthContext;
    filters: Omit<SearchRequest, 'query' | 'threshold' | 'limit'>;
    candidate: SearchFixtureOverrides;
    control: SearchFixtureOverrides;
  };

  const keywordScopeCases: KeywordScopeCase[] = [
    {
      name: 'visibility',
      auth: (base) => ({ ...base, allowedVisibility: ['shared'] }),
      filters: {},
      candidate: { visibility: 'personal' },
      control: { visibility: 'shared' }
    },
    {
      name: 'type',
      auth: (base) => ({ ...base, allowedTypes: ['memory'] }),
      filters: {},
      candidate: { type: 'document' },
      control: { type: 'memory' }
    },
    {
      name: 'owner',
      auth: (base) => base,
      filters: { owner: 'alice' },
      candidate: { owner: 'bob' },
      control: { owner: 'alice' }
    },
    {
      name: 'archive',
      auth: (base) => base,
      filters: { includeArchived: false },
      candidate: { status: 'archived' },
      control: { status: 'active' }
    },
    {
      name: 'tags',
      auth: (base) => base,
      filters: { tags: ['allowed'] },
      candidate: { tags: ['other'] },
      control: { tags: ['allowed'] }
    },
    {
      name: 'memory role',
      auth: (base) => ({ ...base, clientId: 'codex' }),
      filters: { memoryRole: 'session_context' },
      candidate: {
        metadata: { memory_role: 'durable_memory' }
      },
      control: {
        metadata: {
          memory_role: 'session_context',
          session_scope: { kind: 'client', client_id: 'codex' }
        }
      }
    },
    {
      name: 'session scope',
      auth: (base) => ({ ...base, clientId: 'codex' }),
      filters: {},
      candidate: {
        metadata: {
          memory_role: 'session_context',
          session_scope: { kind: 'client', client_id: 'talon' }
        }
      },
      control: {
        metadata: {
          memory_role: 'session_context',
          session_scope: { kind: 'client', client_id: 'codex' }
        }
      }
    },
    {
      name: 'durable client scope',
      auth: (base) => ({ ...base, clientId: 'codex' }),
      filters: {},
      candidate: {
        metadata: {
          memory_role: 'durable_memory',
          session_scope: { kind: 'client', client_id: 'talon' }
        }
      },
      control: {
        metadata: {
          memory_role: 'durable_memory',
          session_scope: { kind: 'client', client_id: 'codex' }
        }
      }
    }
  ];

  it.each(keywordScopeCases)(
    'applies $name authorization filters to keyword candidates',
    async ({ auth: makeScopedAuth, filters, candidate, control }) => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      const query = 'keyword-scope-marker';
      const embedding = lowSimilarityVector(0.1);
      await insertSearchDistractors(database.pool, 21, {
        metadata:
          filters.memoryRole === 'session_context'
            ? {
                memory_role: 'session_context',
                session_scope: { kind: 'client', client_id: 'codex' }
              }
            : { memory_role: 'durable_memory' }
      });
      const candidateId = await insertSearchFixture(database.pool, {
        entityContent: 'Candidate metadata does not contain the query.',
        chunkContent: query,
        embedding,
        ...candidate
      });
      const controlId = await insertSearchFixture(database.pool, {
        entityContent: 'Control metadata does not contain the query.',
        chunkContent: query,
        embedding,
        ...control
      });

      const result = await searchEntities(
        database.pool,
        makeScopedAuth(makeAuthContext()),
        {
          query,
          threshold: 0.8,
          limit: 1,
          ...filters
        },
        {
          embeddingService: fixedEmbeddingService(unitVector(1)),
          strategyOverride: 'exact'
        }
      );

      expect(result.isOk()).toBe(true);
      const resultIds = result
        ._unsafeUnwrap()
        .results.map((entry) => entry.entityId);
      expect(resultIds).toContain(controlId);
      expect(resultIds).not.toContain(candidateId);

      const hnswResult = await searchEntities(
        database.pool,
        makeScopedAuth(makeAuthContext()),
        {
          query,
          threshold: 0.8,
          limit: 1,
          ...filters
        },
        {
          embeddingService: fixedEmbeddingService(unitVector(1)),
          strategyOverride: 'hnsw'
        }
      );

      expect(hnswResult.isOk()).toBe(true);
      const hnswIds = hnswResult
        ._unsafeUnwrap()
        .results.map((entry) => entry.entityId);
      expect(hnswIds).toContain(controlId);
      expect(hnswIds).not.toContain(candidateId);
    },
    120_000
  );

  const sparseKeywordScopeCases = keywordScopeCases.flatMap((scopeCase) =>
    (['exact', 'hnsw'] as const).map((strategy) => ({
      ...scopeCase,
      strategy
    }))
  );

  it.each(sparseKeywordScopeCases)(
    'applies $name authorization before sparse OR keyword limits with the $strategy strategy',
    async ({
      auth: makeScopedAuth,
      filters,
      candidate,
      control,
      strategy
    }) => {
      if (!database) {
        throw new Error('test database not initialized');
      }

      const queryTerms = [
        'sparse-alpha',
        'sparse-beta',
        'sparse-gamma'
      ];
      const query = queryTerms.join(' ');
      const partialContent = queryTerms.slice(0, 2).join(' ');
      const embedding = lowSimilarityVector(0.1);
      await insertSearchDistractors(database.pool, 41, {
        ...control,
        metadata: control.metadata ?? {}
      });
      const candidateId = await insertSearchFixture(database.pool, {
        entityContent: 'Unauthorized sparse partial candidate.',
        chunkContent: partialContent,
        embedding,
        ...candidate
      });
      const controlId = await insertSearchFixture(database.pool, {
        entityContent: 'Authorized sparse partial control.',
        chunkContent: partialContent,
        embedding,
        ...control
      });

      const result = await searchEntities(
        database.pool,
        makeScopedAuth(makeAuthContext()),
        {
          query,
          threshold: 0.95,
          limit: 2,
          ...filters
        },
        {
          embeddingService: fixedEmbeddingService(unitVector(1)),
          strategyOverride: strategy
        }
      );

      expect(result.isOk()).toBe(true);
      const resultIds = result
        ._unsafeUnwrap()
        .results.map((entry) => entry.entityId);
      expect(resultIds).toContain(controlId);
      expect(resultIds).not.toContain(candidateId);
    },
    120_000
  );

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

  it('omits entity and related content when hydration is disabled', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const auth = makeAuthContext();
    const largeContent = `compact retrieval marker ${'x'.repeat(100_000)}`;
    const stored = (
      await storeEntity(database.pool, auth, {
        type: 'document',
        content: largeContent
      })
    )._unsafeUnwrap();
    const neighbor = (
      await storeEntity(database.pool, auth, {
        type: 'project',
        content: `related content ${'y'.repeat(20_000)}`
      })
    )._unsafeUnwrap();

    expect(
      (
        await createEdge(database.pool, auth, {
          sourceId: stored.id,
          targetId: neighbor.id,
          relation: 'part_of'
        })
      ).isOk()
    ).toBe(true);

    const embeddingService = createEmbeddingService();
    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const compact = await searchEntities(
      database.pool,
      auth,
      {
        query: 'compact retrieval marker',
        threshold: 0,
        expandGraph: true,
        includeContent: false
      },
      { embeddingService }
    );
    const compactHit = compact
      ._unsafeUnwrap()
      .results.find((entry) => entry.entity.id === stored.id);

    expect(compactHit?.chunkContent).toEqual(expect.any(String));
    expect(compactHit?.chunkContent.length).toBeGreaterThan(0);
    expect(compactHit?.entity.content).toBeNull();
    expect(compactHit?.related?.[0]?.entity.content).toBeNull();

    const legacy = await searchEntities(
      database.pool,
      auth,
      {
        query: 'compact retrieval marker',
        threshold: 0,
        expandGraph: true
      },
      { embeddingService }
    );
    const legacyHit = legacy
      ._unsafeUnwrap()
      .results.find((entry) => entry.entity.id === stored.id);

    expect(legacyHit?.entity.content).toBe(largeContent);
    expect(legacyHit?.related?.[0]?.entity.content).toContain('related content');
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

  it('fails the search when query embedding fails', async () => {
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

    // An embedding failure must fail the search rather than silently falling
    // back to keyword-only results.
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ErrorCode.EMBEDDING_FAILED);
  }, 120_000);

  it('bounds persisted query embeddings per client', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const embeddingService = createEmbeddingService({
      embedQuery: () => Promise.resolve(new Array<number>(1536).fill(0.01))
    });

    for (const query of ['query one', 'query two', 'query three']) {
      const result = await searchEntities(
        database.pool,
        makeAuthContext(),
        { query, threshold: 0 },
        { embeddingService }
      );
      expect(result.isOk()).toBe(true);
    }
    await embeddingService.flushPendingWrites();
    const pruned = await pruneQueryEmbeddingCache(database.pool, 30, 2);

    const cached = await database.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM query_embedding_cache
       WHERE client_id = $1`,
      [makeAuthContext().clientId]
    );
    expect(pruned).toBe(1);
    expect(cached.rows[0]?.count).toBe(2);
  }, 120_000);

  it('serves a repeated query embedding from Postgres across service instances', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'redis cluster failover runbook',
      tags: ['infra']
    });
    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService: createEmbeddingService()
    }).runOnce();

    let embedCalls = 0;
    const countingEmbedQuery = (): Promise<number[]> => {
      embedCalls += 1;
      return Promise.resolve(new Array<number>(1536).fill(0.01));
    };

    const first = createEmbeddingService({ embedQuery: countingEmbedQuery });
    await searchEntities(
      database.pool,
      makeAuthContext(),
      { query: 'redis failover', threshold: 0 },
      { embeddingService: first }
    );
    await first.flushPendingWrites();
    expect(embedCalls).toBe(1);

    // A second instance stands in for a restarted process: its in-memory cache
    // is empty, so avoiding a provider call proves the row was persisted.
    const second = createEmbeddingService({ embedQuery: countingEmbedQuery });
    const result = await searchEntities(
      database.pool,
      makeAuthContext(),
      { query: 'redis failover', threshold: 0 },
      { embeddingService: second }
    );

    expect(result.isOk()).toBe(true);
    expect(embedCalls).toBe(1);

    const cached = await database.pool.query<{
      count: number;
      client_id: string;
    }>(
      `SELECT count(*)::int AS count, min(client_id) AS client_id
       FROM query_embedding_cache`
    );
    expect(cached.rows[0]?.count).toBe(1);
    expect(cached.rows[0]?.client_id).toBe(makeAuthContext().clientId);
  }, 120_000);
});
