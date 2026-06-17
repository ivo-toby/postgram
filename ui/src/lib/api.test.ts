import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiClient } from './api.ts';
import type { Entity } from './types.ts';

function taskEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'task-1',
    type: 'task',
    content: 'Task content',
    visibility: 'personal',
    owner: null,
    status: 'inbox',
    enrichment_status: null,
    version: 1,
    tags: [],
    source: null,
    metadata: {},
    created_at: '2026-06-08T08:00:00.000Z',
    updated_at: '2026-06-08T08:00:00.000Z',
    ...overrides,
  };
}

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

  it('passes memory role when listing entities', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 100, offset: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'test-key', onUnauthorized: vi.fn() });
    await client.listEntities({ type: 'memory', memory_role: 'session_context' });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/entities?type=memory&memory_role=session_context&limit=100&offset=0',
      expect.any(Object)
    );
  });

  it('passes memory role when searching entities', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'test-key', onUnauthorized: vi.fn() });
    await client.searchEntities({
      query: 'active context',
      type: 'memory',
      memory_role: 'session_context',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          query: 'active context',
          type: 'memory',
          memory_role: 'session_context',
        }),
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

  it('POSTs entity IDs in the body when fetching embeddings', async () => {
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
      '/api/entities/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ ids: ['id-1', 'id-2', 'id-3'] }),
      })
    );
  });

  it('POSTs entity IDs when bulk archiving entities', async () => {
    const mockFetch = vi.mocked(fetch);
    const response = {
      archived: [{ id: 'id-1' }],
      failed: [{ id: 'id-2', code: 'FORBIDDEN', message: 'Entity not found or not deletable' }],
    };
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'key', onUnauthorized: vi.fn() });
    await expect(client.bulkArchiveEntities(['id-1', 'id-2'])).resolves.toEqual(response);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/entities/bulk/archive',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ ids: ['id-1', 'id-2'] }),
      })
    );
  });

  it('lists tasks with status, pagination, and context filters', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 50 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'key', onUnauthorized: vi.fn() });
    await client.listTasks({ status: 'inbox', context: '@home', limit: 25, offset: 50 });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks?status=inbox&context=%40home&limit=25&offset=50',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer key' }),
      })
    );
  });

  it('PATCHes task updates with optimistic locking fields', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ entity: taskEntity({ id: 'task-1', version: 3, status: 'next' }) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'key', onUnauthorized: vi.fn() });
    await client.updateTask('task-1', {
      version: 2,
      status: 'next',
      content: 'Review note',
      context: '@desk',
      due_date: '2026-06-09',
      metadata: { priority: 2, scheduled_for: '2026-06-10' },
      tags: ['review'],
      visibility: 'personal',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/task-1',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: 'Bearer key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          version: 2,
          status: 'next',
          content: 'Review note',
          context: '@desk',
          due_date: '2026-06-09',
          metadata: { priority: 2, scheduled_for: '2026-06-10' },
          tags: ['review'],
          visibility: 'personal',
        }),
      })
    );
  });

  it('completes tasks through the completion endpoint', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ entity: taskEntity({ id: 'task-1', version: 4, status: 'done' }) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = createApiClient({ apiKey: 'key', onUnauthorized: vi.fn() });
    await client.completeTask('task-1', 3);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/task-1/complete',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ version: 3 }),
      })
    );
  });
});
