import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import { createEmbeddingService } from '../../src/services/embedding-service.js';
import { createEnrichmentWorker } from '../../src/services/enrichment-worker.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const execFileAsync = promisify(execFile);
const TSX_BIN = path.resolve('node_modules/.bin/tsx');
const PGM_ENTRYPOINT = path.resolve('src/cli/pgm.ts');

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout.trim());
}

async function runPgm(args: string[], env: NodeJS.ProcessEnv) {
  return execFileAsync(TSX_BIN, [PGM_ENTRYPOINT, ...args], {
    env: {
      ...process.env,
      ...env
    },
    cwd: process.cwd(),
    maxBuffer: 10_000_000,
    timeout: 120_000
  });
}

describe('pgm CLI', () => {
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

  it('stores, recalls, and searches entities through REST', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (await createKey(database.pool, {
      name: `cli-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete'],
      allowedVisibility: ['shared']
    }))._unsafeUnwrap();

    const storeResult = await runPgm(
      [
        'store',
        'decided to use pgvector',
        '--type',
        'memory',
        '--tags',
        'decisions,architecture',
        '--json'
      ],
      {
        PGM_API_URL: baseUrl,
        PGM_API_KEY: createdKey.plaintextKey
      }
    );

    const storeBody = parseJson(storeResult.stdout) as {
      entity: { id: string; enrichment_status: string };
    };
    expect(storeBody.entity.enrichment_status).toBe('pending');

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const recallResult = await runPgm(
      ['recall', storeBody.entity.id, '--json'],
      {
        PGM_API_URL: baseUrl,
        PGM_API_KEY: createdKey.plaintextKey
      }
    );
    const recallBody = parseJson(recallResult.stdout) as {
      entity: { id: string; content: string };
    };
    expect(recallBody.entity).toMatchObject({
      id: storeBody.entity.id,
      content: 'decided to use pgvector'
    });

    const searchResult = await runPgm(
      ['search', 'pgvector decisions', '--limit', '5', '--json'],
      {
        PGM_API_URL: baseUrl,
        PGM_API_KEY: createdKey.plaintextKey
      }
    );
    const searchBody = parseJson(searchResult.stdout) as {
      results: Array<{ entity: { id: string }; chunk_content: string }>;
    };
    expect(searchBody.results[0]?.entity.id).toBe(storeBody.entity.id);
    expect(searchBody.results[0]?.chunk_content).toContain('pgvector');
  }, 120_000);

  it('lists entities filtered by type', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (await createKey(database.pool, {
      name: `list-${crypto.randomUUID()}`,
      scopes: ['read', 'write'],
      allowedVisibility: ['shared']
    }))._unsafeUnwrap();

    const env = {
      PGM_API_URL: baseUrl,
      PGM_API_KEY: createdKey.plaintextKey
    };

    await runPgm(
      ['store', 'first memory', '--type', 'memory', '--json'],
      env
    );
    await runPgm(
      ['store', 'a project', '--type', 'project', '--json'],
      env
    );

    const listAll = await runPgm(['list', '--json'], env);
    const allBody = parseJson(listAll.stdout) as {
      items: Array<{ type: string }>;
      total: number;
    };
    expect(allBody.total).toBe(2);

    const listMemories = await runPgm(
      ['list', '--type', 'memory', '--json'],
      env
    );
    const memBody = parseJson(listMemories.stdout) as {
      items: Array<{ type: string }>;
      total: number;
    };
    expect(memBody.total).toBe(1);
    expect(memBody.items[0]?.type).toBe('memory');
  }, 120_000);

  it('adds, lists, updates, and completes tasks through REST', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (await createKey(database.pool, {
      name: `task-cli-${crypto.randomUUID()}`,
      scopes: ['read', 'write'],
      allowedVisibility: ['shared']
    }))._unsafeUnwrap();

    const addResult = await runPgm(
      [
        'task',
        'add',
        'write CLI integration tests',
        '--context',
        '@dev',
        '--status',
        'next',
        '--due',
        '2026-03-25',
        '--json'
      ],
      {
        PGM_API_URL: baseUrl,
        PGM_API_KEY: createdKey.plaintextKey
      }
    );
    const addBody = parseJson(addResult.stdout) as {
      entity: { id: string; version: number; status: string; metadata: Record<string, string> };
    };
    expect(addBody.entity).toMatchObject({
      status: 'next',
      metadata: {
        context: '@dev',
        due_date: '2026-03-25'
      }
    });

    const listResult = await runPgm(
      ['task', 'list', '--status', 'next', '--context', '@dev', '--json'],
      {
        PGM_API_URL: baseUrl,
        PGM_API_KEY: createdKey.plaintextKey
      }
    );
    const listBody = parseJson(listResult.stdout) as {
      total: number;
      items: Array<{ id: string }>;
    };
    expect(listBody.total).toBe(1);
    expect(listBody.items[0]?.id).toBe(addBody.entity.id);

    const updateResult = await runPgm(
      [
        'task',
        'update',
        addBody.entity.id,
        '--version',
        String(addBody.entity.version),
        '--status',
        'waiting',
        '--context',
        '@later',
        '--json'
      ],
      {
        PGM_API_URL: baseUrl,
        PGM_API_KEY: createdKey.plaintextKey
      }
    );
    const updateBody = parseJson(updateResult.stdout) as {
      entity: { version: number; status: string; metadata: Record<string, string> };
    };
    expect(updateBody.entity).toMatchObject({
      status: 'waiting',
      metadata: {
        context: '@later'
      }
    });

    const completeResult = await runPgm(
      [
        'task',
        'complete',
        addBody.entity.id,
        '--version',
        String(updateBody.entity.version),
        '--json'
      ],
      {
        PGM_API_URL: baseUrl,
        PGM_API_KEY: createdKey.plaintextKey
      }
    );
    const completeBody = parseJson(completeResult.stdout) as {
      entity: { status: string; metadata: { completed_at: string } };
    };
    expect(completeBody.entity.status).toBe('done');
    expect(completeBody.entity.metadata.completed_at).toEqual(
      expect.any(String)
    );
  }, 120_000);
});
