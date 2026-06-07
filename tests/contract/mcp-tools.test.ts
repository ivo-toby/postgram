import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { AuthContext } from '../../src/auth/types.js';
import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import { storeEntity } from '../../src/services/entity-service.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

type ToolResultPayload = {
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

function extractStructuredPayload(
  result: ToolResultPayload
): Record<string, unknown> {
  if (result.structuredContent) {
    return result.structuredContent;
  }

  const text = result.content?.find((item) => item.type === 'text')?.text;
  if (!text) {
    throw new Error('tool result did not include structured content');
  }

  return JSON.parse(text) as Record<string, unknown>;
}

describe('MCP tools', () => {
  let database: TestDatabase | undefined;
  let server: ReturnType<typeof serve> | undefined;
  let baseUrl = '';
  const embeddingService = createEmbeddingService();

  beforeAll(async () => {
    database = await createTestDatabase();
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({
      pool: database.pool,
      embeddingService
    });

    server = serve(
      { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
      (info) => {
        baseUrl = `http://${info.address}:${info.port}`;
      }
    );
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
    }

    if (database) {
      await database.close();
    }
  });

  async function createClient() {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (
      await createKey(database.pool, {
        name: `mcp-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared', 'work', 'personal']
      })
    )._unsafeUnwrap();

    const transport = new StreamableHTTPClientTransport(
      new URL('/mcp', baseUrl),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${createdKey.plaintextKey}`
          }
        }
      }
    );
    const client = new Client(
      { name: 'postgram-test-client', version: '0.1.0' },
      { capabilities: {} }
    );

    // StreamableHTTPClientTransport.sessionId getter returns string|undefined but
    // Transport interface declares sessionId?: string; incompatible under exactOptionalPropertyTypes
    await client.connect(transport as unknown as Transport);

    return {
      clientId: createdKey.record.clientId,
      client,
      close: async () => {
        await client.close();
      }
    };
  }

  async function startServerWithEmbeddingService(
    service: ReturnType<typeof createEmbeddingService>
  ) {
    if (!database) {
      throw new Error('test database not initialized');
    }

    let localBaseUrl = '';
    const app = createApp({
      pool: database.pool,
      embeddingService: service
    });

    const localServer = serve(
      { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
      (info) => {
        localBaseUrl = `http://${info.address}:${info.port}`;
      }
    );

    const createdKey = (
      await createKey(database.pool, {
        name: `mcp-error-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared', 'work', 'personal']
      })
    )._unsafeUnwrap();

    const transport = new StreamableHTTPClientTransport(
      new URL('/mcp', localBaseUrl),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${createdKey.plaintextKey}`
          }
        }
      }
    );

    const client = new Client(
      { name: 'postgram-test-client', version: '0.1.0' },
      { capabilities: {} }
    );
    // See same cast in createClient() above for explanation
    await client.connect(transport as unknown as Transport);

    return {
      client,
      close: async () => {
        await client.close();
        await new Promise<void>((resolve) => {
          localServer.close(() => resolve());
        });
      }
    };
  }

  it('lists all expected tools', async () => {
    const { client, close } = await createClient();

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'delete',
        'expand',
        'link',
        'queue',
        'recall',
        'search',
        'store',
        'store_session_context',
        'sync_push',
        'sync_status',
        'task_complete',
        'task_create',
        'task_list',
        'task_update',
        'unlink',
        'update'
      ]);
    } finally {
      await close();
    }
  }, 120_000);

  it('keeps tool behavior in parity with REST for entity operations', async () => {
    const { client, close } = await createClient();

    try {
      const storeResult = (await client.callTool({
        name: 'store',
        arguments: {
          type: 'memory',
          content: 'decided to use pgvector',
          tags: ['decisions', 'architecture']
        }
      })) as ToolResultPayload;
      const storePayload = extractStructuredPayload(storeResult) as {
        entity: { id: string; version: number; enrichment_status: string };
      };

      expect(storePayload.entity.enrichment_status).toBe('pending');

      await createEnrichmentWorker({
        pool: database!.pool,
        embeddingService
      }).runOnce();

      const recallResult = (await client.callTool({
        name: 'recall',
        arguments: {
          id: storePayload.entity.id
        }
      })) as ToolResultPayload;
      const recallPayload = extractStructuredPayload(recallResult) as {
        entity: { id: string; content: string };
      };
      expect(recallPayload.entity).toMatchObject({
        id: storePayload.entity.id,
        content: 'decided to use pgvector'
      });

      const updateResult = (await client.callTool({
        name: 'update',
        arguments: {
          id: storePayload.entity.id,
          version: storePayload.entity.version,
          content: 'updated pgvector decision',
          full_response: true
        }
      })) as ToolResultPayload;
      const updatePayload = extractStructuredPayload(updateResult) as {
        entity: { version: number; content: string };
      };
      expect(updatePayload.entity.content).toBe('updated pgvector decision');

      const deleteResult = (await client.callTool({
        name: 'delete',
        arguments: {
          id: storePayload.entity.id
        }
      })) as ToolResultPayload;
      const deletePayload = extractStructuredPayload(deleteResult) as {
        id: string;
        deleted: boolean;
      };
      expect(deletePayload).toEqual({
        id: storePayload.entity.id,
        deleted: true
      });
    } finally {
      await close();
    }
  }, 120_000);

  it('stores entities with skipped extraction via MCP', async () => {
    const { client, close } = await createClient();

    try {
      const storeResult = (await client.callTool({
        name: 'store',
        arguments: {
          type: 'interaction',
          content: 'conversation import that should only be embedded',
          visibility: 'personal',
          skip_extraction: true
        }
      })) as ToolResultPayload;
      const storePayload = extractStructuredPayload(storeResult) as {
        entity: { id: string; enrichment_status: string };
      };

      expect(storePayload.entity.enrichment_status).toBe('pending');

      const row = await database!.pool.query<{
        extraction_status: string | null;
      }>('SELECT extraction_status FROM entities WHERE id = $1', [
        storePayload.entity.id
      ]);
      expect(row.rows[0]?.extraction_status).toBe('skipped');
    } finally {
      await close();
    }
  }, 120_000);

  it('supports owner-scoped store, recall, search, and graph expansion via MCP', async () => {
    const { client, close } = await createClient();

    try {
      const shared = extractStructuredPayload(
        (await client.callTool({
          name: 'store',
          arguments: {
            type: 'memory',
            content: 'shared planning notes for everyone'
          }
        })) as ToolResultPayload
      ) as {
        entity: { id: string };
      };

      const productManager = extractStructuredPayload(
        (await client.callTool({
          name: 'store',
          arguments: {
            type: 'memory',
            content: 'product manager planning notes',
            owner: 'product-manager'
          }
        })) as ToolResultPayload
      ) as {
        entity: { id: string; owner: string | null };
      };
      expect(productManager.entity.owner).toBe('product-manager');

      const developer = extractStructuredPayload(
        (await client.callTool({
          name: 'store',
          arguments: {
            type: 'memory',
            content: 'developer planning notes',
            owner: 'developer'
          }
        })) as ToolResultPayload
      ) as {
        entity: { id: string };
      };

      await client.callTool({
        name: 'link',
        arguments: {
          source_id: productManager.entity.id,
          target_id: shared.entity.id,
          relation: 'references'
        }
      });
      await client.callTool({
        name: 'link',
        arguments: {
          source_id: productManager.entity.id,
          target_id: developer.entity.id,
          relation: 'references'
        }
      });

      await createEnrichmentWorker({
        pool: database!.pool,
        embeddingService
      }).runOnce();

      const recallResult = (await client.callTool({
        name: 'recall',
        arguments: {
          id: developer.entity.id,
          owner: 'product-manager'
        }
      })) as ToolResultPayload;
      expect(recallResult.isError).toBe(true);
      expect(extractStructuredPayload(recallResult)).toMatchObject({
        error: {
          code: 'NOT_FOUND'
        }
      });

      const searchResult = extractStructuredPayload(
        (await client.callTool({
          name: 'search',
          arguments: {
            query: 'planning notes',
            owner: 'product-manager',
            threshold: 0
          }
        })) as ToolResultPayload
      ) as {
        results: Array<{ id: string }>;
      };
      expect(searchResult.results.map((entry) => entry.id).sort()).toEqual(
        [shared.entity.id, productManager.entity.id].sort()
      );

      const expandResult = extractStructuredPayload(
        (await client.callTool({
          name: 'expand',
          arguments: {
            entity_id: productManager.entity.id,
            depth: 1,
            owner: 'product-manager'
          }
        })) as ToolResultPayload
      ) as {
        entities: Array<{ id: string }>;
        edges: Array<{ id: string }>;
      };
      expect(expandResult.entities.map((entity) => entity.id).sort()).toEqual(
        [shared.entity.id, productManager.entity.id].sort()
      );
      expect(expandResult.edges).toHaveLength(1);
    } finally {
      await close();
    }
  }, 120_000);

  it('does not allow scoped-memory bypass via MCP search arguments', async () => {
    const { client, clientId, close } = await createClient();

    try {
      const seedAuth: AuthContext = {
        apiKeyId: '00000000-0000-0000-0000-000000000904',
        keyName: 'mcp-bypass-seed',
        clientId,
        scopes: ['read', 'write', 'delete'],
        allowedTypes: null,
        allowedVisibility: ['personal', 'work', 'shared']
      };

      await storeEntity(database!.pool, seedAuth, {
        type: 'memory',
        visibility: 'personal',
        content: 'Viewer scoped durable memory for MCP bypass regression.',
        metadata: {
          memory_role: 'durable_memory',
          session_scope: { kind: 'client', client_id: clientId }
        }
      });

      await storeEntity(database!.pool, {
        ...seedAuth,
        apiKeyId: '00000000-0000-0000-0000-000000000905',
        clientId: `${clientId}-other`,
        keyName: 'mcp-bypass-other'
      }, {
        type: 'memory',
        visibility: 'personal',
        content: 'Other scoped durable memory for MCP bypass regression.',
        metadata: {
          memory_role: 'durable_memory',
          session_scope: { kind: 'client', client_id: `${clientId}-other` }
        }
      });

      await createEnrichmentWorker({
        pool: database!.pool,
        embeddingService
      }).runOnce();

      const searchResult = extractStructuredPayload(
        (await client.callTool({
          name: 'search',
          arguments: {
            query: 'scoped durable memory MCP bypass regression',
            type: 'memory',
            threshold: 0,
            limit: 10,
            include_other_clients_session_context: true
          }
        })) as ToolResultPayload
      ) as {
        results: Array<{ content: string | null }>;
      };

      const contents = searchResult.results.map((entry) => entry.content);
      expect(contents).toContain('Viewer scoped durable memory for MCP bypass regression.');
      expect(contents).not.toContain('Other scoped durable memory for MCP bypass regression.');
    } finally {
      await close();
    }
  }, 120_000);

  it('supports source, visibility-filtered search, and task metadata via MCP', async () => {
    const { client, close } = await createClient();

    try {
      const sharedStore = extractStructuredPayload(
        (await client.callTool({
          name: 'store',
          arguments: {
            type: 'memory',
            content: 'postgres notes for shared visibility',
            visibility: 'shared',
            source: 'mcp-shared'
          }
        })) as ToolResultPayload
      ) as {
        entity: { id: string; source: string | null };
      };
      expect(sharedStore.entity.source).toBe('mcp-shared');

      await client.callTool({
        name: 'store',
        arguments: {
          type: 'memory',
          content: 'postgres notes for work visibility',
          visibility: 'work',
          source: 'mcp-work'
        }
      });

      await createEnrichmentWorker({
        pool: database!.pool,
        embeddingService
      }).runOnce();

      const searched = extractStructuredPayload(
        (await client.callTool({
          name: 'search',
          arguments: {
            query: 'postgres notes',
            visibility: 'work',
            threshold: 0
          }
        })) as ToolResultPayload
      ) as {
        results: Array<{
          id: string;
          type: string;
          content: string | null;
          chunk: string;
          score: number;
        }>;
      };

      expect(searched.results.length).toBeGreaterThan(0);
      const firstSearchResult = searched.results[0];
      if (!firstSearchResult) {
        throw new Error('expected at least one search result');
      }
      expect(typeof firstSearchResult.id).toBe('string');
      expect(firstSearchResult.type).toBe('memory');
      expect(firstSearchResult.content).toContain('postgres notes');
      expect(firstSearchResult.chunk).toContain('postgres notes');
      expect(typeof firstSearchResult.score).toBe('number');
      expect(firstSearchResult).not.toHaveProperty('entity');
      expect(firstSearchResult).not.toHaveProperty('metadata');
      expect(firstSearchResult).not.toHaveProperty('created_at');

      const createdTask = extractStructuredPayload(
        (await client.callTool({
          name: 'task_create',
          arguments: {
            content: 'write docs',
            context: '@dev',
            metadata: {
              priority: 'high'
            },
            full_response: true
          }
        })) as ToolResultPayload
      ) as {
        entity: {
          id: string;
          version: number;
          metadata: Record<string, string>;
        };
      };

      expect(createdTask.entity.metadata).toMatchObject({
        context: '@dev',
        priority: 'high'
      });

      const updatedTask = extractStructuredPayload(
        (await client.callTool({
          name: 'task_update',
          arguments: {
            id: createdTask.entity.id,
            version: createdTask.entity.version,
            metadata: {
              owner: 'ivo'
            },
            full_response: true
          }
        })) as ToolResultPayload
      ) as {
        entity: { metadata: Record<string, string> };
      };

      expect(updatedTask.entity.metadata).toMatchObject({
        context: '@dev',
        priority: 'high',
        owner: 'ivo'
      });
    } finally {
      await close();
    }
  }, 120_000);

  it('supports full-response and TOON search output via MCP arguments', async () => {
    const { client, close } = await createClient();

    try {
      const stored = extractStructuredPayload(
        (await client.callTool({
          name: 'store',
          arguments: {
            type: 'memory',
            content: 'token compact search response shape',
            tags: ['tokens']
          }
        })) as ToolResultPayload
      ) as {
        entity: { id: string };
      };

      await createEnrichmentWorker({
        pool: database!.pool,
        embeddingService
      }).runOnce();

      const full = extractStructuredPayload(
        (await client.callTool({
          name: 'search',
          arguments: {
            query: 'compact search',
            threshold: 0,
            full_response: true
          }
        })) as ToolResultPayload
      ) as {
        results: Array<{
          entity: { id: string; metadata: Record<string, unknown> };
          chunk_content: string;
          similarity: number;
        }>;
      };
      expect(full.results[0]?.entity.id).toBe(stored.entity.id);
      expect(full.results[0]?.chunk_content).toContain('compact search');
      expect(full.results[0]?.similarity).toEqual(expect.any(Number));

      const toonResult = (await client.callTool({
        name: 'search',
        arguments: {
          query: 'compact search',
          threshold: 0,
          toon: true
        }
      })) as ToolResultPayload;
      const toonText =
        toonResult.content?.find((item) => item.type === 'text')?.text ?? '';
      expect(toonResult.structuredContent).toEqual({ toon: toonText });
      expect(toonText).toContain(
        'results[1]{id,type,score,content,chunk,tags,related}:'
      );
      expect(toonText).toContain(stored.entity.id);
      expect(toonText).not.toContain('created_at');
    } finally {
      await close();
    }
  }, 120_000);

  it('stores client-scoped session context via MCP', async () => {
    const { client, clientId, close } = await createClient();

    try {
      const stored = extractStructuredPayload(
        (await client.callTool({
          name: 'store_session_context',
          arguments: {
            content: 'MCP session context about memory lifecycle roles',
            visibility: 'personal',
            topic: 'postgram-memory',
            agent_id: 'codex',
            tags: ['mcp'],
            full_response: true
          }
        })) as ToolResultPayload
      ) as {
        entity: {
          type: string;
          tags: string[];
          metadata: Record<string, unknown>;
        };
      };

      expect(stored.entity.type).toBe('memory');
      expect(stored.entity.tags).toContain('session-context');
      expect(stored.entity.metadata).toMatchObject({
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: clientId },
        topic: 'postgram-memory',
        agent_id: 'codex'
      });
    } finally {
      await close();
    }
  }, 120_000);

  it('keeps task tool behavior in parity with REST task operations', async () => {
    const { client, close } = await createClient();

    try {
      const created = extractStructuredPayload(
        (await client.callTool({
          name: 'task_create',
          arguments: {
            content: 'write MCP transport',
            context: '@dev',
            status: 'next',
            due_date: '2026-03-30'
          }
        })) as ToolResultPayload
      ) as {
        entity: { id: string; version: number; status: string };
      };

      expect(created.entity.status).toBe('next');

      const listed = extractStructuredPayload(
        (await client.callTool({
          name: 'task_list',
          arguments: {
            status: 'next',
            context: '@dev'
          }
        })) as ToolResultPayload
      ) as {
        total: number;
        items: Array<{ id: string }>;
      };
      expect(listed.total).toBe(1);
      expect(listed.items[0]?.id).toBe(created.entity.id);

      const updated = extractStructuredPayload(
        (await client.callTool({
          name: 'task_update',
          arguments: {
            id: created.entity.id,
            version: created.entity.version,
            status: 'waiting',
            context: '@later'
          }
        })) as ToolResultPayload
      ) as {
        entity: { version: number; status: string };
      };
      expect(updated.entity.status).toBe('waiting');

      const completed = extractStructuredPayload(
        (await client.callTool({
          name: 'task_complete',
          arguments: {
            id: created.entity.id,
            version: updated.entity.version,
            full_response: true
          }
        })) as ToolResultPayload
      ) as {
        entity: { status: string; metadata: { completed_at: string } };
      };

      expect(completed.entity.status).toBe('done');
      expect(typeof completed.entity.metadata.completed_at).toBe('string');
    } finally {
      await close();
    }
  }, 120_000);

  it('syncs documents and returns status via MCP tools', async () => {
    const { client, close } = await startServerWithEmbeddingService(
      createEmbeddingService()
    );

    try {
      const pushResult = (await client.callTool({
        name: 'sync_push',
        arguments: {
          repo: 'mcp-repo',
          files: [
            {
              path: 'test.md',
              sha: 'mcp-sha-1',
              content: '# MCP Test\n\nContent.'
            }
          ]
        }
      })) as ToolResultPayload;

      expect(pushResult.isError).toBeUndefined();
      const pushPayload = extractStructuredPayload(pushResult) as {
        created: number;
        updated: number;
      };
      expect(pushPayload.created).toBe(1);
      expect(pushPayload.updated).toBe(0);

      const statusResult = (await client.callTool({
        name: 'sync_status',
        arguments: {
          repo: 'mcp-repo'
        }
      })) as ToolResultPayload;

      expect(statusResult.isError).toBeUndefined();
      const statusPayload = extractStructuredPayload(statusResult) as {
        repo: string;
        files: Array<{ path: string; sha: string; syncStatus: string }>;
      };
      expect(statusPayload.repo).toBe('mcp-repo');
      expect(statusPayload.files).toHaveLength(1);
      expect(statusPayload.files[0]?.path).toBe('test.md');
    } finally {
      await close();
    }
  }, 120_000);

  it('creates edges and expands graph via MCP tools', async () => {
    const { client, close } = await startServerWithEmbeddingService(
      createEmbeddingService()
    );

    try {
      // Create entities first
      const personResult = (await client.callTool({
        name: 'store',
        arguments: { type: 'person', content: 'Bob' }
      })) as ToolResultPayload;
      const person = (
        extractStructuredPayload(personResult) as { entity: { id: string } }
      ).entity;

      const projectResult = (await client.callTool({
        name: 'store',
        arguments: { type: 'project', content: 'Beta' }
      })) as ToolResultPayload;
      const project = (
        extractStructuredPayload(projectResult) as { entity: { id: string } }
      ).entity;

      // Link them
      const linkResult = (await client.callTool({
        name: 'link',
        arguments: {
          source_id: person.id,
          target_id: project.id,
          relation: 'involves'
        }
      })) as ToolResultPayload;
      expect(linkResult.isError).toBeUndefined();
      const edge = (
        extractStructuredPayload(linkResult) as {
          edge: { id: string; relation: string };
        }
      ).edge;
      expect(edge.relation).toBe('involves');

      // Expand graph
      const expandResult = (await client.callTool({
        name: 'expand',
        arguments: { entity_id: person.id }
      })) as ToolResultPayload;
      expect(expandResult.isError).toBeUndefined();
      const graph = extractStructuredPayload(expandResult) as {
        entities: Array<{ id: string }>;
        edges: Array<{ id: string }>;
      };
      expect(graph.entities.length).toBeGreaterThanOrEqual(2);
      expect(graph.edges).toHaveLength(1);

      // Unlink
      const unlinkResult = (await client.callTool({
        name: 'unlink',
        arguments: { id: edge.id }
      })) as ToolResultPayload;
      expect(unlinkResult.isError).toBeUndefined();
    } finally {
      await close();
    }
  }, 120_000);

  it('returns EMBEDDING_FAILED when embedding fails', async () => {
    const failingEmbeddingService = createEmbeddingService({
      embedQuery: () => {
        throw new Error('forced query embedding failure');
      }
    });
    const { client, close } = await startServerWithEmbeddingService(
      failingEmbeddingService
    );

    try {
      const searchResult = (await client.callTool({
        name: 'search',
        arguments: {
          query: 'pgvector'
        }
      })) as ToolResultPayload;

      expect(searchResult.isError).toBe(true);
      const payload = extractStructuredPayload(searchResult) as {
        error: { code: string; message: string };
      };
      expect(payload.error.code).toBe('EMBEDDING_FAILED');
      expect(payload.error.message).toBe('forced query embedding failure');
    } finally {
      await close();
    }
  }, 120_000);
});
