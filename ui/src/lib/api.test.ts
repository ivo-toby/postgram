import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiClient } from './api.ts';

describe('createApiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('injects Authorization header', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 100, offset: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'test-key', onUnauthorized: vi.fn() });
    await client.listEntities({});

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/entities?limit=100&offset=0',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      })
    );
  });

  it('calls onUnauthorized on 401', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const onUnauthorized = vi.fn();
    const client = createApiClient({ apiKey: 'bad-key', onUnauthorized });
    await expect(client.listEntities({})).rejects.toThrow();
    expect(onUnauthorized).toHaveBeenCalled();
  });

  it('throws on non-401 errors', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Not found' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'key', onUnauthorized: vi.fn() });
    await expect(client.getEntity('some-id')).rejects.toThrow('Not found');
  });

  it('encodes entity IDs when fetching embeddings', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ embeddings: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'key', onUnauthorized: vi.fn() });
    await client.getEmbeddings(['id-1', 'id-2', 'id-3']);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/entities/embeddings?ids=id-1%2Cid-2%2Cid-3',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer key' }),
      })
    );
  });
});
