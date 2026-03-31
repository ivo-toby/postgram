import { describe, expect, it, vi } from 'vitest';

import { createEmbeddingService } from '../../src/services/embedding-service.js';

describe('embedding-service', () => {
  it('uses the active model when running in openai mode', async () => {
    const create = vi.fn().mockResolvedValue({
      data: [
        {
          index: 0,
          embedding: [0.25, 0.75]
        }
      ]
    });

    const service = createEmbeddingService({
      mode: 'openai',
      client: {
        embeddings: {
          create
        }
      } as never
    });

    const vectors = await service.embedBatch(
      ['hello world'],
      {
        id: 'model-1',
        name: 'text-embedding-3-small',
        provider: 'openai',
        dimensions: 2,
        chunkSize: 300,
        chunkOverlap: 100,
        metadata: {},
        createdAt: new Date().toISOString()
      }
    );

    expect(create).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['hello world'],
      encoding_format: 'float'
    });
    expect(vectors).toEqual([[0.25, 0.75]]);
  });
});
