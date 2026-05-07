import { describe, expect, it } from 'vitest';

import { accepts } from '../../src/services/loaders/accept.js';

describe('accepts', () => {
  it('matches by exact mime type for bytes inputs', () => {
    expect(
      accepts(
        { mimeTypes: ['application/pdf'] },
        { kind: 'bytes', bytes: new Uint8Array(), mimeType: 'application/pdf' },
      ),
    ).toBe(true);
  });

  it('matches mime wildcards like audio/*', () => {
    expect(
      accepts(
        { mimeTypes: ['audio/*'] },
        { kind: 'bytes', bytes: new Uint8Array(), mimeType: 'audio/mpeg' },
      ),
    ).toBe(true);
    expect(
      accepts(
        { mimeTypes: ['audio/*'] },
        { kind: 'bytes', bytes: new Uint8Array(), mimeType: 'video/mp4' },
      ),
    ).toBe(false);
  });

  it('falls back to filename extension when mime does not match', () => {
    expect(
      accepts(
        { mimeTypes: ['application/pdf'], extensions: ['.pdf'] },
        {
          kind: 'bytes',
          bytes: new Uint8Array(),
          mimeType: 'application/octet-stream',
          filename: 'paper.PDF',
        },
      ),
    ).toBe(true);
  });

  it('matches URLs against url patterns', () => {
    expect(
      accepts(
        { urlPatterns: ['^https?://(www\\.)?youtube\\.com/watch'] },
        { kind: 'url', url: 'https://www.youtube.com/watch?v=abc' },
      ),
    ).toBe(true);
    expect(
      accepts(
        { urlPatterns: ['^https?://(www\\.)?youtube\\.com/watch'] },
        { kind: 'url', url: 'https://example.com/x' },
      ),
    ).toBe(false);
  });

  it('matches URLs by path extension when mimeType is missing', () => {
    expect(
      accepts(
        { extensions: ['.pdf'] },
        { kind: 'url', url: 'https://example.com/files/paper.pdf' },
      ),
    ).toBe(true);
  });

  it('returns false when accepts has no matching dimension', () => {
    expect(
      accepts(
        { mimeTypes: ['text/html'] },
        { kind: 'bytes', bytes: new Uint8Array(), mimeType: 'application/pdf' },
      ),
    ).toBe(false);
  });

  it('handles localPath input with extension fallback', () => {
    expect(
      accepts(
        { extensions: ['.docx'] },
        {
          kind: 'localPath',
          path: '/uploads/Report Final.docx',
          mimeType: 'application/octet-stream',
        },
      ),
    ).toBe(true);
  });
});
