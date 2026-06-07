import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import { execFile, spawn } from 'node:child_process';
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
const PGM_ENTRYPOINT = path.resolve('cli/src/pgm.ts');

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

async function runPgmCapture(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(TSX_BIN, [PGM_ENTRYPOINT, ...args], {
        env: {
          ...process.env,
          ...env
        },
        cwd: process.cwd()
      });

      let stdout = '';
      let stderr = '';

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.once('error', reject);
      child.once('close', (code) => {
        resolve({ code, stdout, stderr });
      });
    }
  );
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
  }, 240_000);

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

    const createdKey = (
      await createKey(database.pool, {
        name: `cli-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared']
      })
    )._unsafeUnwrap();

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
      results: Array<{ id: string; chunk: string }>;
    };
    expect(searchBody.results[0]?.id).toBe(storeBody.entity.id);
    expect(searchBody.results[0]?.chunk).toContain('pgvector');
    expect(searchBody.results[0]).not.toHaveProperty('entity');
  }, 120_000);

  it('stores and searches session-context memory through first-class CLI commands', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (
      await createKey(database.pool, {
        name: `session-cli-${crypto.randomUUID()}`,
        clientId: 'codex-cli',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['personal']
      })
    )._unsafeUnwrap();

    const env = {
      PGM_API_URL: baseUrl,
      PGM_API_KEY: createdKey.plaintextKey
    };

    await runPgm(
      [
        'store',
        'Memory lifecycle roles durable note.',
        '--type',
        'memory',
        '--visibility',
        'personal',
        '--metadata',
        '{"memory_role":"durable_memory"}',
        '--json'
      ],
      env
    );

    const sessionResult = await runPgm(
      [
        'memory',
        'session-context',
        'Memory lifecycle roles session context for CLI agents.',
        '--visibility',
        'personal',
        '--topic',
        'postgram-memory',
        '--agent-id',
        'codex',
        '--tags',
        'cli,session-context',
        '--json',
        '--full-response'
      ],
      env
    );
    const sessionBody = parseJson(sessionResult.stdout) as {
      entity: {
        id: string;
        type: string;
        tags: string[];
        metadata: Record<string, unknown>;
      };
    };
    expect(sessionBody.entity.type).toBe('memory');
    expect(sessionBody.entity.tags).toEqual(
      expect.arrayContaining(['session-context', 'cli'])
    );
    expect(sessionBody.entity.metadata).toMatchObject({
      memory_role: 'session_context',
      session_scope: { kind: 'client', client_id: 'codex-cli' },
      topic: 'postgram-memory',
      agent_id: 'codex'
    });

    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    });
    await worker.runOnce();
    await worker.runOnce();

    const searchResult = await runPgm(
      [
        'search',
        'memory lifecycle roles',
        '--memory-role',
        'session_context',
        '--visibility',
        'personal',
        '--threshold',
        '0',
        '--json'
      ],
      env
    );
    const searchBody = parseJson(searchResult.stdout) as {
      results: Array<{ id: string; metadata?: Record<string, unknown> }>;
    };
    expect(searchBody.results.map((entry) => entry.id)).toContain(
      sessionBody.entity.id
    );
    expect(
      searchBody.results.every((entry) => entry.metadata === undefined)
    ).toBe(true);
  }, 120_000);

  it('self-grooms stale session-context memories in dry-run mode with filters', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const ownKey = (
      await createKey(database.pool, {
        name: `self-groom-own-${crypto.randomUUID()}`,
        clientId: 'codex-cli',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['personal']
      })
    )._unsafeUnwrap();
    const otherKey = (
      await createKey(database.pool, {
        name: `self-groom-other-${crypto.randomUUID()}`,
        clientId: 'talon-cli',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['personal']
      })
    )._unsafeUnwrap();

    const env = {
      PGM_API_URL: baseUrl,
      PGM_API_KEY: ownKey.plaintextKey
    };

    const ownSeed = await runPgm(
      [
        'memory',
        'session-context',
        'Own stale context.',
        '--visibility',
        'personal',
        '--topic',
        'project-alpha',
        '--session-id',
        'thread-1',
        '--tags',
        'alpha,shared',
        '--groom-after',
        '2026-01-01T00:00:00.000Z',
        '--json'
      ],
      env
    );
    const ownBody = parseJson(ownSeed.stdout) as { entity: { id: string } };

    const otherEnv = {
      PGM_API_URL: baseUrl,
      PGM_API_KEY: otherKey.plaintextKey
    };
    const otherSeed = await runPgm(
      [
        'memory',
        'session-context',
        'Other stale context.',
        '--visibility',
        'personal',
        '--topic',
        'project-beta',
        '--session-id',
        'thread-2',
        '--tags',
        'beta,shared',
        '--groom-after',
        '2026-01-01T00:00:00.000Z',
        '--json'
      ],
      otherEnv
    );
    const otherBody = parseJson(otherSeed.stdout) as { entity: { id: string } };

    const result = await runPgm(
      [
        'memory',
        'groom',
        '--dry-run',
        '--older-than',
        '30d',
        '--limit',
        '5',
        '--topic',
        'project-alpha',
        '--session-id',
        'thread-1',
        '--tag',
        'alpha',
        '--tag',
        'shared',
        '--json'
      ],
      env
    );
    const body = parseJson(result.stdout) as {
      dryRun: boolean;
      archived: number;
      promoted: number;
      skipped: number;
      mode: string;
      eligible: Array<{ id: string }>;
    };

    expect(body).toMatchObject({
      dryRun: true,
      archived: 0,
      promoted: 0,
      skipped: 0,
      mode: 'archive'
    });
    expect(body.eligible.map((entry) => entry.id)).toEqual([ownBody.entity.id]);

    for (const olderThan of ['15m', '2h', '3d']) {
      const durationResult = await runPgm(
        [
          'memory',
          'groom',
          '--dry-run',
          '--older-than',
          olderThan,
          '--limit',
          '5',
          '--topic',
          'project-alpha',
          '--session-id',
          'thread-1',
          '--tag',
          'alpha',
          '--tag',
          'shared',
          '--json'
        ],
        env
      );

      const durationBody = parseJson(durationResult.stdout) as {
        dryRun: boolean;
        archived: number;
        promoted: number;
        skipped: number;
        mode: string;
        eligible: Array<{ id: string }>;
      };

      expect(durationBody).toMatchObject({
        dryRun: true,
        archived: 0,
        promoted: 0,
        skipped: 0,
        mode: 'archive'
      });
      expect(durationBody.eligible.map((entry) => entry.id)).toEqual([ownBody.entity.id]);
    }

    const rows = await database.pool.query<{ id: string; status: string | null }>(
      'SELECT id, status FROM entities WHERE id = ANY($1)',
      [[ownBody.entity.id, otherBody.entity.id]]
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row.status]));
    expect(byId[ownBody.entity.id]).toBeNull();
    expect(byId[otherBody.entity.id]).toBeNull();
  }, 120_000);

  it('archives only the authenticated client session context after --yes confirmation', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const ownKey = (
      await createKey(database.pool, {
        name: `self-groom-archive-own-${crypto.randomUUID()}`,
        clientId: 'codex-cli',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['personal']
      })
    )._unsafeUnwrap();
    const otherKey = (
      await createKey(database.pool, {
        name: `self-groom-archive-other-${crypto.randomUUID()}`,
        clientId: 'talon-cli',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['personal']
      })
    )._unsafeUnwrap();

    const env = {
      PGM_API_URL: baseUrl,
      PGM_API_KEY: ownKey.plaintextKey
    };
    const otherEnv = {
      PGM_API_URL: baseUrl,
      PGM_API_KEY: otherKey.plaintextKey
    };

    const ownSeed = await runPgm(
      [
        'memory',
        'session-context',
        'Own archivable context.',
        '--visibility',
        'personal',
        '--topic',
        'project-archive',
        '--session-id',
        'thread-archive-1',
        '--tags',
        'archive,alpha',
        '--groom-after',
        '2026-01-01T00:00:00.000Z',
        '--json'
      ],
      env
    );
    const ownBody = parseJson(ownSeed.stdout) as { entity: { id: string } };

    const otherSeed = await runPgm(
      [
        'memory',
        'session-context',
        'Other archivable context.',
        '--visibility',
        'personal',
        '--topic',
        'project-archive',
        '--session-id',
        'thread-archive-2',
        '--tags',
        'archive,beta',
        '--groom-after',
        '2026-01-01T00:00:00.000Z',
        '--json'
      ],
      otherEnv
    );
    const otherBody = parseJson(otherSeed.stdout) as { entity: { id: string } };

    const result = await runPgm(
      ['memory', 'groom', '--yes', '--json'],
      env
    );
    const body = parseJson(result.stdout) as {
      dryRun: boolean;
      archived: number;
      promoted: number;
      skipped: number;
      mode: string;
      promotions: Array<unknown>;
    };

    expect(body).toEqual({
      dryRun: false,
      archived: 1,
      promoted: 0,
      skipped: 0,
      mode: 'archive',
      promotions: []
    });

    const rows = await database.pool.query<{ id: string; status: string | null }>(
      'SELECT id, status FROM entities WHERE id = ANY($1)',
      [[ownBody.entity.id, otherBody.entity.id]]
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row.status]));
    expect(byId[ownBody.entity.id]).toBe('archived');
    expect(byId[otherBody.entity.id]).toBeNull();
  }, 120_000);

  it('requires --yes before archive mutations', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (
      await createKey(database.pool, {
        name: `self-groom-confirm-${crypto.randomUUID()}`,
        clientId: 'codex-cli',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['personal']
      })
    )._unsafeUnwrap();

    const result = await runPgmCapture(
      ['memory', 'groom', '--json'],
      {
        PGM_API_URL: baseUrl,
        PGM_API_KEY: createdKey.plaintextKey
      }
    );

    expect(result.code).toBe(1);
    expect(result.stderr || result.stdout).toMatch(
      /--yes is required outside dry-run/
    );
  }, 120_000);

  it('rejects cross-client groom flags on the normal CLI surface', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (
      await createKey(database.pool, {
        name: `self-groom-invalid-${crypto.randomUUID()}`,
        clientId: 'codex-cli',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['personal']
      })
    )._unsafeUnwrap();

    const result = await runPgmCapture(
      ['memory', 'groom', '--client-id', 'talon-cli', '--json'],
      {
        PGM_API_URL: baseUrl,
        PGM_API_KEY: createdKey.plaintextKey
      }
    );

    expect(result.code).toBe(1);
    expect(result.stderr || result.stdout).toMatch(
      /unknown option '--client-id'/
    );
  }, 120_000);

  it('rejects groom admin flags on the normal CLI', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (
      await createKey(database.pool, {
        name: `self-groom-promote-${crypto.randomUUID()}`,
        clientId: 'codex-cli',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['personal']
      })
    )._unsafeUnwrap();

    const result = await runPgmCapture(
      ['memory', 'groom', '--mode', 'promote', '--json'],
      {
        PGM_API_URL: baseUrl,
        PGM_API_KEY: createdKey.plaintextKey
      }
    );

    expect(result.code).toBe(1);
    expect(result.stderr || result.stdout).toMatch(
      /unknown option '--mode'/
    );
  }, 120_000);

  it('stores entities with skipped extraction through REST', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (
      await createKey(database.pool, {
        name: `cli-skip-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared']
      })
    )._unsafeUnwrap();

    const storeResult = await runPgm(
      [
        'store',
        'conversation import that should only be embedded',
        '--type',
        'interaction',
        '--skip-extraction',
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

    const row = await database.pool.query<{ extraction_status: string | null }>(
      'SELECT extraction_status FROM entities WHERE id = $1',
      [storeBody.entity.id]
    );
    expect(row.rows[0]?.extraction_status).toBe('skipped');
  }, 120_000);

  it('lists entities filtered by type', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (
      await createKey(database.pool, {
        name: `list-${crypto.randomUUID()}`,
        scopes: ['read', 'write'],
        allowedVisibility: ['shared']
      })
    )._unsafeUnwrap();

    const env = {
      PGM_API_URL: baseUrl,
      PGM_API_KEY: createdKey.plaintextKey
    };

    await runPgm(['store', 'first memory', '--type', 'memory', '--json'], env);
    await runPgm(['store', 'a project', '--type', 'project', '--json'], env);

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

  it('supports owner-scoped store, list, search, and graph expansion', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (
      await createKey(database.pool, {
        name: `owner-cli-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared']
      })
    )._unsafeUnwrap();

    const env = {
      PGM_API_URL: baseUrl,
      PGM_API_KEY: createdKey.plaintextKey
    };

    const sharedStore = await runPgm(
      ['store', 'shared planning notes', '--type', 'memory', '--json'],
      env
    );
    const shared = (
      parseJson(sharedStore.stdout) as {
        entity: { id: string };
      }
    ).entity;

    const pmStore = await runPgm(
      [
        'store',
        'product manager planning notes',
        '--type',
        'memory',
        '--owner',
        'product-manager',
        '--json'
      ],
      env
    );
    const productManager = (
      parseJson(pmStore.stdout) as {
        entity: { id: string; owner: string | null };
      }
    ).entity;
    expect(productManager.owner).toBe('product-manager');

    const devStore = await runPgm(
      [
        'store',
        'developer planning notes',
        '--type',
        'memory',
        '--owner',
        'developer',
        '--json'
      ],
      env
    );
    const developer = (
      parseJson(devStore.stdout) as {
        entity: { id: string };
      }
    ).entity;

    await runPgm(
      [
        'link',
        productManager.id,
        shared.id,
        '--relation',
        'references',
        '--json'
      ],
      env
    );
    await runPgm(
      [
        'link',
        productManager.id,
        developer.id,
        '--relation',
        'references',
        '--json'
      ],
      env
    );

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const listResult = await runPgm(
      ['list', '--owner', 'product-manager', '--json'],
      env
    );
    const listBody = parseJson(listResult.stdout) as {
      items: Array<{ id: string }>;
    };
    expect(listBody.items.map((item) => item.id).sort()).toEqual(
      [shared.id, productManager.id].sort()
    );

    const searchResult = await runPgm(
      [
        'search',
        'planning notes',
        '--owner',
        'product-manager',
        '--threshold',
        '0',
        '--json'
      ],
      env
    );
    const searchBody = parseJson(searchResult.stdout) as {
      results: Array<{ id: string }>;
    };
    expect(searchBody.results.map((entry) => entry.id).sort()).toEqual(
      [shared.id, productManager.id].sort()
    );

    const expandResult = await runPgm(
      ['expand', productManager.id, '--owner', 'product-manager', '--json'],
      env
    );
    const expandBody = parseJson(expandResult.stdout) as {
      entities: Array<{ id: string }>;
      edges: Array<{ id: string }>;
    };
    expect(expandBody.entities.map((entity) => entity.id).sort()).toEqual(
      [shared.id, productManager.id].sort()
    );
    expect(expandBody.edges).toHaveLength(1);
  }, 120_000);

  it('supports full-response, TOON, and discoverable help for search output', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (
      await createKey(database.pool, {
        name: `search-format-${crypto.randomUUID()}`,
        scopes: ['read', 'write'],
        allowedVisibility: ['shared']
      })
    )._unsafeUnwrap();

    const env = {
      PGM_API_URL: baseUrl,
      PGM_API_KEY: createdKey.plaintextKey
    };

    const storeResult = await runPgm(
      [
        'store',
        'token compact search response shape',
        '--type',
        'memory',
        '--json'
      ],
      env
    );
    const stored = (parseJson(storeResult.stdout) as { entity: { id: string } })
      .entity;

    await createEnrichmentWorker({
      pool: database.pool,
      embeddingService
    }).runOnce();

    const compactResult = await runPgm(
      ['search', 'compact search', '--threshold', '0', '--json'],
      env
    );
    const compact = parseJson(compactResult.stdout) as {
      results: Array<{
        id: string;
        type: string;
        content: string | null;
        chunk: string;
        score: number;
      }>;
    };
    const firstCompactResult = compact.results[0];
    if (!firstCompactResult) {
      throw new Error('expected compact search result');
    }
    expect(firstCompactResult).toMatchObject({
      id: stored.id,
      type: 'memory',
      content: 'token compact search response shape',
      chunk: 'token compact search response shape'
    });
    expect(typeof firstCompactResult.score).toBe('number');

    const fullResult = await runPgm(
      [
        'search',
        'compact search',
        '--threshold',
        '0',
        '--json',
        '--full-response'
      ],
      env
    );
    const full = parseJson(fullResult.stdout) as {
      results: Array<{
        entity: { id: string; metadata: Record<string, unknown> };
        chunk_content: string;
        similarity: number;
      }>;
    };
    expect(full.results[0]?.entity.id).toBe(stored.id);
    expect(full.results[0]?.chunk_content).toContain('compact search');
    expect(full.results[0]?.similarity).toEqual(expect.any(Number));

    const toonResult = await runPgm(
      ['search', 'compact search', '--threshold', '0', '--toon'],
      env
    );
    expect(toonResult.stdout).toContain(
      'results[1]{id,type,score,content,chunk,tags,related}:'
    );
    expect(toonResult.stdout).toContain(stored.id);
    expect(toonResult.stdout).not.toContain('created_at');

    const helpResult = await runPgm(['search', '--help'], env);
    expect(helpResult.stdout).toContain('--full-response');
    expect(helpResult.stdout).toContain('emit the full API response');
    expect(helpResult.stdout).toContain('--toon');
    expect(helpResult.stdout).toContain('emit compact TOON output');
  }, 120_000);

  it('adds, lists, updates, and completes tasks through REST', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (
      await createKey(database.pool, {
        name: `task-cli-${crypto.randomUUID()}`,
        scopes: ['read', 'write'],
        allowedVisibility: ['shared']
      })
    )._unsafeUnwrap();

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
        '--json',
        '--full-response'
      ],
      {
        PGM_API_URL: baseUrl,
        PGM_API_KEY: createdKey.plaintextKey
      }
    );
    const addBody = parseJson(addResult.stdout) as {
      entity: {
        id: string;
        version: number;
        status: string;
        metadata: Record<string, string>;
      };
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
        '--json',
        '--full-response'
      ],
      {
        PGM_API_URL: baseUrl,
        PGM_API_KEY: createdKey.plaintextKey
      }
    );
    const updateBody = parseJson(updateResult.stdout) as {
      entity: {
        version: number;
        status: string;
        metadata: Record<string, string>;
      };
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
        '--json',
        '--full-response'
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

  it('links, expands, and unlinks entities', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const createdKey = (
      await createKey(database.pool, {
        name: `graph-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared']
      })
    )._unsafeUnwrap();

    const env = {
      PGM_API_URL: baseUrl,
      PGM_API_KEY: createdKey.plaintextKey
    };

    const storeA = await runPgm(
      ['store', 'Alice', '--type', 'person', '--json'],
      env
    );
    const entityA = (parseJson(storeA.stdout) as { entity: { id: string } })
      .entity;

    const storeB = await runPgm(
      ['store', 'Project X', '--type', 'project', '--json'],
      env
    );
    const entityB = (parseJson(storeB.stdout) as { entity: { id: string } })
      .entity;

    // Link
    const linkResult = await runPgm(
      ['link', entityA.id, entityB.id, '--relation', 'involves', '--json'],
      env
    );
    const linkBody = parseJson(linkResult.stdout) as {
      edge: { id: string; relation: string };
    };
    expect(linkBody.edge.relation).toBe('involves');

    // Expand
    const expandResult = await runPgm(['expand', entityA.id, '--json'], env);
    const expandBody = parseJson(expandResult.stdout) as {
      entities: Array<{ id: string }>;
      edges: Array<{ id: string }>;
    };
    expect(expandBody.entities.length).toBeGreaterThanOrEqual(2);
    expect(expandBody.edges).toHaveLength(1);

    // Unlink
    const unlinkResult = await runPgm(
      ['unlink', linkBody.edge.id, '--json'],
      env
    );
    const unlinkBody = parseJson(unlinkResult.stdout) as { deleted: boolean };
    expect(unlinkBody.deleted).toBe(true);
  }, 120_000);

  it('syncs a local directory of markdown files', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const nodePath = await import('node:path');

    const createdKey = (
      await createKey(database.pool, {
        name: `sync-${crypto.randomUUID()}`,
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared']
      })
    )._unsafeUnwrap();

    const env = {
      PGM_API_URL: baseUrl,
      PGM_API_KEY: createdKey.plaintextKey
    };

    const tempDir = await fsp.mkdtemp(
      nodePath.join(os.tmpdir(), 'pgm-sync-test-')
    );
    await fsp.writeFile(
      nodePath.join(tempDir, 'alpha.md'),
      '# Alpha\n\nAlpha content.'
    );
    await fsp.writeFile(
      nodePath.join(tempDir, 'beta.md'),
      'Beta content without heading.'
    );

    const syncResult = await runPgm(['sync', tempDir, '--json'], env);
    const syncBody = parseJson(syncResult.stdout) as {
      created: number;
      updated: number;
      unchanged: number;
      deleted: number;
    };
    expect(syncBody.created).toBe(2);
    expect(syncBody.unchanged).toBe(0);

    const resyncResult = await runPgm(['sync', tempDir, '--json'], env);
    const resyncBody = parseJson(resyncResult.stdout) as {
      unchanged: number;
    };
    expect(resyncBody.unchanged).toBe(2);

    await fsp.rm(tempDir, { recursive: true });
  }, 120_000);
});
