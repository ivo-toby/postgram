import { describe, expect, it } from 'vitest';

import type {
  AttachmentDraft,
  Block,
  DocumentLoader,
  LoaderResult,
} from '../../src/types/loader.js';

describe('loader types', () => {
  it('Block discriminated union narrows by kind', () => {
    const blocks: Block[] = [
      { kind: 'text', text: 'hello' },
      { kind: 'heading', level: 2, text: 'h' },
      { kind: 'code', text: 'console.log(1)', language: 'ts' },
      { kind: 'table', rows: [['a', 'b']], caption: 'cap' },
      {
        kind: 'transcript',
        text: 'word',
        startSeconds: 0,
        endSeconds: 1.2,
      },
      { kind: 'image', attachmentRef: 'sha-1', ocrText: 'ocr' },
      { kind: 'audio', attachmentRef: 'sha-2', durationSeconds: 60 },
      {
        kind: 'video',
        attachmentRef: 'sha-3',
        durationSeconds: 90,
        thumbnailRef: 'sha-4',
      },
    ];

    const kinds = blocks.map((b) => b.kind).sort();
    expect(kinds).toEqual([
      'audio',
      'code',
      'heading',
      'image',
      'table',
      'text',
      'transcript',
      'video',
    ]);
  });

  it('AttachmentDraft accepts bytes or path source', () => {
    const drafts: AttachmentDraft[] = [
      {
        ref: 'sha-1',
        kind: 'image',
        mimeType: 'image/png',
        source: { kind: 'bytes', bytes: new Uint8Array([1, 2, 3]) },
      },
      {
        ref: 'sha-2',
        kind: 'audio',
        mimeType: 'audio/mpeg',
        source: { kind: 'path', path: '/tmp/x.mp3' },
      },
    ];

    expect(drafts).toHaveLength(2);
  });

  it('DocumentLoader produces a typed LoaderResult', async () => {
    const loader: DocumentLoader = {
      name: 'noop',
      version: '0.0.0',
      accepts: { mimeTypes: ['text/plain'] },
      async load(): Promise<LoaderResult> {
        return {
          documentType: 'text',
          blocks: [{ kind: 'text', text: 'hi' }],
          metadata: { title: 't' },
        };
      },
    };

    const result = await loader.load(
      { kind: 'bytes', bytes: new Uint8Array(), mimeType: 'text/plain' },
      {
        tmpDir: '/tmp',
        logger: {
          trace: () => {},
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
        fetch: async () => new Response('ok'),
        options: {},
        signal: new AbortController().signal,
      },
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.documentType).toBe('text');
  });
});
