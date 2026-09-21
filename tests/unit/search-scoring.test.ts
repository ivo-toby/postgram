import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createJevRetrievalJudge,
  resolveEnvJevJudge
} from '../../src/services/jev-retrieval-judge.js';
import type { JevJudgeCandidate } from '../../src/services/jev-retrieval-judge.js';
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

function searchRow(id: string, content: string, score = 0.88) {
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
    candidate_count: 500
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
    options: { chunkCount?: string; iterativeScanSupported?: boolean } = {}
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
              'hybrid result'
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

  it('runs only the hybrid query — no speculative lexical query', async () => {
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
    expect(queries.some((sql) => sql.includes('search_tsvector @@'))).toBe(
      false
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

function makeStubJevClient(
  answers: Record<string, unknown> = {
    relevant: { type: 'noul', noul: 0.91 },
    evidence: { type: 'noul', noul: 0.82 },
    contradicts: { type: 'noul', noul: 0.07 }
  }
) {
  const systemOne = vi.fn<
    (
      request: unknown,
      options?: unknown
    ) => Promise<{ model: string; answers: Record<string, unknown> }>
  >(() => Promise.resolve({ model: 'jev-latest', answers }));
  return { client: { systemOne }, systemOne };
}

describe('searchEntities Jev shadow judge', () => {
  function makeSearchPool(
    rows: ReturnType<typeof searchRow>[] = [
      searchRow('00000000-0000-0000-0000-000000000011', 'hybrid result')
    ]
  ) {
    const query = (sql: string) => {
      if (sql.includes('SET LOCAL hnsw.iterative_scan')) {
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
        return Promise.resolve({ rows: [{ chunk_count: '42' }] });
      }
      if (sql.includes('FROM chunks c')) {
        return Promise.resolve({ rows });
      }
      if (sql.includes('FROM unnest($1::uuid[]) AS anchor')) {
        return Promise.resolve({ rows: [] });
      }
      throw new Error(`Unexpected query: ${sql}`);
    };
    const client = { query, release: vi.fn() };
    return { pool: { query, connect: () => Promise.resolve(client) } as never };
  }

  function makeSearchEmbeddingService(): EmbeddingService {
    return {
      dimensions: 3,
      embedBatch: () => Promise.resolve([[1, 0, 0]]),
      embedQuery: () => Promise.resolve([1, 0, 0]),
      flushPendingWrites: () => Promise.resolve(),
      invalidateActiveModel: () => undefined,
      getActiveModelForQuery: () => Promise.resolve(activeTestModel),
      getActiveModel: () => Promise.resolve(activeTestModel)
    };
  }

  function makeJevJudge(
    client: { systemOne: (...args: unknown[]) => unknown },
    config: { maxCandidates?: number } = {}
  ) {
    const judge = createJevRetrievalJudge(
      {
        shadowEnabled: true,
        apiKey: 'test-key',
        timeoutMs: 250,
        maxCandidates: config.maxCandidates ?? 10
      },
      { client: client as never }
    );
    if (!judge) throw new Error('expected judge to be created');
    return judge;
  }

  it('logs three nouls per candidate when the shadow judge is enabled', async () => {
    const { pool } = makeSearchPool();
    const debug = vi.fn();
    const warn = vi.fn();
    const { client, systemOne } = makeStubJevClient();

    const result = await searchEntities(
      pool,
      searchAuth,
      { query: 'postgres search', threshold: 0 },
      {
        embeddingService: makeSearchEmbeddingService(),
        jevJudge: makeJevJudge(client),
        logger: { warn, debug }
      }
    );

    expect(result.isOk()).toBe(true);

    // One systemOne request for the candidate, three named Noul questions.
    expect(systemOne).toHaveBeenCalledTimes(1);
    const call = systemOne.mock.calls[0];
    const request = (call?.[0] ?? {}) as {
      state: Record<string, unknown>;
      questions: Record<string, unknown>;
    };
    const callOptions = (call?.[1] ?? {}) as { timeout?: number };
    expect(Object.keys(request.questions)).toEqual([
      'relevant',
      'evidence',
      'contradicts'
    ]);
    // State hygiene: text plus scores only — no dates, no counts.
    expect(request.state).toEqual({
      query: 'postgres search',
      chunk_text: 'hybrid result',
      entity_type: 'memory',
      tags: [],
      similarity: 1,
      score: 0.88
    });
    expect(callOptions.timeout).toBe(250);

    // Judgments are logged beside the scores, without duplicating chunk text.
    const payload = debug.mock.calls[0]?.[0] as
      | {
          jev?: {
            queryHash: string;
            candidates: Array<Record<string, unknown>>;
          };
        }
      | undefined;
    expect(payload?.jev?.candidates).toHaveLength(1);
    expect(payload?.jev?.candidates[0]).toMatchObject({
      entityId: '00000000-0000-0000-0000-000000000011',
      status: 'judged',
      score: 0.88,
      similarity: 1,
      nouls: { relevant: 0.91, evidence: 0.82, contradicts: 0.07 },
      model: 'jev-latest'
    });
    expect(typeof payload?.jev?.candidates[0]?.latencyMs).toBe('number');
    expect(typeof payload?.jev?.queryHash).toBe('string');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('hybrid result');

    // Results are unchanged by the judge.
    expect(result._unsafeUnwrap()).toMatchObject({
      results: [{ chunkContent: 'hybrid result', score: 0.88 }]
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the search.completed payload free of jev fields when no judge is configured', async () => {
    const { pool } = makeSearchPool();
    const debug = vi.fn();
    const warn = vi.fn();

    const result = await searchEntities(
      pool,
      searchAuth,
      { query: 'postgres search', threshold: 0 },
      { embeddingService: makeSearchEmbeddingService(), logger: { warn, debug } }
    );

    expect(result.isOk()).toBe(true);
    expect(debug).toHaveBeenCalledOnce();
    const payload = (debug.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('jev');
    const timings = payload.timings as Record<string, number>;
    expect(timings).not.toHaveProperty('jevMs');
    expect(result._unsafeUnwrap()).toMatchObject({
      results: [{ chunkContent: 'hybrid result', score: 0.88 }]
    });
  });

  it('does not construct a judge when the shadow flag is off', () => {
    const { client, systemOne } = makeStubJevClient();

    const judge = createJevRetrievalJudge(
      {
        shadowEnabled: false,
        apiKey: 'test-key',
        timeoutMs: 250,
        maxCandidates: 10
      },
      { client: client as never }
    );

    expect(judge).toBeUndefined();
    expect(systemOne).not.toHaveBeenCalled();
  });

  it('skips candidates as jev.unavailable and still resolves when the Jev API fails', async () => {
    const { pool } = makeSearchPool();
    const debug = vi.fn();
    const warn = vi.fn();
    const rejectingClient = {
      systemOne: () =>
        Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:443'))
    };

    const result = await searchEntities(
      pool,
      searchAuth,
      { query: 'postgres search', threshold: 0 },
      {
        embeddingService: makeSearchEmbeddingService(),
        jevJudge: makeJevJudge(rejectingClient),
        logger: { warn, debug }
      }
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().results).toHaveLength(1);
    const events = debug.mock.calls.map(
      (call) => (call[0] as { event?: string }).event
    );
    expect(events).toContain('jev.unavailable');
    const completed = (debug.mock.calls.at(-1)?.[0] ?? {}) as {
      jev?: { candidates: Array<Record<string, unknown>> };
    };
    expect(completed.jev?.candidates[0]).toMatchObject({
      entityId: '00000000-0000-0000-0000-000000000011',
      status: 'unavailable',
      score: 0.88,
      similarity: 1
    });
    expect(typeof completed.jev?.candidates[0]?.latencyMs).toBe('number');
    expect(JSON.stringify(debug.mock.calls)).not.toContain('postgres search');
  });

  it('judges at most JEV_MAX_CANDIDATES candidates per query', async () => {
    const { pool } = makeSearchPool([
      searchRow('00000000-0000-0000-0000-000000000021', 'first candidate', 0.9),
      searchRow('00000000-0000-0000-0000-000000000022', 'second candidate', 0.8)
    ]);
    const debug = vi.fn();
    const { client, systemOne } = makeStubJevClient();

    const result = await searchEntities(
      pool,
      searchAuth,
      { query: 'postgres search', threshold: 0, limit: 2 },
      {
        embeddingService: makeSearchEmbeddingService(),
        jevJudge: makeJevJudge(client, { maxCandidates: 1 }),
        logger: { warn: vi.fn(), debug }
      }
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().results).toHaveLength(2);
    expect(systemOne).toHaveBeenCalledTimes(1);
    const completed = (debug.mock.calls.at(-1)?.[0] ?? {}) as {
      jev?: { candidates: unknown[] };
    };
    expect(completed.jev?.candidates).toHaveLength(1);
  });

  it('search still resolves when the judge itself throws', async () => {
    const { pool } = makeSearchPool();
    const debug = vi.fn();
    const warn = vi.fn();

    const result = await searchEntities(
      pool,
      searchAuth,
      { query: 'postgres search', threshold: 0 },
      {
        embeddingService: makeSearchEmbeddingService(),
        jevJudge: () => Promise.reject(new Error('judge bug')),
        logger: { warn, debug }
      }
    );

    expect(result.isOk()).toBe(true);
    const payload = (debug.mock.calls.at(-1)?.[0] ?? {}) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('jev');
    expect(warn).toHaveBeenCalled();
  });
});

describe('jev-retrieval-judge', () => {
  const baseCandidate: JevJudgeCandidate = {
    entityId: '00000000-0000-0000-0000-0000000000aa',
    chunkContent: 'passage text',
    entityType: 'memory',
    tags: ['notes'],
    similarity: 0.9,
    score: 0.75
  };

  function makeJudge(
    deps: Parameters<typeof createJevRetrievalJudge>[1] = {},
    config: { maxCandidates?: number } = {}
  ) {
    const judge = createJevRetrievalJudge(
      {
        shadowEnabled: true,
        apiKey: 'test-key',
        timeoutMs: 500,
        maxCandidates: config.maxCandidates ?? 10
      },
      deps
    );
    if (!judge) throw new Error('expected judge to be created');
    return judge;
  }

  it('answers all three noul questions for one candidate in a single systemOne call', async () => {
    const debug = vi.fn();
    const warn = vi.fn();
    const { client, systemOne } = makeStubJevClient();

    const observation = await makeJudge({ client })({
      query: 'what is postgres',
      candidates: [baseCandidate],
      logger: { warn, debug }
    });

    expect(systemOne).toHaveBeenCalledTimes(1);
    const call = systemOne.mock.calls[0];
    const request = (call?.[0] ?? {}) as {
      state: Record<string, unknown>;
      questions: Record<string, unknown>;
    };
    expect(request.state).toEqual({
      query: 'what is postgres',
      chunk_text: 'passage text',
      entity_type: 'memory',
      tags: ['notes'],
      similarity: 0.9,
      score: 0.75
    });
    expect(request.questions).toEqual({
      relevant: { instructions: 'Does this passage help answer the query?' },
      evidence: {
        instructions: 'Does this passage state a fact usable in an answer?'
      },
      contradicts: {
        instructions:
          'Does this passage contradict something the query takes for granted?'
      }
    });
    expect(observation.candidates[0]).toEqual({
      entityId: baseCandidate.entityId,
      status: 'judged',
      score: 0.75,
      similarity: 0.9,
      nouls: { relevant: 0.91, evidence: 0.82, contradicts: 0.07 },
      model: 'jev-latest',
      latencyMs: expect.any(Number) as number
    });
    expect(observation.queryHash).toBe(
      createHash('sha256').update('what is postgres', 'utf8').digest('hex')
    );
    expect(debug).not.toHaveBeenCalled();
  });

  it('caps the chunk text inside the judge state', async () => {
    const { client, systemOne } = makeStubJevClient();
    const longCandidate: JevJudgeCandidate = {
      ...baseCandidate,
      chunkContent: 'x'.repeat(10_000)
    };

    await makeJudge({ client })({
      query: 'q',
      candidates: [longCandidate]
    });

    const request = (systemOne.mock.calls[0]?.[0] ?? {}) as {
      state: { chunk_text: string };
    };
    expect(request.state.chunk_text).toHaveLength(4_000);
  });

  it('caps the number of judged candidates at maxCandidates', async () => {
    const { client, systemOne } = makeStubJevClient();

    const observation = await makeJudge(
      { client },
      { maxCandidates: 1 }
    )({
      query: 'q',
      candidates: [
        baseCandidate,
        { ...baseCandidate, entityId: '00000000-0000-0000-0000-0000000000bb' }
      ]
    });

    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(observation.candidates).toHaveLength(1);
    expect(observation.candidates[0]?.entityId).toBe(baseCandidate.entityId);
  });

  it('degrades a failing candidate to unavailable without throwing', async () => {
    const debug = vi.fn();
    const warn = vi.fn();
    const rejectingClient = {
      systemOne: () => Promise.reject(new Error('connect ECONNREFUSED'))
    };

    const observation = await makeJudge({ client: rejectingClient as never })({
      query: 'q',
      candidates: [baseCandidate],
      logger: { warn, debug }
    });

    expect(observation.candidates[0]).toMatchObject({
      entityId: baseCandidate.entityId,
      status: 'unavailable',
      score: 0.75,
      similarity: 0.9
    });
    expect(
      debug.mock.calls.some(
        (call) => (call[0] as { event?: string }).event === 'jev.unavailable'
      )
    ).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('degrades malformed answers to a skip', async () => {
    const debug = vi.fn();
    const { client, systemOne } = makeStubJevClient({
      relevant: { type: 'noul', noul: 0.9 },
      evidence: { type: 'noul', noul: 0.4 },
      contradicts: { type: 'score', score: 0.2 }
    });

    const observation = await makeJudge({ client })({
      query: 'q',
      candidates: [baseCandidate],
      logger: { warn: vi.fn(), debug }
    });

    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(observation.candidates[0]?.status).toBe('unavailable');
    expect(
      debug.mock.calls.some(
        (call) => (call[0] as { event?: string }).event === 'jev.unavailable'
      )
    ).toBe(true);
  });

  it('latches SDK load failure so later calls skip without repeated warns', async () => {
    const warn = vi.fn();
    const debug = vi.fn();
    const judge = makeJudge({
      loadModule: () => Promise.reject(new Error('Cannot find module'))
    });

    const first = await judge({
      query: 'q',
      candidates: [baseCandidate],
      logger: { warn, debug }
    });
    const second = await judge({
      query: 'q',
      candidates: [baseCandidate],
      logger: { warn, debug }
    });

    expect(first.candidates[0]?.status).toBe('unavailable');
    expect(second.candidates[0]?.status).toBe('unavailable');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns no judge when enabled without an API key', () => {
    const judge = createJevRetrievalJudge({
      shadowEnabled: true,
      timeoutMs: 1000,
      maxCandidates: 10
    });
    expect(judge).toBeUndefined();
  });
});

describe('resolveEnvJevJudge', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('stays off by default and turns on with JEV_SHADOW_ENABLED=true plus a key', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/postgram');
    vi.stubEnv('JEV_SHADOW_ENABLED', 'false');
    expect(resolveEnvJevJudge()).toBeUndefined();

    vi.stubEnv('JEV_SHADOW_ENABLED', 'true');
    vi.stubEnv('JEV_API_KEY', 'env-key');
    const judge = resolveEnvJevJudge();
    expect(typeof judge).toBe('function');
  });

  it('treats an enabled flag without an API key as judge absent', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/postgram');
    vi.stubEnv('JEV_SHADOW_ENABLED', 'true');
    expect(resolveEnvJevJudge()).toBeUndefined();
  });
});
