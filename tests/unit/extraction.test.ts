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

  it('parses object-wrapped response from OpenAI JSON mode', () => {
    const response = JSON.stringify({
      relationships: [
        { target_name: 'Bob', target_type: 'person', relation: 'involves', confidence: 0.85 }
      ]
    });
    const result = parseExtractionResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ targetName: 'Bob', relation: 'involves' });
  });

  it('returns empty array for object with no array values', () => {
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
