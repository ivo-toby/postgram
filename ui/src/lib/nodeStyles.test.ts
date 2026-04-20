import { describe, it, expect } from 'vitest';
import { getNodeColor, getNodeSize, getNodeOpacity, ENTITY_COLORS } from './nodeStyles.ts';

describe('getNodeColor', () => {
  it('returns type-specific color for known types', () => {
    expect(getNodeColor('document')).toBe(ENTITY_COLORS['document']);
    expect(getNodeColor('memory')).toBe(ENTITY_COLORS['memory']);
    expect(getNodeColor('person')).toBe(ENTITY_COLORS['person']);
  });

  it('returns fallback color for unknown type', () => {
    expect(getNodeColor('unknown_type')).toBe(ENTITY_COLORS['default']);
  });
});

describe('getNodeSize', () => {
  it('returns larger size for document nodes with more edges', () => {
    expect(getNodeSize('document', 20)).toBeGreaterThan(getNodeSize('document', 2));
  });

  it('returns fixed size for memory regardless of edge count', () => {
    expect(getNodeSize('memory', 0)).toBe(getNodeSize('memory', 100));
  });

  it('caps size at 20 for very high edge counts', () => {
    expect(getNodeSize('document', 10000)).toBe(20);
  });
});

describe('getNodeOpacity', () => {
  it('returns 0.6 for pending enrichment', () => {
    expect(getNodeOpacity('pending')).toBe(0.6);
  });

  it('returns 1.0 for completed enrichment', () => {
    expect(getNodeOpacity('completed')).toBe(1.0);
  });

  it('returns 1.0 for null enrichment status', () => {
    expect(getNodeOpacity(null)).toBe(1.0);
  });
});
