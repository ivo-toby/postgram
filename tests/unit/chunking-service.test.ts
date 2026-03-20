import { describe, expect, it } from 'vitest';

import { chunkText } from '../../src/services/chunking-service.js';

describe('chunkText', () => {
  it('returns a single chunk for short content', () => {
    const chunks = chunkText('short note about pgvector');

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      chunkIndex: 0,
      content: 'short note about pgvector'
    });
    expect(chunks[0]?.tokenCount).toBeGreaterThan(0);
  });

  it('splits long content with overlap and stable ordering', () => {
    const sentence = 'postgres vector search makes retrieval fast and local. ';
    const content = sentence.repeat(20);

    const chunks = chunkText(content, {
      chunkSize: 120,
      overlap: 30
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(
      chunks.map((_, index) => index)
    );
    expect(chunks[1]?.content).toContain(
      chunks[0]?.content.slice(-20).trim().split(/\s+/)[0] ?? ''
    );
  });
});
