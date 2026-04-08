import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
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

function extractStructuredPayload(result: ToolResultPayload): Record<string, unknown> {
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

    const createdKey = (await createKey(database.pool, {
      name: `mcp-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete'],
      allowedVisibility: ['shared', 'work', 'personal']
    }))._unsafeUnwrap();

    const transport = new SSEClientTransport(new URL('/mcp', baseUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${createdKey.plaintextKey}`
        }
      },
      eventSourceInit: {
        fetch: async (url, init) =>
          fetch(url, {
            ...init,
            headers: {
              ...(init?.headers ?? {}),
              Authorization: `Bearer ${createdKey.plaintextKey}`
            }
          })
      }
    });
    const client = new Client(
      { name: 'postgram-test-client', version: '0.1.0' },
      { capabilities: {} }
    );

    await client.connect(transport);

    return {
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

    const createdKey = (await createKey(database.pool, {
      name: `mcp-error-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete'],
      allowedVisibility: ['shared', 'work', 'personal']
    }))._unsafeUnwrap();

    const transport = new SSEClientTransport(new URL('/mcp', localBaseUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${createdKey.plaintextKey}`
        }
      },
      eventSourceInit: {
        fetch: async (url, init) =>
          fetch(url, {
            ...init,
            headers: {
              ...(init?.headers ?? {}),
              Authorization: `Bearer ${createdKey.plaintextKey}`
            }
          })
      }
    });

    const client = new Client(
      { name: 'postgram-test-client', version: '0.1.0' },
      { capabilities: {} }
    );
    await client.connect(transport);

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
        'recall',
        'search',
        'store',
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
          content: 'updated pgvector decision'
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
        results: Array<{ entity: { id: string } }>;
      };
      expect(searchResult.results.map((entry) => entry.entity.id).sort()).toEqual(
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
        results: Array<{ entity: { visibility: string } }>;
      };

      expect(searched.results.length).toBeGreaterThan(0);
      expect(searched.results.every((entry) => entry.entity.visibility === 'work')).toBe(true);

      const createdTask = extractStructuredPayload(
        (await client.callTool({
          name: 'task_create',
          arguments: {
            content: 'write docs',
            context: '@dev',
            metadata: {
              priority: 'high'
            }
          }
        })) as ToolResultPayload
      ) as {
        entity: { id: string; version: number; metadata: Record<string, string> };
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
            }
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
            version: updated.entity.version
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
            { path: 'test.md', sha: 'mcp-sha-1', content: '# MCP Test\n\nContent.' }
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
      const person = (extractStructuredPayload(personResult) as { entity: { id: string } }).entity;

      const projectResult = (await client.callTool({
        name: 'store',
        arguments: { type: 'project', content: 'Beta' }
      })) as ToolResultPayload;
      const project = (extractStructuredPayload(projectResult) as { entity: { id: string } }).entity;

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
      const edge = (extractStructuredPayload(linkResult) as { edge: { id: string; relation: string } }).edge;
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
