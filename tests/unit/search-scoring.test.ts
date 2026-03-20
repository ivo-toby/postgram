import { describe, expect, it } from 'vitest';

import {
  applyRecencyBoost,
  deduplicateResults
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
