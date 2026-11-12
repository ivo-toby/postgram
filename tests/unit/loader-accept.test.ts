import { describe, expect, it } from 'vitest';

import {
  matchesExtension,
  matchesMimeType,
  normalizeMimeType
} from '../../src/services/loaders/accept.js';

describe('normalizeMimeType', () => {
  it('strips parameters, trims and lowercases', () => {
    expect(normalizeMimeType('Application/PDF; charset=binary')).toBe(
      'application/pdf'
    );
    expect(normalizeMimeType('  text/plain  ')).toBe('text/plain');
    expect(normalizeMimeType(undefined)).toBe('');
    expect(normalizeMimeType('')).toBe('');
  });
});

describe('matchesMimeType', () => {
  it('matches exact types case-insensitively', () => {
    expect(
      matchesMimeType({ mimeTypes: ['application/pdf'] }, 'APPLICATION/PDF')
    ).toBe(true);
    expect(
      matchesMimeType({ mimeTypes: ['text/html'] }, 'application/pdf')
    ).toBe(false);
  });

  it('matches wildcards like audio/*', () => {
    expect(matchesMimeType({ mimeTypes: ['audio/*'] }, 'audio/mpeg')).toBe(
      true
    );
    expect(matchesMimeType({ mimeTypes: ['audio/*'] }, 'video/mp4')).toBe(
      false
    );
  });

  it('does not match an empty type or an empty descriptor', () => {
    expect(matchesMimeType({ mimeTypes: ['audio/*'] }, '')).toBe(false);
    expect(matchesMimeType({}, 'audio/mpeg')).toBe(false);
    expect(matchesMimeType({ mimeTypes: [] }, 'audio/mpeg')).toBe(false);
  });
});

describe('matchesExtension', () => {
  it('matches the filename extension case-insensitively', () => {
    expect(
      matchesExtension({ extensions: ['.docx'] }, '/uploads/Report Final.DOCX')
    ).toBe(true);
    expect(matchesExtension({ extensions: ['.pdf'] }, 'a.txt')).toBe(false);
  });

  it('does not match without a filename or extensions', () => {
    expect(matchesExtension({ extensions: ['.pdf'] }, '')).toBe(false);
    expect(matchesExtension({}, 'a.pdf')).toBe(false);
    expect(matchesExtension({ extensions: [] }, 'a.pdf')).toBe(false);
  });
});
