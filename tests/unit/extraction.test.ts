import { describe, expect, it } from 'vitest';
import {
  buildExtractionPrompt,
  EXTRACTION_SCHEMA,
  RELATIONS,
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
    expect(rel.items.required).toEqual(['target_name', 'target_type', 'relation']);
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
    // The expanded vocabulary gives the model alternatives to mentioned_in
    // (which previously dominated extracted edges). All relations referenced
    // in the prompt examples must be present in the schema enum.
    expect(props.relation.enum).toEqual([...RELATIONS]);
    for (const expected of [
      'involves',
      'assigned_to',
      'part_of',
      'blocked_by',
      'related_to',
      'supersedes',
      'derived_from',
      'caused_by',
      'discussed_with',
      'references',
      'mentioned_in'
    ]) {
      expect(props.relation.enum).toContain(expected);
    }
  });
});

describe('buildExtractionPrompt', () => {
  it('embeds the entity type and content', () => {
    const prompt = buildExtractionPrompt('memory', 'Alice helped review the design');
    expect(prompt).toContain('Type: memory');
    expect(prompt).toContain('Alice helped review the design');
  });

  it('explains edge direction (source -> target)', () => {
    const prompt = buildExtractionPrompt('memory', 'x');
    // The model previously had no direction guidance and produced bidirectional-
    // feeling `mentioned_in` for everything. Direction must be explicit.
    expect(prompt.toLowerCase()).toContain('from this entity');
    expect(prompt.toLowerCase()).toContain('to the target');
  });

  it('lists every relation in the schema enum', () => {
    const prompt = buildExtractionPrompt('memory', 'x');
    for (const relation of RELATIONS) {
      expect(prompt).toContain(relation);
    }
  });

  it('includes at least one example per relation type', () => {
    const prompt = buildExtractionPrompt('memory', 'x');
    // Every relation should appear inside a JSON-shaped example block.
    // Counting `"relation": "<name>"` occurrences keeps the assertion robust
    // against prompt rewording.
    for (const relation of RELATIONS) {
      expect(prompt).toContain(`"relation": "${relation}"`);
    }
  });

  it('tells the model to prefer specific relations over mentioned_in', () => {
    const prompt = buildExtractionPrompt('memory', 'x');
    expect(prompt.toLowerCase()).toContain('prefer specific relations over mentioned_in');
  });

  it('tells the model that short content can still have relationships', () => {
    const prompt = buildExtractionPrompt('memory', 'x');
    expect(prompt.toLowerCase()).toContain('short content');
  });

  it('includes type guidance for person, project, task, interaction, memory, document', () => {
    const prompt = buildExtractionPrompt('memory', 'x');
    for (const type of ['person', 'project', 'task', 'interaction', 'memory', 'document']) {
      expect(prompt).toContain(`- ${type}:`);
    }
  });
});
