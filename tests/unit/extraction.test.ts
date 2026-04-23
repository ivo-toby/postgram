import { describe, expect, it } from 'vitest';
import {
  EXTRACTION_SCHEMA,
  parseExtractionResponse
} from '../../src/services/extraction-service.js';

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

  it('wraps a bare object (lax model output) into a single-item list', () => {
    const response = JSON.stringify({
      target_name: 'Alice',
      target_type: 'person',
      relation: 'involves',
      confidence: 0.9
    });
    const result = parseExtractionResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ targetName: 'Alice', relation: 'involves' });
  });

  it('strips ```json markdown fences before parsing', () => {
    const response =
      '```json\n[{"target_name":"Bob","relation":"involves","confidence":0.8}]\n```';
    const result = parseExtractionResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ targetName: 'Bob', relation: 'involves' });
  });

  it('strips plain ``` fences before parsing', () => {
    const response =
      '```\n{"relationships":[{"target_name":"Carol","relation":"part_of"}]}\n```';
    const result = parseExtractionResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ targetName: 'Carol', relation: 'part_of' });
  });
});

describe('EXTRACTION_SCHEMA', () => {
  it('is a JSON schema describing a relationships array', () => {
    expect(EXTRACTION_SCHEMA.type).toBe('object');
    const rel = EXTRACTION_SCHEMA.properties.relationships;
    expect(rel.type).toBe('array');
    expect(rel.items.type).toBe('object');
    expect(rel.items.required).toEqual(['target_name', 'relation']);
  });

  it('constrains target_type and relation to the supported enums', () => {
    const props = EXTRACTION_SCHEMA.properties.relationships.items.properties;
    expect(props.target_type.enum).toEqual([
      'memory',
      'person',
      'project',
      'task',
      'interaction',
      'document'
    ]);
    expect(props.relation.enum).toEqual([
      'involves',
      'assigned_to',
      'part_of',
      'blocked_by',
      'mentioned_in',
      'related_to'
    ]);
  });
});
