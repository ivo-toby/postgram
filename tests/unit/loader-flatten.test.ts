import { describe, expect, it } from 'vitest';

import {
  flattenLoaderResult,
  loaderResultToContent,
} from '../../src/services/loaders/flatten.js';
import type { LoaderResult } from '../../src/types/loader.js';

describe('flattenLoaderResult', () => {
  it('converts a single text block into one chunk', () => {
    const drafts = flattenLoaderResult({
      documentType: 'text',
      blocks: [{ kind: 'text', text: 'hello world' }],
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.content).toBe('hello world');
    expect(drafts[0]?.blockKind).toBe('text');
  });

  it('renders headings as Markdown with the correct level', () => {
    const drafts = flattenLoaderResult({
      documentType: 'doc',
      blocks: [{ kind: 'heading', level: 3, text: 'Section' }],
    });
    expect(drafts[0]?.content).toBe('### Section');
    expect(drafts[0]?.blockKind).toBe('heading');
  });

  it('preserves block metadata onto the chunk draft', () => {
    const drafts = flattenLoaderResult({
      documentType: 'pdf',
      blocks: [
        {
          kind: 'text',
          text: 'page three contents',
          metadata: { page: 3 },
        },
      ],
    });
    expect(drafts[0]?.blockMetadata).toEqual({ page: 3 });
  });

  it('captures transcript timing into block metadata', () => {
    const drafts = flattenLoaderResult({
      documentType: 'audio',
      blocks: [
        {
          kind: 'transcript',
          text: 'we discussed the migration',
          startSeconds: 124.2,
          endSeconds: 137.8,
          speaker: 'alice',
          metadata: { source: 'asr' },
        },
      ],
    });
    expect(drafts[0]?.content).toBe('alice: we discussed the migration');
    expect(drafts[0]?.blockMetadata).toMatchObject({
      source: 'asr',
      startSeconds: 124.2,
      endSeconds: 137.8,
      speaker: 'alice',
    });
  });

  it('emits OCR text and caption as separate chunks for image blocks', () => {
    const drafts = flattenLoaderResult({
      documentType: 'pdf',
      blocks: [
        {
          kind: 'image',
          attachmentRef: 'sha-1',
          ocrText: 'Figure 1: Architecture',
          caption: 'A diagram of the loader pipeline',
          metadata: { page: 5 },
        },
      ],
    });
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.content).toBe('Figure 1: Architecture');
    expect(drafts[0]?.blockMetadata.source).toBe('ocr');
    expect(drafts[0]?.blockMetadata.attachmentRef).toBe('sha-1');
    expect(drafts[1]?.content).toBe('A diagram of the loader pipeline');
    expect(drafts[1]?.blockMetadata.source).toBe('caption-model');
  });

  it('falls back to alt when image has no ocr/caption', () => {
    const drafts = flattenLoaderResult({
      documentType: 'pdf',
      blocks: [
        { kind: 'image', attachmentRef: 'sha-2', alt: 'company logo' },
      ],
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.content).toBe('company logo');
  });

  it('emits no chunks for bare audio/video blocks (transcript carries text)', () => {
    const drafts = flattenLoaderResult({
      documentType: 'video',
      blocks: [
        { kind: 'audio', attachmentRef: 'a', durationSeconds: 30 },
        { kind: 'video', attachmentRef: 'v', durationSeconds: 90 },
      ],
    });
    expect(drafts).toHaveLength(0);
  });

  it('renders tables as Markdown', () => {
    const drafts = flattenLoaderResult({
      documentType: 'doc',
      blocks: [
        {
          kind: 'table',
          rows: [
            ['col1', 'col2'],
            ['a', 'b'],
          ],
          caption: 'sample',
        },
      ],
    });
    expect(drafts[0]?.content).toContain('**sample**');
    expect(drafts[0]?.content).toContain('| col1 | col2 |');
    expect(drafts[0]?.content).toContain('| --- | --- |');
    expect(drafts[0]?.content).toContain('| a | b |');
  });

  it('splits oversized blocks via chunkText, duplicating block metadata', () => {
    const longText = 'word '.repeat(300).trim();
    const drafts = flattenLoaderResult(
      {
        documentType: 'doc',
        blocks: [
          { kind: 'text', text: longText, metadata: { page: 9 } },
        ],
      },
      { maxChunkSize: 80 },
    );
    expect(drafts.length).toBeGreaterThan(1);
    for (const d of drafts) {
      expect(d.blockKind).toBe('text');
      expect(d.blockMetadata).toEqual({ page: 9 });
    }
  });

  it('assigns sequential chunkIndex across blocks', () => {
    const drafts = flattenLoaderResult({
      documentType: 'doc',
      blocks: [
        { kind: 'heading', level: 1, text: 'Title' },
        { kind: 'text', text: 'Body one' },
        { kind: 'text', text: 'Body two' },
      ],
    });
    expect(drafts.map((d) => d.chunkIndex)).toEqual([0, 1, 2]);
  });
});

describe('loaderResultToContent', () => {
  it('joins block renderings with blank lines', () => {
    const result: LoaderResult = {
      documentType: 'doc',
      blocks: [
        { kind: 'heading', level: 2, text: 'Title' },
        { kind: 'text', text: 'Paragraph one.' },
        { kind: 'text', text: 'Paragraph two.' },
      ],
    };
    expect(loaderResultToContent(result)).toBe(
      '## Title\n\nParagraph one.\n\nParagraph two.',
    );
  });
});
