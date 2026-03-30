import { describe, expect, it } from 'vitest';
import { parseExtractionResponse } from '../../src/services/extraction-service.js';

describe('parseExtractionResponse', () => {
  it('parses valid extraction response', () => {
    const response = JSON.stringify([
      { target_name: 'Alice', target_type: 'person', relation: 'involves', confidence: 0.9 },
      { target_name: 'Project X', target_type: 'project', relation: 'part_of', confidence: 0.8 }
    ]);
    const result = parseExtractionResponse(response);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ targetName: 'Alice', relation: 'involves' });
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseExtractionResponse('not json')).toEqual([]);
  });

  it('returns empty array for non-array response', () => {
    expect(parseExtractionResponse('{"key": "value"}')).toEqual([]);
  });

  it('filters out entries with missing required fields', () => {
    const response = JSON.stringify([
      { target_name: 'Valid', target_type: 'person', relation: 'involves', confidence: 0.9 },
      { target_name: '', relation: 'involves', confidence: 0.5 },
      { target_type: 'person', relation: 'involves' }
    ]);
    const result = parseExtractionResponse(response);
    expect(result).toHaveLength(1);
  });
});
