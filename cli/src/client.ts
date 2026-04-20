import { AppError, ErrorCode } from './errors.js';

export type StoredEntityResponse = {
  entity: {
    id: string;
    type: string;
    content: string | null;
    visibility: string;
    owner: string | null;
    status: string | null;
    enrichment_status: string | null;
    version: number;
    tags: string[];
    source: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  };
};

export type SearchResponse = {
  results: Array<{
    entity: StoredEntityResponse['entity'];
    chunk_content: string;
    similarity: number;
    score: number;
    related?: Array<{
      entity: { id: string; type: string; content: string | null; metadata: Record<string, unknown> };
      relation: string;
      direction: 'incoming' | 'outgoing';
    }>;
  }>;
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

type RestClientOptions = {
  apiUrl: string;
  apiKey: string;
};

type RequestOptions = {
  method?: string | undefined;
  body?: unknown;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  const payload =
    contentType.includes('application/json')
      ? ((await response.json()) as T)
      : ((await response.text()) as unknown as T);

  return payload;
}

function normalizeErrorBody(body: unknown): ApiErrorBody {
  if (!body || typeof body !== 'object') {
    return {};
  }

  return body as ApiErrorBody;
}

async function request<T>(
  options: RestClientOptions,
  path: string,
  requestOptions: RequestOptions = {}
): Promise<T> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${options.apiKey}`,
    ...(requestOptions.body === undefined
      ? {}
      : {
          'Content-Type': 'application/json'
        })
  };
  const init: RequestInit = {
    method: requestOptions.method ?? 'GET',
    headers
  };

  if (requestOptions.body !== undefined) {
    init.body = JSON.stringify(requestOptions.body);
  }

  const response = await fetch(`${options.apiUrl}${path}`, init);

  if (!response.ok) {
    const body = normalizeErrorBody(await parseResponse<unknown>(response));
    throw new AppError(
      (body.error?.code as ErrorCode | undefined) ?? ErrorCode.INTERNAL,
      body.error?.message ?? `Request failed with status ${response.status}`,
      body.error?.details ?? {}
    );
  }

  return parseResponse<T>(response);
}

export function createPgmClient(options: RestClientOptions) {
  return {
    storeEntity(input: {
      type: string;
      content?: string | undefined;
      visibility?: string | undefined;
      owner?: string | undefined;
      status?: string | undefined;
      tags?: string[] | undefined;
      source?: string | undefined;
      metadata?: Record<string, unknown> | undefined;
    }) {
      return request<StoredEntityResponse>(options, '/api/entities', {
        method: 'POST',
        body: input
      });
    },
    recallEntity(id: string, input: { owner?: string | undefined } = {}) {
      const params = new URLSearchParams();
      if (input.owner) {
        params.set('owner', input.owner);
      }

      const query = params.toString();
      return request<StoredEntityResponse>(
        options,
        `/api/entities/${id}${query ? `?${query}` : ''}`
      );
    },
    searchEntities(input: {
      query: string;
      type?: string | undefined;
      tags?: string[] | undefined;
      visibility?: string | undefined;
      owner?: string | undefined;
      limit?: number | undefined;
      threshold?: number | undefined;
      recency_weight?: number | undefined;
      expand_graph?: boolean | undefined;
    }) {
      return request<SearchResponse>(options, '/api/search', {
        method: 'POST',
        body: input
      });
    },
    updateEntity(
      id: string,
      input: {
        version: number;
        content?: string | null | undefined;
        visibility?: string | undefined;
        status?: string | null | undefined;
        tags?: string[] | undefined;
        source?: string | null | undefined;
        metadata?: Record<string, unknown> | undefined;
      }
    ) {
      return request<StoredEntityResponse>(options, `/api/entities/${id}`, {
        method: 'PATCH',
        body: input
      });
    },
    deleteEntity(id: string) {
      return request<{ id: string; deleted: true }>(
        options,
        `/api/entities/${id}`,
        {
          method: 'DELETE'
        }
      );
    },
    listEntities(input: {
      type?: string | undefined;
      status?: string | undefined;
      visibility?: string | undefined;
      owner?: string | undefined;
      tags?: string[] | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
    } = {}) {
      const params = new URLSearchParams();
      if (input.type) {
        params.set('type', input.type);
      }
      if (input.status) {
        params.set('status', input.status);
      }
      if (input.visibility) {
        params.set('visibility', input.visibility);
      }
      if (input.owner) {
        params.set('owner', input.owner);
      }
      if (input.tags?.length) {
        params.set('tags', input.tags.join(','));
      }
      if (input.limit !== undefined) {
        params.set('limit', String(input.limit));
      }
      if (input.offset !== undefined) {
        params.set('offset', String(input.offset));
      }

      const query = params.toString();
      return request<{
        items: StoredEntityResponse['entity'][];
        total: number;
        limit: number;
        offset: number;
      }>(options, `/api/entities${query ? `?${query}` : ''}`);
    },
    createTask(input: {
      content: string;
      context?: string | undefined;
      status?: string | undefined;
      due_date?: string | undefined;
      tags?: string[] | undefined;
      visibility?: string | undefined;
      metadata?: Record<string, unknown> | undefined;
    }) {
      return request<StoredEntityResponse>(options, '/api/tasks', {
        method: 'POST',
        body: input
      });
    },
    listTasks(input: {
      status?: string | undefined;
      context?: string | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
    } = {}) {
      const params = new URLSearchParams();
      if (input.status) {
        params.set('status', input.status);
      }
      if (input.context) {
        params.set('context', input.context);
      }
      if (input.limit !== undefined) {
        params.set('limit', String(input.limit));
      }
      if (input.offset !== undefined) {
        params.set('offset', String(input.offset));
      }

      return request<{
        items: StoredEntityResponse['entity'][];
        total: number;
        limit: number;
        offset: number;
      }>(options, `/api/tasks?${params.toString()}`);
    },
    updateTask(
      id: string,
      input: {
        version: number;
        content?: string | undefined;
        context?: string | undefined;
        status?: string | null | undefined;
        due_date?: string | undefined;
        tags?: string[] | undefined;
        visibility?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
      }
    ) {
      return request<StoredEntityResponse>(options, `/api/tasks/${id}`, {
        method: 'PATCH',
        body: input
      });
    },
    completeTask(id: string, version: number) {
      return request<StoredEntityResponse>(
        options,
        `/api/tasks/${id}/complete`,
        {
          method: 'POST',
          body: { version }
        }
      );
    },
    syncRepo(input: {
      repo: string;
      files: Array<{ path: string; sha: string; content: string }>;
    }) {
      return request<{
        created: number;
        updated: number;
        unchanged: number;
        deleted: number;
      }>(options, '/api/sync', {
        method: 'POST',
        body: input
      });
    },
    getSyncStatus(repo: string) {
      return request<{
        repo: string;
        files: Array<{
          path: string;
          sha: string;
          syncStatus: string;
          lastSynced: string;
          entityId: string;
        }>;
      }>(options, `/api/sync/status/${encodeURIComponent(repo)}`);
    },
    createEdge(input: {
      source_id: string;
      target_id: string;
      relation: string;
      confidence?: number;
      metadata?: Record<string, unknown>;
    }) {
      return request<{
        edge: {
          id: string;
          source_id: string;
          target_id: string;
          relation: string;
          confidence: number;
          source: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
      }>(options, '/api/edges', {
        method: 'POST',
        body: input
      });
    },
    deleteEdge(id: string) {
      return request<{ id: string; deleted: true }>(options, `/api/edges/${id}`, {
        method: 'DELETE'
      });
    },
    listEdges(entityId: string, params: { relation?: string; direction?: string; owner?: string } = {}) {
      const qs = new URLSearchParams();
      if (params.relation) qs.set('relation', params.relation);
      if (params.direction) qs.set('direction', params.direction);
      if (params.owner) qs.set('owner', params.owner);
      const query = qs.toString();
      return request<{
        edges: Array<{
          id: string;
          source_id: string;
          target_id: string;
          relation: string;
          confidence: number;
          source: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        }>;
      }>(options, `/api/entities/${entityId}/edges${query ? `?${query}` : ''}`);
    },
    getQueueStatus() {
      return request<{
        embedding: { pending: number; completed: number; failed: number; retry_eligible: number; oldest_pending_secs: number | null };
        extraction: { pending: number; completed: number; failed: number } | null;
      }>(options, '/api/queue');
    },
    expandGraph(entityId: string, params: { depth?: number; relationTypes?: string[]; owner?: string } = {}) {
      const qs = new URLSearchParams();
      if (params.depth !== undefined) qs.set('depth', String(params.depth));
      if (params.relationTypes?.length) qs.set('relation_types', params.relationTypes.join(','));
      if (params.owner) qs.set('owner', params.owner);
      const query = qs.toString();
      return request<{
        entities: Array<{ id: string; type: string; content: string | null; metadata: Record<string, unknown> }>;
        edges: Array<{
          id: string;
          source_id: string;
          target_id: string;
          relation: string;
          confidence: number;
          source: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        }>;
      }>(options, `/api/entities/${entityId}/graph${query ? `?${query}` : ''}`);
    }
  };
}