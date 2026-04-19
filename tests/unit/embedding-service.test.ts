import { describe, expect, it, vi } from 'vitest';

import { createEmbeddingService } from '../../src/services/embedding-service.js';
import type { EmbeddingProvider } from '../../src/services/embeddings/providers.js';

type ProviderWithMocks = EmbeddingProvider & {
  embedBatchMock: ReturnType<typeof vi.fn>;
  embedMock: ReturnType<typeof vi.fn>;
};

function makeProvider(): ProviderWithMocks {
  const embedBatchMock = vi.fn().mockResolvedValue([[0.25, 0.75]]);
  const embedMock = vi.fn().mockResolvedValue([0.25, 0.75]);
  return {
    name: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 2,
    embed: embedMock as unknown as EmbeddingProvider['embed'],
    embedBatch: embedBatchMock as unknown as EmbeddingProvider['embedBatch'],
    embedBatchMock,
    embedMock
  };
}

describe('embedding-service', () => {
  it('delegates embedBatch to the injected provider when given one', async () => {
    const provider = makeProvider();

    const service = createEmbeddingService({ provider });

    const vectors = await service.embedBatch(['hello world'], {
      id: 'model-1',
      name: 'text-embedding-3-small',
      provider: 'openai',
      dimensions: 2,
      chunkSize: 300,
      chunkOverlap: 100,
      metadata: {},
      createdAt: new Date().toISOString()
    });

    expect(provider.embedBatchMock).toHaveBeenCalledWith(['hello world']);
    expect(vectors).toEqual([[0.25, 0.75]]);
  });

  it('uses deterministic mode by default under vitest', async () => {
    const service = createEmbeddingService();
    const vectors = await service.embedBatch(['hello']);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(1536);
  });

  it('rejects when the active model dimensions disagree with the provider', async () => {
    const provider = makeProvider();
    const service = createEmbeddingService({ provider });

    await expect(
      service.embedBatch(['hi'], {
        id: 'model-1',
        name: 'text-embedding-3-small',
        provider: 'openai',
        dimensions: 1536,
        chunkSize: 300,
        chunkOverlap: 100,
        metadata: {},
        createdAt: new Date().toISOString()
      })
    ).rejects.toMatchObject({
      message: 'Active model dimensions do not match provider dimensions'
    });
  });
});
