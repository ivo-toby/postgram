import type { Entity, Edge, SearchResult, QueueStatus, GraphData, ListResponse, EntityEmbedding } from './types.ts';

type ApiClientOptions = {
  apiKey: string;
  onUnauthorized: () => void;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
};

async function request<T>(
  apiKey: string,
  onUnauthorized: () => void,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401) {
    onUnauthorized();
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Request failed: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Unexpected content-type: ${contentType}`);
  }
  return response.json() as Promise<T>;
}

export function createApiClient(options: ApiClientOptions) {
  const r = <T>(path: string, req?: RequestOptions) =>
    request<T>(options.apiKey, options.onUnauthorized, path, req);

  return {
    listEntities(params: {
      type?: string;
      status?: string;
      visibility?: string;
      owner?: string;
      tags?: string[];
      limit?: number;
      offset?: number;
    }) {
      const qs = new URLSearchParams();
      if (params.type) qs.set('type', params.type);
      if (params.status) qs.set('status', params.status);
      if (params.visibility) qs.set('visibility', params.visibility);
      if (params.owner) qs.set('owner', params.owner);
      if (params.tags?.length) qs.set('tags', params.tags.join(','));
      qs.set('limit', String(params.limit ?? 100));
      qs.set('offset', String(params.offset ?? 0));
      return r<ListResponse<Entity>>(`/api/entities?${qs}`);
    },

    getEntity(id: string) {
      return r<{ entity: Entity }>(`/api/entities/${id}`);
    },

    createEntity(input: {
      type: string;
      content?: string;
      visibility?: string;
      owner?: string;
      status?: string;
      tags?: string[];
      source?: string;
      metadata?: Record<string, unknown>;
    }) {
      return r<{ entity: Entity }>('/api/entities', { method: 'POST', body: input });
    },

    updateEntity(id: string, input: {
      version: number;
      content?: string | null;
      visibility?: string;
      status?: string | null;
      tags?: string[];
      source?: string | null;
      metadata?: Record<string, unknown>;
    }) {
      return r<{ entity: Entity }>(`/api/entities/${id}`, { method: 'PATCH', body: input });
    },

    deleteEntity(id: string) {
      return r<{ id: string; deleted: true }>(`/api/entities/${id}`, { method: 'DELETE' });
    },

    searchEntities(input: {
      query: string;
      type?: string;
      tags?: string[];
      visibility?: string;
      owner?: string;
      limit?: number;
      threshold?: number;
      recency_weight?: number;
      expand_graph?: boolean;
    }) {
      return r<{ results: SearchResult[] }>('/api/search', { method: 'POST', body: input });
    },

    expandGraph(entityId: string, params: { depth?: number; relation_types?: string[]; owner?: string } = {}) {
      const qs = new URLSearchParams();
      if (params.depth !== undefined) qs.set('depth', String(params.depth));
      if (params.relation_types?.length) qs.set('relation_types', params.relation_types.join(','));
      if (params.owner) qs.set('owner', params.owner);
      const query = qs.toString();
      return r<GraphData>(`/api/entities/${entityId}/graph${query ? `?${query}` : ''}`);
    },

    listEdges(entityId: string, params: { relation?: string; direction?: string } = {}) {
      const qs = new URLSearchParams();
      if (params.relation) qs.set('relation', params.relation);
      if (params.direction) qs.set('direction', params.direction);
      const query = qs.toString();
      return r<{ edges: Edge[] }>(`/api/entities/${entityId}/edges${query ? `?${query}` : ''}`);
    },

    createEdge(input: {
      source_id: string;
      target_id: string;
      relation: string;
      confidence?: number;
      metadata?: Record<string, unknown>;
    }) {
      return r<{ edge: Edge }>('/api/edges', { method: 'POST', body: input });
    },

    deleteEdge(id: string) {
      return r<{ id: string; deleted: true }>(`/api/edges/${id}`, { method: 'DELETE' });
    },

    getQueueStatus() {
      return r<QueueStatus>('/api/queue');
    },

    getEmbeddings(ids: string[]) {
      const qs = new URLSearchParams({ ids: ids.join(',') });
      return r<{ embeddings: EntityEmbedding[] }>(`/api/entities/embeddings?${qs}`);
    },

    getHealth() {
      return r<{ status: string }>('/health');
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
