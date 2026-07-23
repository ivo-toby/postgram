import { describe, expect, it } from 'vitest';

import {
  applyRecencyBoost,
  blendScores,
  buildSearchEdgeSummaries,
  deduplicateResults,
  normalizeBm25Scores,
  searchEntities
} from '../../src/services/search-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import type { EmbeddingService } from '../../src/services/embedding-service.js';

describe('applyRecencyBoost', () => {
  it('boosts newer results more than older ones', () => {
    const newer = applyRecencyBoost({
      similarity: 0.8,
      ageDays: 1,
      recencyWeight: 0.1,
      halfLifeDays: 30
    });
    const older = applyRecencyBoost({
      similarity: 0.8,
      ageDays: 90,
      recencyWeight: 0.1,
      halfLifeDays: 30
    });

    expect(newer).toBeGreaterThan(older);
    expect(newer).toBeGreaterThan(0.8);
  });
});

describe('normalizeBm25Scores', () => {
  it('normalizes scores to 0-1 range by dividing by max', () => {
    const results = [
      { bm25: 0.6, id: 'a' },
      { bm25: 0.3, id: 'b' },
      { bm25: 0.0, id: 'c' }
    ];
    const normalized = normalizeBm25Scores(results);

    expect(normalized[0]?.bm25).toBeCloseTo(1.0);
    expect(normalized[1]?.bm25).toBeCloseTo(0.5);
    expect(normalized[2]?.bm25).toBeCloseTo(0.0);
  });

  it('returns all zeros when no keyword matches', () => {
    const results = [
      { bm25: 0, id: 'a' },
      { bm25: 0, id: 'b' }
    ];
    const normalized = normalizeBm25Scores(results);

    expect(normalized[0]?.bm25).toBe(0);
    expect(normalized[1]?.bm25).toBe(0);
  });
});

describe('blendScores', () => {
  it('blends vector and bm25 scores with 0.6/0.4 weights', () => {
    const score = blendScores(0.8, 0.5);
    expect(score).toBeCloseTo(0.68);
  });

  it('returns vector-only score when bm25 is zero', () => {
    const score = blendScores(0.8, 0);
    expect(score).toBeCloseTo(0.48);
  });

  it('returns bm25-only score when vector is zero', () => {
    const score = blendScores(0, 1.0);
    expect(score).toBeCloseTo(0.4);
  });
});

describe('deduplicateResults', () => {
  it('keeps only the best chunk per entity', () => {
    const deduplicated = deduplicateResults([
      { entityId: 'a', score: 0.9, chunkContent: 'best chunk' },
      { entityId: 'a', score: 0.8, chunkContent: 'worse chunk' },
      { entityId: 'b', score: 0.7, chunkContent: 'other chunk' }
    ]);

    expect(deduplicated).toEqual([
      { entityId: 'a', score: 0.9, chunkContent: 'best chunk' },
      { entityId: 'b', score: 0.7, chunkContent: 'other chunk' }
    ]);
  });
});

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

describe('searchEntities graph expansion', () => {
  it('derives edge summaries from expanded graph rows without a standalone summary query', async () => {
    const anchorId = '00000000-0000-0000-0000-000000000001';
    const neighborId = '00000000-0000-0000-0000-000000000002';
    const queries: string[] = [];
    const createdAt = new Date('2026-06-01T00:00:00.000Z');

    const pool = {
      query: (sql: string) => {
        queries.push(sql);

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
                score: 0.88
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

    const auth: AuthContext = {
      apiKeyId: '00000000-0000-0000-0000-000000000104',
      keyName: 'search-key',
      clientId: 'search-key',
      scopes: ['read'],
      allowedTypes: null,
      allowedVisibility: ['personal', 'work', 'shared']
    };

    const embeddingService: EmbeddingService = {
      dimensions: 3,
      embedBatch: () => Promise.resolve([[1, 0, 0]]),
      embedQuery: () => Promise.resolve([1, 0, 0]),
      getActiveModel: () => Promise.resolve({
        id: '00000000-0000-0000-0000-0000000000aa',
        name: 'test-model',
        provider: 'deterministic',
        dimensions: 3,
        chunkSize: 1000,
        chunkOverlap: 100,
        metadata: {},
        createdAt: '2026-06-01T00:00:00.000Z'
      })
    };

    const result = await searchEntities(
      pool as never,
      auth,
      {
        query: 'compact search',
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
    expect(queries.find((sql) => sql.includes('FROM chunks c'))).toContain(
      'ROW_NUMBER() OVER'
    );
  });
});
