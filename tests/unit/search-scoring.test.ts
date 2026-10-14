import { describe, expect, it, vi } from 'vitest';

import {
  buildSearchEdgeSummaries,
  searchEntities
} from '../../src/services/search-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import type { EmbeddingService } from '../../src/services/embedding-service.js';

const searchAuth: AuthContext = {
  apiKeyId: '00000000-0000-0000-0000-000000000104',
  keyName: 'search-key',
  clientId: 'search-key',
  scopes: ['read'],
  allowedTypes: null,
  allowedVisibility: ['personal', 'work', 'shared']
};

const activeTestModel = {
  id: '00000000-0000-0000-0000-0000000000aa',
  name: 'test-model',
  provider: 'deterministic',
  dimensions: 3,
  chunkSize: 1000,
  chunkOverlap: 100,
  metadata: {},
  createdAt: '2026-06-01T00:00:00.000Z'
};

function searchRow(
  id: string,
  content: string,
  score = 0.88,
  candidateCount = 500
) {
  const createdAt = new Date('2026-06-01T00:00:00.000Z');
  return {
    id,
    type: 'memory',
    content,
    visibility: 'personal',
    owner: null,
    status: null,
    enrichment_status: 'completed',
    version: 1,
    tags: [],
    source: null,
    metadata: {},
    created_at: createdAt,
    updated_at: createdAt,
    chunk_content: content,
    similarity: 1,
    score,
    result_present: true,
    candidate_count: candidateCount
  };
}

describe('buildSearchEdgeSummaries', () => {
  it('counts visible edges and sorts relation summaries stably', () => {
    const summaries = buildSearchEdgeSummaries([
      { result_entity_id: 'a', relation: 'mentioned_in' },
      { result_entity_id: 'a', relation: 'depends_on' },
      { result_entity_id: 'a', relation: 'mentioned_in' },
      { result_entity_id: 'a', relation: 'blocked_by' },
      { result_entity_id: 'b', relation: 'related_to' }
    ]);

    expect(summaries.get('a')).toEqual({
      count: 4,
      relations: [
        { relation: 'mentioned_in', count: 2 },
        { relation: 'blocked_by', count: 1 },
        { relation: 'depends_on', count: 1 }
      ]
    });
    expect(summaries.get('b')).toEqual({
      count: 1,
      relations: [{ relation: 'related_to', count: 1 }]
    });
  });

  it('returns an empty map when there are no visible edge rows', () => {
    expect(buildSearchEdgeSummaries([]).size).toBe(0);
  });
});

describe('searchEntities query embedding', () => {
  function makePool(
    options: {
      chunkCount?: string;
      iterativeScanSupported?: boolean;
      candidateCount?: number;
    } = {}
  ) {
    const chunkCount = options.chunkCount ?? '42';
    const iterativeScanSupported = options.iterativeScanSupported ?? true;
    const queries: string[] = [];
    const query = (sql: string) => {
      queries.push(sql);
      if (sql.includes('SET LOCAL hnsw.iterative_scan')) {
        if (!iterativeScanSupported) {
          return Promise.reject(
            Object.assign(new Error('unrecognized configuration parameter'), {
              code: '42704'
            })
          );
        }
        return Promise.resolve({ rows: [] });
      }
      if (
        sql === 'BEGIN' ||
        sql === 'COMMIT' ||
        sql === 'ROLLBACK' ||
        sql.includes("SELECT '[0]'::vector")
      ) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('count(*)::text AS chunk_count')) {
        return Promise.resolve({ rows: [{ chunk_count: chunkCount }] });
      }
      if (sql.includes('FROM chunks c')) {
        return Promise.resolve({
          rows: [
            searchRow(
              '00000000-0000-0000-0000-000000000011',
              'hybrid result',
              0.88,
              options.candidateCount
            )
          ]
        });
      }
      if (sql.includes('FROM unnest($1::uuid[]) AS anchor')) {
        return Promise.resolve({ rows: [] });
      }
      throw new Error(`Unexpected query: ${sql}`);
    };
    const client = {
      query,
      release: vi.fn()
    };
    const pool = {
      query,
      connect: () => Promise.resolve(client)
    };
    return { pool: pool as never, queries };
  }

  function makeEmbeddingService(
    embedQuery: EmbeddingService['embedQuery']
  ): EmbeddingService {
    return {
      dimensions: 3,
      embedBatch: () => Promise.resolve([[1, 0, 0]]),
      embedQuery,
      flushPendingWrites: () => Promise.resolve(),
      invalidateActiveModel: () => undefined,
      getActiveModelForQuery: () => Promise.resolve(activeTestModel),
      getActiveModel: () => Promise.resolve(activeTestModel)
    };
  }

  it('builds keyword candidates in one combined hybrid query', async () => {
    const { pool, queries } = makePool();
    const embedQuery = vi.fn().mockResolvedValue([1, 0, 0]);

    const result = await searchEntities(
      pool,
      searchAuth,
      { query: 'postgres search', threshold: 0 },
      { embeddingService: makeEmbeddingService(embedQuery) }
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      results: [{ chunkContent: 'hybrid result' }]
    });
    expect(
      queries.filter((sql) => sql.includes('ROW_NUMBER() OVER'))
    ).toHaveLength(1);
  });

  it('passes the complete long query to embedding instead of the capped keyword terms', async () => {
    const { pool } = makePool();
    const query = Array.from(
      { length: 300 },
      (_, index) => `pasted-term-${index}`
    ).join(' ');
    const embedQuery = vi.fn().mockResolvedValue([1, 0, 0]);

    const result = await searchEntities(
      pool,
      searchAuth,
      { query, threshold: 0 },
      { embeddingService: makeEmbeddingService(embedQuery) }
    );

    expect(result.isOk()).toBe(true);
    expect(embedQuery).toHaveBeenCalledWith(
      query,
      activeTestModel,
      expect.any(Object)
    );
  });

  it('uses HNSW-first candidates with transaction-local iterative scan for broad searches', async () => {
    const { pool, queries } = makePool();

    const result = await searchEntities(
      pool,
      searchAuth,
      { query: 'postgres search', threshold: 0, limit: 1 },
      {
        embeddingService: makeEmbeddingService(
          vi.fn().mockResolvedValue([1, 0, 0])
        )
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      queries.some((sql) => sql.includes('SET LOCAL hnsw.iterative_scan'))
    ).toBe(true);
    expect(
      queries.some((sql) => sql.includes('CROSS JOIN LATERAL'))
    ).toBe(true);
  });

  it('counts and searches small filtered candidate sets exactly', async () => {
    const { pool, queries } = makePool();

    const result = await searchEntities(
      pool,
      searchAuth,
      {
        query: 'postgres search',
        type: 'memory',
        threshold: 0,
        limit: 1
      },
      {
        embeddingService: makeEmbeddingService(
          vi.fn().mockResolvedValue([1, 0, 0])
        )
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      queries.some(
        (sql) =>
          sql.includes('count(*)::text AS chunk_count') &&
          sql.includes('LIMIT $10')
      )
    ).toBe(true);
    expect(
      queries.some((sql) => sql.includes('CROSS JOIN LATERAL'))
    ).toBe(false);
    expect(
      queries.some((sql) =>
        sql.includes('(c.embedding <=> $1::vector) + 0')
      )
    ).toBe(true);
  });

  it('does not fall back when HNSW fills its candidate scan', async () => {
    const { pool, queries } = makePool();

    const result = await searchEntities(
      pool,
      searchAuth,
      { query: 'postgres search', threshold: 0, limit: 2 },
      {
        embeddingService: makeEmbeddingService(
          vi.fn().mockResolvedValue([1, 0, 0])
        )
      }
    );

    expect(result.isOk()).toBe(true);
    const hybridQueries = queries.filter((sql) =>
      sql.includes('ROW_NUMBER() OVER')
    );
    expect(hybridQueries).toHaveLength(1);
    expect(hybridQueries[0]).toContain('CROSS JOIN LATERAL');
  });

  it('uses vector candidate count for fallback even when keyword candidates exist', async () => {
    const { pool, queries } = makePool({
      chunkCount: '5001',
      candidateCount: 1
    });

    const result = await searchEntities(
      pool,
      searchAuth,
      { query: 'postgres search', threshold: 0, limit: 1 },
      {
        embeddingService: makeEmbeddingService(
          vi.fn().mockResolvedValue([1, 0, 0])
        )
      }
    );

    expect(result.isOk()).toBe(true);
    const hybridQueries = queries.filter((sql) =>
      sql.includes('ROW_NUMBER() OVER')
    );
    expect(hybridQueries).toHaveLength(2);
    expect(hybridQueries[0]).toContain('CROSS JOIN LATERAL');
    expect(hybridQueries[1]).not.toContain('CROSS JOIN LATERAL');
  });

  it('uses HNSW for filtered candidate sets above the exact-search threshold', async () => {
    const { pool, queries } = makePool({ chunkCount: '5001' });

    const result = await searchEntities(
      pool,
      searchAuth,
      {
        query: 'postgres search',
        type: 'document',
        threshold: 0,
        limit: 1
      },
      {
        embeddingService: makeEmbeddingService(
          vi.fn().mockResolvedValue([1, 0, 0])
        )
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      queries.some((sql) => sql.includes('CROSS JOIN LATERAL'))
    ).toBe(true);
  });

  it('falls back to exact search when iterative HNSW scans are unavailable', async () => {
    const { pool, queries } = makePool({ iterativeScanSupported: false });

    const result = await searchEntities(
      pool,
      searchAuth,
      { query: 'postgres search', threshold: 0, limit: 1 },
      {
        embeddingService: makeEmbeddingService(
          vi.fn().mockResolvedValue([1, 0, 0])
        )
      }
    );

    expect(result.isOk()).toBe(true);
    expect(
      queries.some((sql) => sql.includes('SET LOCAL hnsw.iterative_scan'))
    ).toBe(true);
    expect(
      queries.some(
        (sql) =>
          sql.includes('ROW_NUMBER() OVER') &&
          !sql.includes('CROSS JOIN LATERAL')
      )
    ).toBe(true);
  });

  it('passes the pool through so the embedding can be cached in Postgres', async () => {
    const { pool } = makePool();
    const embedQuery = vi.fn().mockResolvedValue([1, 0, 0]);

    await searchEntities(
      pool,
      searchAuth,
      { query: 'postgres search', threshold: 0 },
      { embeddingService: makeEmbeddingService(embedQuery) }
    );

    expect(embedQuery).toHaveBeenCalledWith(
      'postgres search',
      expect.any(Object),
      expect.objectContaining({ pool, cacheScope: searchAuth.clientId })
    );
  });

  it('surfaces an embedding failure instead of degrading to keyword matches', async () => {
    const { pool } = makePool();
    const warn = vi.fn();
    const debug = vi.fn();

    const result = await searchEntities(
      pool,
      searchAuth,
      { query: 'postgres search', threshold: 0 },
      {
        embeddingService: makeEmbeddingService(() =>
          Promise.reject(
            new Error('provider unavailable for private roadmap and key-secret')
          )
        ),
        logger: { warn, debug }
      }
    );

    expect(result.isErr()).toBe(true);
    expect(debug).not.toHaveBeenCalled();
  });

  it('does not log the query text or credentials on a successful search', async () => {
    const { pool } = makePool();
    const warn = vi.fn();
    const debug = vi.fn();

    await searchEntities(
      pool,
      searchAuth,
      { query: 'private roadmap', threshold: 0 },
      {
        embeddingService: makeEmbeddingService(
          vi.fn().mockResolvedValue([1, 0, 0])
        ),
        logger: { warn, debug }
      }
    );

    expect(debug).toHaveBeenCalledOnce();
    expect(JSON.stringify(debug.mock.calls)).not.toContain('private roadmap');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('search-key');
  });
});

describe('searchEntities graph expansion', () => {
  it('derives edge summaries from expanded graph rows without a standalone summary query', async () => {
    const anchorId = '00000000-0000-0000-0000-000000000001';
    const neighborId = '00000000-0000-0000-0000-000000000002';
    const queries: string[] = [];
    const createdAt = new Date('2026-06-01T00:00:00.000Z');

    const pool = {
      query: (sql: string) => {
        queries.push(sql);

        if (sql.includes('count(*)::text AS chunk_count')) {
          return Promise.resolve({ rows: [{ chunk_count: '1' }] });
        }

        if (sql.includes('FROM chunks c')) {
          return Promise.resolve({
            rows: [
              {
                id: anchorId,
                type: 'memory',
                content: 'anchor compact search content',
                visibility: 'personal',
                owner: null,
                status: null,
                enrichment_status: 'completed',
                version: 1,
                tags: [],
                source: null,
                metadata: {},
                created_at: createdAt,
                updated_at: createdAt,
                chunk_content: 'anchor compact search content',
                similarity: 1,
                score: 0.88,
                result_present: true,
                candidate_count: 1
              }
            ]
          });
        }

        if (sql.includes('FROM unnest($1::uuid[]) AS anchor')) {
          return Promise.resolve({
            rows: [{ result_entity_id: anchorId, relation: 'depends_on' }]
          });
        }

        if (sql.includes('SELECT source_id, target_id, relation FROM edges')) {
          return Promise.resolve({
            rows: [
              {
                source_id: anchorId,
                target_id: neighborId,
                relation: 'depends_on'
              }
            ]
          });
        }

        if (sql.includes('SELECT id, type, content, metadata FROM entities')) {
          return Promise.resolve({
            rows: [
              {
                id: neighborId,
                type: 'project',
                content: 'neighbor content',
                metadata: {}
              }
            ]
          });
        }

        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    const embeddingService: EmbeddingService = {
      dimensions: 3,
      embedBatch: () => Promise.resolve([[1, 0, 0]]),
      embedQuery: () => Promise.resolve([1, 0, 0]),
      flushPendingWrites: () => Promise.resolve(),
      invalidateActiveModel: () => undefined,
      getActiveModelForQuery: () => Promise.resolve(activeTestModel),
      getActiveModel: () => Promise.resolve(activeTestModel)
    };

    const result = await searchEntities(
      pool as never,
      searchAuth,
      {
        query: 'compact search',
        type: 'memory',
        threshold: 0,
        expandGraph: true
      },
      {
        embeddingService,
        now: () => new Date('2026-06-02T00:00:00.000Z')
      }
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().results[0]).toMatchObject({
      entityId: anchorId,
      score: 0.88,
      edges: {
        count: 1,
        relations: [{ relation: 'depends_on', count: 1 }]
      },
      related: [
        {
          entity: { id: neighborId },
          relation: 'depends_on',
          direction: 'outgoing'
        }
      ]
    });
    expect(
      queries.some((sql) => sql.includes('FROM unnest($1::uuid[]) AS anchor'))
    ).toBe(false);
    expect(queries.some((sql) => sql.includes('ROW_NUMBER() OVER'))).toBe(true);
  });
});
