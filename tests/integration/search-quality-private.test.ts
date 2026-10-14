import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { vectorToSql } from '../../src/services/embedding-service.js';
import {
  createTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const execFileAsync = promisify(execFile);
const TSX_BIN = join(process.cwd(), 'node_modules/.bin/tsx');
const BENCHMARK = join(process.cwd(), 'benchmarks/search-quality.ts');
const TARGET_ID = '00000000-0000-0000-0000-000000900901';
const CLIENT_ID = 'quality-client';
const MODEL = 'quality-test';
const DIMENSIONS = 1536;
const QUALITY_VECTOR = [1, ...new Array<number>(DIMENSIONS - 1).fill(0)];

type StubOllama = {
  url: string;
  calls: () => number;
  close: () => Promise<void>;
};

async function startStubOllama(): Promise<StubOllama> {
  let calls = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/api/embeddings') {
      response.statusCode = 404;
      response.end();
      return;
    }
    request.resume();
    request.once('end', () => {
      calls += 1;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ embedding: QUALITY_VECTOR }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Ollama stub failed to bind');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls: () => calls,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

function databaseUrl(database: TestDatabase): string {
  const options = database.pool.options;
  if (!options.host || !options.port || !options.database || !options.user) {
    throw new Error('test database connection options are incomplete');
  }
  const password = typeof options.password === 'string' ? options.password : '';
  return `postgresql://${encodeURIComponent(options.user)}:${encodeURIComponent(
    password
  )}@${options.host}:${options.port}/${options.database}`;
}

async function tableCounts(database: TestDatabase): Promise<readonly number[]> {
  const result = await database.pool.query<{ counts: string[] }>(`
    SELECT ARRAY[
      (SELECT count(*)::text FROM entities),
      (SELECT count(*)::text FROM chunks),
      (SELECT count(*)::text FROM embedding_models),
      (SELECT count(*)::text FROM query_embedding_cache),
      (SELECT count(*)::text FROM audit_log)
    ]::text[] AS counts
  `);
  const counts = result.rows[0]?.counts;
  if (!counts) throw new Error('failed to read private benchmark row counts');
  return counts.map(Number);
}

async function seedPrivateFixture(database: TestDatabase): Promise<void> {
  await database.pool.query(
    `UPDATE embedding_models
        SET name = $1, provider = 'ollama', dimensions = $2
      WHERE is_active = true`,
    [MODEL, DIMENSIONS]
  );
  await database.pool.query(
    `INSERT INTO entities (
       id, type, content, visibility, status, enrichment_status, tags, metadata
     ) VALUES ($1, 'memory', 'private quality answer', 'shared', 'active',
       'completed', ARRAY['quality'], $2::jsonb)`,
    [
      TARGET_ID,
      JSON.stringify({
        memory_role: 'session_context',
        session_scope: { client_id: CLIENT_ID }
      })
    ]
  );
  await database.pool.query(
    `INSERT INTO chunks (
       entity_id, chunk_index, content, embedding, model_id, token_count
     ) VALUES ($1, 0, 'private quality answer', $2::vector,
       (SELECT id FROM embedding_models WHERE is_active = true), 3)`,
    [TARGET_ID, vectorToSql(QUALITY_VECTOR)]
  );
}

function benchmarkEnvironment(url: string, stubUrl: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: url,
    EMBEDDING_PROVIDER: 'ollama',
    EMBEDDING_MODEL: MODEL,
    EMBEDDING_DIMENSIONS: String(DIMENSIONS),
    OLLAMA_BASE_URL: stubUrl,
    EMBEDDING_TIMEOUT_MS: '5000',
    LOG_LEVEL: 'error'
  };
  delete environment.EMBEDDING_BASE_URL;
  return environment;
}

async function runBenchmark(
  labelsPath: string,
  url: string,
  stubUrl: string,
  clientId: string
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    TSX_BIN,
    [
      BENCHMARK,
      '--private',
      '--labels',
      labelsPath,
      '--database-url',
      url,
      '--client-id',
      clientId
    ],
    {
      cwd: process.cwd(),
      env: benchmarkEnvironment(url, stubUrl),
      maxBuffer: 2_000_000,
      timeout: 120_000
    }
  );
}

function reportFrom(stdout: string): unknown {
  const report: unknown = JSON.parse(stdout.trim());
  return report;
}

function processOutput(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '';
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
  return `${stdout}\n${stderr}`;
}

describe('private search quality benchmark', () => {
  let database: TestDatabase | undefined;
  let stub: StubOllama | undefined;
  let labelsPath = '';
  let tempDirectory = '';

  beforeAll(async () => {
    database = await createTestDatabase();
    stub = await startStubOllama();
    tempDirectory = await mkdtemp(join(tmpdir(), 'postgram-quality-private-'));
    labelsPath = join(tempDirectory, 'labels.jsonl');
    await writeFile(
      labelsPath,
      `${JSON.stringify({ query: 'private quality answer', grades: { [TARGET_ID]: 2 } })}\n`,
      'utf8'
    );
    await seedPrivateFixture(database);
  }, 120_000);

  afterAll(async () => {
    if (stub) await stub.close();
    if (database) await database.close();
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
  });

  it('uses the provider and client scope without writing private data', async () => {
    if (!database || !stub) throw new Error('private benchmark fixture not initialized');
    const url = databaseUrl(database);
    const before = await tableCounts(database);

    const success = await runBenchmark(labelsPath, url, stub.url, CLIENT_ID);
    expect(reportFrom(success.stdout)).toMatchObject({
      mode: 'private',
      metrics: { private: { query_count: 1, recall_at_10: 1 } },
      queries: [{ metrics: { recall_at_10: 1 } }]
    });
    expect(success.stdout).toContain(TARGET_ID);
    expect(stub.calls()).toBeGreaterThan(0);
    expect(await tableCounts(database)).toEqual(before);

    const wrongClient = await runBenchmark(labelsPath, url, stub.url, 'other-client');
    expect(reportFrom(wrongClient.stdout)).toMatchObject({
      metrics: { private: { query_count: 1, recall_at_10: 0 } },
      queries: [{ metrics: { recall_at_10: 0 } }]
    });
    expect(await tableCounts(database)).toEqual(before);

    await database.pool.query(
      `UPDATE embedding_models
          SET name = 'different-model', provider = 'openai'
        WHERE is_active = true`
    );
    try {
      await runBenchmark(labelsPath, url, stub.url, CLIENT_ID);
      throw new Error('provider/model mismatch should fail before querying');
    } catch (error) {
      expect(processOutput(error)).toContain('embedding identity mismatch');
    } finally {
      await database.pool.query(
        `UPDATE embedding_models
            SET name = $1, provider = 'ollama'
          WHERE is_active = true`,
        [MODEL]
      );
    }
    expect(await tableCounts(database)).toEqual(before);
  }, 120_000);
});
