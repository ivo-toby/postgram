import { createServer } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEmbeddingProvider } from '../../src/services/embeddings/providers.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import { storeEntity, recallEntity } from '../../src/services/entity-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000103',
    keyName: 'worker-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

type StubOllama = {
  url: string;
  close: () => Promise<void>;
  calls: Array<{ model: string; prompt: string }>;
};

async function startStubOllama(dimensions: number): Promise<StubOllama> {
  const calls: StubOllama['calls'] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/api/embeddings') {
        res.statusCode = 404;
        res.end();
        return;
      }

      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        model: string;
        prompt: string;
      };
      calls.push(body);

      // Deterministic vector: modular hash per character, normalized later — keep simple.
      const embedding = new Array<number>(dimensions).fill(0);
      for (let i = 0; i < body.prompt.length; i += 1) {
        embedding[i % dimensions] = (embedding[i % dimensions] ?? 0) + 1;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ embedding }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('stub server failed to bind');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}

describe('enrichment-worker with Ollama provider', () => {
  let database: TestDatabase | undefined;
  let stub: StubOllama | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);
    await seedApiKey(database.pool, {
      id: '00000000-0000-0000-0000-000000000103',
      name: 'worker-key'
    });

    // Replace the default OpenAI 1536 seed with an Ollama/4-dim seed so the
    // chunks column (1536) is still compatible at the SQL level, but the
    // runtime provider drives the actual vectors. We use the chunks column's
    // native 1536 dimension for the stub to avoid a migration in this test.
    await database.pool.query(
      `
        UPDATE embedding_models
           SET name = 'bge-m3',
               provider = 'ollama',
               dimensions = 1536
         WHERE is_active = true
      `
    );
  });

  afterEach(async () => {
    if (stub) {
      await stub.close();
      stub = undefined;
    }
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('enriches entities via a stub Ollama host and issues zero OpenAI calls', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    stub = await startStubOllama(1536);

    const originalFetch = globalThis.fetch;
    const fetchCalls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      fetchCalls.push(url);
      if (url.includes('api.openai.com')) {
        throw new Error(`unexpected OpenAI call in Ollama test: ${url}`);
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      const provider = createEmbeddingProvider({
        provider: 'ollama',
        model: 'bge-m3',
        dimensions: 1536,
        baseUrl: stub.url
      });

      const embeddingService = createEmbeddingService({
        provider,
        mode: 'provider'
      });

      const stored = (
        await storeEntity(database.pool, makeAuthContext(), {
          type: 'memory',
          content: 'pgvector lets postgres do vector search without a separate service'
        })
      )._unsafeUnwrap();

      const worker = createEnrichmentWorker({
        pool: database.pool,
        embeddingService
      });

      const processed = await worker.runOnce();
      expect(processed).toBe(1);

      const recalled = await recallEntity(database.pool, makeAuthContext(), stored.id);
      expect(recalled.isOk()).toBe(true);
      expect(recalled._unsafeUnwrap().enrichmentStatus).toBe('completed');

      const chunkCount = await database.pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM chunks WHERE entity_id = $1',
        [stored.id]
      );
      expect(Number(chunkCount.rows[0]?.count ?? '0')).toBeGreaterThan(0);

      expect(stub.calls.length).toBeGreaterThan(0);
      expect(stub.calls.every((call) => call.model === 'bge-m3')).toBe(true);
      expect(fetchCalls.some((url) => url.includes('api.openai.com'))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 120_000);
});
