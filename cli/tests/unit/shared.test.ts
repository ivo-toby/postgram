import { describe, expect, it } from 'vitest';
import { parseCommaList, parseJsonObject, shortId } from '../../src/shared.js';
import { AppError, ErrorCode } from '../../src/errors.js';

describe('parseCommaList', () => {
  it('returns undefined for undefined input', () => {
    expect(parseCommaList(undefined)).toBeUndefined();
  });

  it('splits comma-separated values and trims whitespace', () => {
    expect(parseCommaList('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  it('filters empty strings', () => {
    expect(parseCommaList('a,,b')).toEqual(['a', 'b']);
  });

  it('returns undefined for all-empty result', () => {
    expect(parseCommaList(' , , ')).toBeUndefined();
  });
});

describe('parseJsonObject', () => {
  it('returns fallback for undefined', () => {
    expect(parseJsonObject(undefined)).toEqual({});
  });

  it('parses valid JSON object', () => {
    expect(parseJsonObject('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('throws for non-object JSON', () => {
    expect(() => parseJsonObject('[1,2]')).toThrow(AppError);
  });

  it('throws for invalid JSON', () => {
    expect(() => parseJsonObject('not json')).toThrow();
  });
});

describe('shortId', () => {
  it('returns first 8 characters', () => {
    expect(shortId('abcdefgh-1234-5678')).toBe('abcdefgh');
  });
});