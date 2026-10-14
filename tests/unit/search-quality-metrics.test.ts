import { describe, expect, it } from 'vitest';

import {
  aggregateQualityMetrics,
  calculateQualityMetrics,
  parseQualityLabels,
  type QualityQueryResult
} from '../../benchmarks/search-quality-metrics.js';
import {
  SEARCH_QUALITY_BASE_FIXTURE_COUNT,
  SEARCH_QUALITY_COMMON_TERM_DISTRACTORS_PER_TERM,
  SEARCH_QUALITY_COMMON_TERM_QUERY,
  SEARCH_QUALITY_COMMON_TERM_TARGET_COUNT,
  SEARCH_QUALITY_COMMON_TERM_TARGET_IDS,
  SEARCH_QUALITY_COMMON_TERMS,
  SEARCH_QUALITY_CORPUS,
  SEARCH_QUALITY_DISTRACTOR_COUNT
} from '../../benchmarks/fixtures/search-quality-corpus.js';

describe('search quality fixtures', () => {
  it('contains the moderate distractor corpus used to exercise bounded candidates', () => {
    expect(SEARCH_QUALITY_DISTRACTOR_COUNT).toBeGreaterThan(500);
    expect(SEARCH_QUALITY_CORPUS.fixtures.length).toBe(
      SEARCH_QUALITY_BASE_FIXTURE_COUNT +
        SEARCH_QUALITY_DISTRACTOR_COUNT +
        SEARCH_QUALITY_COMMON_TERMS.length *
          SEARCH_QUALITY_COMMON_TERM_DISTRACTORS_PER_TERM +
        SEARCH_QUALITY_COMMON_TERM_TARGET_COUNT
    );
    expect(SEARCH_QUALITY_CORPUS.queries).toHaveLength(10);
  });

  it('contains crowded single-term matches and late all-term targets', () => {
    const targetPositions = SEARCH_QUALITY_COMMON_TERM_TARGET_IDS.map((id) =>
      SEARCH_QUALITY_CORPUS.fixtures.findIndex((fixture) => fixture.id === id)
    );
    const firstTargetPosition = Math.min(...targetPositions);
    const commonQuery = SEARCH_QUALITY_CORPUS.queries.find(
      (query) => query.query === SEARCH_QUALITY_COMMON_TERM_QUERY
    );

    expect(firstTargetPosition).toBeGreaterThan(
      SEARCH_QUALITY_BASE_FIXTURE_COUNT + SEARCH_QUALITY_DISTRACTOR_COUNT
    );
    for (const term of SEARCH_QUALITY_COMMON_TERMS) {
      const matches = SEARCH_QUALITY_CORPUS.fixtures.filter((fixture) =>
        fixture.content.toLowerCase().includes(term)
      );
      expect(matches.length).toBeGreaterThan(
        SEARCH_QUALITY_COMMON_TERM_DISTRACTORS_PER_TERM
      );
    }
    expect(commonQuery?.expectedTop3Id).toBe(
      SEARCH_QUALITY_COMMON_TERM_TARGET_IDS[0]
    );
    expect(
      Object.values(commonQuery?.grades ?? {}).filter((grade) => grade > 0)
    ).toHaveLength(SEARCH_QUALITY_COMMON_TERM_TARGET_COUNT);
  });

  it('labels every public query with a graded target', () => {
    for (const query of SEARCH_QUALITY_CORPUS.queries) {
      expect(Object.values(query.grades).some((grade) => grade === 2)).toBe(
        true
      );
      expect(query.query.trim()).not.toBe('');
    }

    const categories = new Set(
      SEARCH_QUALITY_CORPUS.queries.map((query) => query.category)
    );
    expect(categories).toEqual(
      new Set([
        'exact_identifier',
        'concise_answer',
        'iso_date',
        'long_keyword_list',
        'dutch',
        'semantic_control',
        'common_terms'
      ])
    );
  });
});

describe('search quality metrics', () => {
  it('computes graded nDCG, reciprocal rank, and recall at ten', () => {
    const metrics = calculateQualityMetrics(
      ['partial', 'target', 'irrelevant'],
      { target: 2, partial: 1, other: 0 }
    );

    const ideal = 3 + 1 / Math.log2(3);
    const observed = 1 + 3 / Math.log2(3);
    expect(metrics.ndcg_at_5).toBe(Number((observed / ideal).toFixed(6)));
    expect(metrics.mrr).toBe(1);
    expect(metrics.recall_at_10).toBe(1);
  });

  it('averages metrics by category without losing query counts', () => {
    const makeResult = (
      category: string,
      query: string,
      metrics: ReturnType<typeof calculateQualityMetrics>
    ): QualityQueryResult => ({
      category,
      query,
      rankedEntityIds: [],
      grades: {},
      metrics
    });

    const report = aggregateQualityMetrics([
      makeResult('exact_identifier', 'one', {
        ndcg_at_5: 1,
        mrr: 1,
        recall_at_10: 1
      }),
      makeResult('exact_identifier', 'two', {
        ndcg_at_5: 0,
        mrr: 0.5,
        recall_at_10: 0
      }),
      makeResult('dutch', 'three', {
        ndcg_at_5: 0.5,
        mrr: 0.5,
        recall_at_10: 1
      })
    ]);

    expect(report.exact_identifier).toEqual({
      query_count: 2,
      ndcg_at_5: 0.5,
      mrr: 0.75,
      recall_at_10: 0.5
    });
    expect(report.dutch).toEqual({
      query_count: 1,
      ndcg_at_5: 0.5,
      mrr: 0.5,
      recall_at_10: 1
    });
  });
});

describe('private search quality labels', () => {
  it('parses graded JSONL and ignores blank lines', () => {
    expect(
      parseQualityLabels([
        '',
        '{"query":"ticket ABC-1234","grades":{"entity-a":2,"entity-b":0}}',
        '  '
      ])
    ).toEqual([
      {
        query: 'ticket ABC-1234',
        grades: { 'entity-a': 2, 'entity-b': 0 }
      }
    ]);
  });

  it('rejects malformed, duplicate, and out-of-range labels', () => {
    expect(() => parseQualityLabels(['{"query":"","grades":{}}'])).toThrow(
      'non-empty query'
    );
    expect(() => parseQualityLabels(['{"query":"empty","grades":{}}'])).toThrow(
      'at least one grade'
    );
    expect(() =>
      parseQualityLabels([
        '{"query":"same","grades":{"entity-a":2}}',
        '{"query":"same","grades":{"entity-a":1}}'
      ])
    ).toThrow('Duplicate');
    expect(() =>
      parseQualityLabels(['{"query":"bad","grades":{"entity-a":3}}'])
    ).toThrow('invalid grade');
  });
});
