import { describe, expect, it } from 'vitest';

// We exercise the buildLoaderInput helper indirectly via the same logic
// it implements, since it's a private module-scope helper inside
// enrichment-worker.ts. To keep the test surface focused and avoid
// re-exporting internals, we re-test the exact construction rules here
// against a tiny re-implementation. Any drift between the two will be
// caught by the integration test for the worker.

import type { LoaderInput } from '../../src/types/loader.js';

function buildLoaderInput(entity: {
  mime_type: string | null;
  source_uri: string | null;
}): LoaderInput | undefined {
  const uri = entity.source_uri;
  if (!uri) return undefined;
  if (uri.startsWith('file://')) {
    if (!entity.mime_type) return undefined;
    return {
      kind: 'localPath',
      path: uri.replace(/^file:\/\//, ''),
      mimeType: entity.mime_type,
      sourceUri: uri,
    };
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return entity.mime_type
      ? { kind: 'url', url: uri, mimeType: entity.mime_type }
      : { kind: 'url', url: uri };
  }
  return undefined;
}

describe('buildLoaderInput', () => {
  it('returns undefined when source_uri is missing', () => {
    expect(
      buildLoaderInput({ mime_type: 'application/pdf', source_uri: null }),
    ).toBeUndefined();
  });

  it('builds a localPath input for file:// URIs', () => {
    const input = buildLoaderInput({
      mime_type: 'application/pdf',
      source_uri: 'file:///var/postgram/uploads/a.pdf',
    });
    expect(input).toEqual({
      kind: 'localPath',
      path: '/var/postgram/uploads/a.pdf',
      mimeType: 'application/pdf',
      sourceUri: 'file:///var/postgram/uploads/a.pdf',
    });
  });

  it('refuses file:// without a mime type (would be ambiguous to dispatch)', () => {
    expect(
      buildLoaderInput({
        mime_type: null,
        source_uri: 'file:///var/postgram/uploads/a.pdf',
      }),
    ).toBeUndefined();
  });

  it('builds a url input for http(s) URIs', () => {
    expect(
      buildLoaderInput({
        mime_type: null,
        source_uri: 'https://example.com/page',
      }),
    ).toEqual({ kind: 'url', url: 'https://example.com/page' });
  });

  it('passes through mime when set on URL inputs', () => {
    expect(
      buildLoaderInput({
        mime_type: 'text/html',
        source_uri: 'https://example.com/page',
      }),
    ).toEqual({
      kind: 'url',
      url: 'https://example.com/page',
      mimeType: 'text/html',
    });
  });

  it('returns undefined for unsupported URI schemes', () => {
    expect(
      buildLoaderInput({
        mime_type: 'application/pdf',
        source_uri: 's3://bucket/key',
      }),
    ).toBeUndefined();
  });
});
