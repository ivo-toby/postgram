import { describe, expect, it } from 'vitest';

import {
  loaderResultSchema,
  parseLoaderResult
} from '../../src/types/loader.js';

import type {
  AttachmentDraft,
  Block,
  DocumentLoader,
  LoaderInput,
  LoaderResult
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
        endSeconds: 1.2
      },
      { kind: 'image', attachmentRef: 'sha-1', ocrText: 'ocr' },
      { kind: 'audio', attachmentRef: 'sha-2', durationSeconds: 60 },
      {
        kind: 'video',
        attachmentRef: 'sha-3',
        durationSeconds: 90,
        thumbnailRef: 'sha-4'
      }
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
      'video'
    ]);
  });

  it('AttachmentDraft accepts bytes or path source', () => {
    const drafts: AttachmentDraft[] = [
      {
        ref: 'sha-1',
        kind: 'image',
        mimeType: 'image/png',
        source: { kind: 'bytes', bytes: new Uint8Array([1, 2, 3]) }
      },
      {
        ref: 'sha-2',
        kind: 'audio',
        mimeType: 'audio/mpeg',
        source: { kind: 'path', path: '/tmp/x.mp3' }
      }
    ];

    expect(drafts).toHaveLength(2);
  });

  it('DocumentLoader produces a typed LoaderResult', async () => {
    const loader: DocumentLoader = {
      name: 'noop',
      version: '0.0.0',
      accepts: { mimeTypes: ['text/plain'] },
      load: (): Promise<LoaderResult> =>
        Promise.resolve({
          documentType: 'text',
          blocks: [{ kind: 'text', text: 'hi' }],
          metadata: { title: 't' }
        })
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
          error: () => {}
        },
        fetch: () => Promise.resolve(new Response('ok')),
        options: {},
        signal: new AbortController().signal
      }
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.documentType).toBe('text');
  });

  it('accepts document attachments and a filename on localPath input', () => {
    const draft: AttachmentDraft = {
      ref: 'r',
      kind: 'document',
      mimeType: 'application/pdf',
      source: { kind: 'bytes', bytes: new Uint8Array() }
    };
    const input: LoaderInput = {
      kind: 'localPath',
      path: '/x/ab/abcdef',
      mimeType: 'application/pdf',
      filename: 'a.pdf'
    };
    expect(draft.kind).toBe('document');
    expect(input.kind === 'localPath' && input.filename).toBe('a.pdf');
  });
});

describe('parseLoaderResult', () => {
  const valid = {
    documentType: 'pdf',
    blocks: [
      { kind: 'heading', level: 2, text: 'Title', metadata: { page: 1 } },
      { kind: 'text', text: 'body' },
      { kind: 'code', text: 'x', language: 'ts' },
      { kind: 'table', rows: [['a'], ['b']], caption: 'c' },
      { kind: 'transcript', text: 't', startSeconds: 0, endSeconds: 1.5 },
      { kind: 'image', attachmentRef: 'r', ocrText: 'o' },
      { kind: 'audio', attachmentRef: 'r', durationSeconds: 3 },
      { kind: 'video', attachmentRef: 'r', durationSeconds: 3 }
    ],
    attachments: [
      {
        ref: 'r',
        kind: 'image',
        mimeType: 'image/png',
        source: { kind: 'bytes', bytes: new Uint8Array([1]) },
        metadata: { w: 1 }
      },
      {
        ref: 'p',
        kind: 'document',
        mimeType: 'application/pdf',
        source: { kind: 'path', path: '/tmp/x' }
      }
    ],
    metadata: { title: 'T' }
  };

  it('accepts a well formed result and returns it', () => {
    const out = parseLoaderResult(valid);
    expect(out.documentType).toBe('pdf');
    expect(out.blocks).toHaveLength(8);
    expect(out.attachments?.[0]?.source).toEqual({
      kind: 'bytes',
      bytes: new Uint8Array([1])
    });
    expect(loaderResultSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a minimal result', () => {
    expect(parseLoaderResult({ documentType: 'x', blocks: [] }).blocks).toEqual(
      []
    );
  });

  const bad = (name: string, mutate: (v: Record<string, unknown>) => unknown) =>
    it(`rejects ${name}`, () => {
      const copy = structuredClone({
        ...valid,
        attachments: undefined
      }) as Record<string, unknown>;
      expect(() => parseLoaderResult(mutate(copy))).toThrow(
        /invalid loader result/
      );
    });

  bad('an empty object', () => ({}));
  bad('a non-object', () => 'nope');
  bad('null', () => null);
  bad('non-string text', (v) => ({
    ...v,
    blocks: [{ kind: 'text', text: 5 }]
  }));
  bad('a huge heading level', (v) => ({
    ...v,
    blocks: [{ kind: 'heading', level: 500000000, text: 'x' }]
  }));
  bad('heading level 0', (v) => ({
    ...v,
    blocks: [{ kind: 'heading', level: 0, text: 'x' }]
  }));
  bad('a fractional heading level', (v) => ({
    ...v,
    blocks: [{ kind: 'heading', level: 1.5, text: 'x' }]
  }));
  bad('an unknown block kind', (v) => ({
    ...v,
    blocks: [{ kind: 'weird', text: 'x' }]
  }));
  bad('table rows that are not string[][]', (v) => ({
    ...v,
    blocks: [{ kind: 'table', rows: [['a', 1]] }]
  }));
  bad('negative seconds', (v) => ({
    ...v,
    blocks: [{ kind: 'transcript', text: 't', startSeconds: -1, endSeconds: 1 }]
  }));
  bad('non-finite seconds', (v) => ({
    ...v,
    blocks: [
      {
        kind: 'transcript',
        text: 't',
        startSeconds: 0,
        endSeconds: Number.POSITIVE_INFINITY
      }
    ]
  }));
  bad('a negative duration', (v) => ({
    ...v,
    blocks: [{ kind: 'audio', attachmentRef: 'r', durationSeconds: -3 }]
  }));
  bad('page 0', (v) => ({
    ...v,
    blocks: [{ kind: 'text', text: 'x', metadata: { page: 0 } }]
  }));
  bad('a fractional page', (v) => ({
    ...v,
    blocks: [{ kind: 'text', text: 'x', metadata: { page: 1.5 } }]
  }));
  bad('array metadata', (v) => ({ ...v, metadata: [] }));
  bad('an attachment without a ref', (v) => ({
    ...v,
    attachments: [
      {
        kind: 'image',
        mimeType: 'image/png',
        source: { kind: 'bytes', bytes: new Uint8Array() }
      }
    ]
  }));
  bad('an unknown attachment kind', (v) => ({
    ...v,
    attachments: [
      {
        ref: 'r',
        kind: 'weird',
        mimeType: 'a/b',
        source: { kind: 'bytes', bytes: new Uint8Array() }
      }
    ]
  }));
  bad('an attachment without a source', (v) => ({
    ...v,
    attachments: [{ ref: 'r', kind: 'image', mimeType: 'a/b' }]
  }));

  it('names the offending path in the error', () => {
    expect(() =>
      parseLoaderResult({
        documentType: 'x',
        blocks: [{ kind: 'text', text: 5 }]
      })
    ).toThrow(/blocks\.0/);
  });
});
