import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'vitest';

import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import {
  createFakeRegistry,
  createTempStore,
  type TempStore
} from '../helpers/document-loaders.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

type Json = Record<string, unknown>;

const PDF = new TextEncoder().encode('%PDF-1.4 app level bytes');
const LOADING_KEYS = [
  'mime_type',
  'loading_status',
  'loading_error',
  'loader_name'
];

describe('document routes through createApp', () => {
  let database: TestDatabase;
  let temp: TempStore;
  let app: ReturnType<typeof createApp>;
  let apiKey: string;
  let server: ReturnType<typeof serve> | undefined;
  let baseUrl = '';
  const embeddingService = createEmbeddingService();

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 240_000);

  beforeEach(async () => {
    await resetTestDatabase(database.pool);
    temp = await createTempStore();
    apiKey = (
      await createKey(database.pool, {
        name: `docs-app-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared', 'work']
      })
    )._unsafeUnwrap().plaintextKey;
    app = createApp({
      pool: database.pool,
      embeddingService,
      documentLoaders: {
        registry: createFakeRegistry(),
        attachmentStore: temp.store,
        maxBytes: 4096
      }
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
      server = undefined;
    }
    await temp.cleanup();
  });

  afterAll(async () => {
    await database.close();
  });

  const auth = () => ({ Authorization: `Bearer ${apiKey}` });

  function upload(name = 'doc.pdf', bytes: Uint8Array = PDF): FormData {
    const fd = new FormData();
    fd.set(
      'file',
      new File([bytes.slice()], name, { type: 'application/pdf' })
    );
    return fd;
  }

  async function ingest(headers: Record<string, string> = auth()) {
    return app.request('/api/documents/ingest', {
      method: 'POST',
      headers,
      body: upload()
    });
  }

  it('answers 401 without a key on all three routes', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await ingest({})).status).toBe(401);
    expect((await app.request(`/api/entities/${id}/attachments`)).status).toBe(
      401
    );
    expect((await app.request(`/api/attachments/${id}/content`)).status).toBe(
      401
    );
  });

  it('ingests, lists and downloads with a real key; unknown routes are JSON 404', async () => {
    const created = await ingest();
    expect(created.status).toBe(202);
    const { id } = (await created.json()) as { id: string };

    const list = await app.request(`/api/entities/${id}/attachments`, {
      headers: auth()
    });
    expect(list.status).toBe(200);
    const { attachments } = (await list.json()) as { attachments: Json[] };
    expect(attachments).toHaveLength(1);

    const download = await app.request(
      `/api/attachments/${attachments[0]!.id as string}/content`,
      { headers: auth() }
    );
    expect(download.status).toBe(200);
    expect(
      Buffer.from(await download.arrayBuffer()).equals(Buffer.from(PDF))
    ).toBe(true);

    const unknown = await app.request('/api/documents/nope', {
      headers: auth()
    });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: Json }).error.code).toBe(
      'NOT_FOUND'
    );
  });

  describe('FR-21 loading fields', () => {
    async function seed() {
      const created = await ingest();
      const { id } = (await created.json()) as { id: string };
      await database.pool.query(
        `UPDATE entities
         SET content = 'zebra quartz xylophone', enrichment_status = 'pending',
             loader_name = 'fake', loading_status = 'completed'
         WHERE id = $1`,
        [id]
      );
      const memory = await app.request('/api/entities', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'memory',
          content: 'zebra quartz xylophone memory'
        })
      });
      const memoryId = ((await memory.json()) as { entity: { id: string } })
        .entity.id;
      await createEnrichmentWorker({
        pool: database.pool,
        embeddingService
      }).runOnce();
      return { docId: id, memoryId };
    }

    function expectLoadingFields(entity: Json) {
      expect(entity).toMatchObject({
        mime_type: 'application/pdf',
        loading_status: 'completed',
        loader_name: 'fake'
      });
    }

    function expectNoLoadingFields(entity: Json) {
      for (const key of LOADING_KEYS) expect(entity).not.toHaveProperty(key);
    }

    it('appear on the list route for a document only', async () => {
      const { docId, memoryId } = await seed();
      const res = await app.request('/api/entities?limit=10', {
        headers: auth()
      });
      const { items } = (await res.json()) as { items: Json[] };
      expectLoadingFields(items.find((i) => i.id === docId)!);
      expectNoLoadingFields(items.find((i) => i.id === memoryId)!);
    });

    it('appear on search results for a document only', async () => {
      const { docId, memoryId } = await seed();
      const res = await app.request('/api/search', {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'zebra quartz xylophone', threshold: 0 })
      });
      expect(res.status).toBe(200);
      const { results } = (await res.json()) as {
        results: Array<{ entity: Json }>;
      };
      const byId = new Map(
        results.map((r) => [r.entity.id as string, r.entity])
      );
      expectLoadingFields(byId.get(docId)!);
      expectNoLoadingFields(byId.get(memoryId)!);
    });

    it('appear in MCP recall output for a document only', async () => {
      const { docId, memoryId } = await seed();
      server = serve(
        { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
        (info) => {
          baseUrl = `http://${info.address}:${info.port}`;
        }
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const transport = new StreamableHTTPClientTransport(
        new URL('/mcp', baseUrl),
        { requestInit: { headers: auth() } }
      );
      const client = new Client(
        { name: 'docs-test-client', version: '0.1.0' },
        { capabilities: {} }
      );
      await client.connect(transport as unknown as Transport);
      try {
        const recall = async (id: string) => {
          const result = (await client.callTool({
            name: 'recall',
            arguments: { id }
          })) as {
            structuredContent?: { entity: Json };
            content?: Array<{ type: string; text?: string }>;
          };
          const payload =
            result.structuredContent ??
            (JSON.parse(
              result.content?.find((c) => c.type === 'text')?.text ?? '{}'
            ) as { entity: Json });
          return payload.entity;
        };
        expectLoadingFields(await recall(docId));
        expectNoLoadingFields(await recall(memoryId));
      } finally {
        await client.close();
      }
    });
  });
});
