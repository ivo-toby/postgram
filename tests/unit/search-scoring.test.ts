import { describe, expect, it } from 'vitest';

import {
  applyRecencyBoost,
  blendScores,
  deduplicateResults,
  normalizeBm25Scores
} from '../../src/services/search-service.js';

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
