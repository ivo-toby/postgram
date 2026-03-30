import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { createKey } from '../../src/auth/key-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import { storeEntity } from '../../src/services/entity-service.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const execFileAsync = promisify(execFile);
const TSX_BIN = path.resolve('node_modules/.bin/tsx');
const PGM_ADMIN_ENTRYPOINT = path.resolve('src/cli/admin/pgm-admin.ts');

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout.trim());
}

async function runAdmin(args: string[], env: NodeJS.ProcessEnv) {
  return execFileAsync(TSX_BIN, [PGM_ADMIN_ENTRYPOINT, ...args], {
    env: {
      ...process.env,
      ...env
    },
    cwd: process.cwd(),
    maxBuffer: 10_000_000,
    timeout: 120_000
  });
}

function makeAuthContext(apiKeyId = '00000000-0000-0000-0000-000000000000'): AuthContext {
  return {
    apiKeyId,
    keyName: 'admin-seed',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

function getDatabaseUrl(database: TestDatabase): string {
  const options = database.pool.options as {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
  };

  if (!options.host || !options.port || !options.database || !options.user) {
    throw new Error('test database connection options are incomplete');
  }

  const password = options.password ?? '';
  return `postgresql://${encodeURIComponent(options.user)}:${encodeURIComponent(password)}@${options.host}:${options.port}/${options.database}`;
}

describe('pgm-admin CLI', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('creates, lists, revokes keys, and emits audit rows for admin actions', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const createResult = await runAdmin(
      [
        'key',
        'create',
        '--name',
        'admin-alpha',
        '--scopes',
        'read,write',
        '--visibility',
        'shared,work',
        '--json'
      ],
      {
        DATABASE_URL: databaseUrl
      }
    );
    const createdBody = parseJson(createResult.stdout) as {
      plaintextKey: string;
      record: { id: string; keyHash: string; isActive: boolean };
    };
    expect(createdBody.plaintextKey).toMatch(/^pgm-admin-alpha-/);
    expect(createdBody.record.keyHash).not.toContain(createdBody.plaintextKey);
    expect(createdBody.record.isActive).toBe(true);

    const listResult = await runAdmin(
      ['key', 'list', '--json'],
      {
        DATABASE_URL: databaseUrl
      }
    );
    const listBody = parseJson(listResult.stdout) as {
      keys: Array<{ id: string; name: string; isActive: boolean }>;
    };
    expect(listBody.keys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createdBody.record.id,
          name: 'admin-alpha',
          isActive: true
        })
      ])
    );

    const auditBefore = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_log'
    );

    const revokeResult = await runAdmin(
      ['key', 'revoke', createdBody.record.id, '--json'],
      {
        DATABASE_URL: databaseUrl
      }
    );
    const revokeBody = parseJson(revokeResult.stdout) as {
      revoked: boolean;
      id: string;
    };
    expect(revokeBody).toEqual({
      revoked: true,
      id: createdBody.record.id
    });

    const auditResult = await runAdmin(
      ['audit', '--operation', 'key.create,key.revoke', '--json'],
      {
        DATABASE_URL: databaseUrl
      }
    );
    const auditBody = parseJson(auditResult.stdout) as {
      entries: Array<{ operation: string }>;
    };
    expect(auditBody.entries.map((entry) => entry.operation)).toEqual(
      expect.arrayContaining(['key.create', 'key.revoke'])
    );

    const auditAfter = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_log'
    );
    expect(Number(auditAfter.rows[0]?.count ?? '0')).toBeGreaterThanOrEqual(
      Number(auditBefore.rows[0]?.count ?? '0') + 2
    );

    const revokedRow = await database.pool.query<{ is_active: boolean }>(
      'SELECT is_active FROM api_keys WHERE id = $1',
      [createdBody.record.id]
    );
    expect(revokedRow.rows[0]?.is_active).toBe(false);
  }, 120_000);

  it('lists and switches embedding models and reports system stats', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `stats-${crypto.randomUUID()}`,
      scopes: ['read']
    }))._unsafeUnwrap();
    const seededEntity = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'seeded memory for stats'
    }))._unsafeUnwrap();

    const insertedModel = await database.pool.query<{ id: string }>(
      `
        INSERT INTO embedding_models (
          name,
          provider,
          dimensions,
          chunk_size,
          chunk_overlap,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, false)
        RETURNING id
      `,
      ['alternate-model', 'openai', 1536, 300, 100]
    );
    const targetModelId = insertedModel.rows[0]?.id;
    if (!targetModelId) {
      throw new Error('failed to seed embedding model');
    }

    const listBeforeResult = await runAdmin(
      ['model', 'list', '--json'],
      {
        DATABASE_URL: databaseUrl
      }
    );
    const listBefore = parseJson(listBeforeResult.stdout) as {
      models: Array<{ id: string; isActive: boolean }>;
    };
    expect(listBefore.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ isActive: true })
      ])
    );

    const auditBefore = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_log'
    );

    const setActiveResult = await runAdmin(
      ['model', 'set-active', targetModelId, '--json'],
      {
        DATABASE_URL: databaseUrl
      }
    );
    const setActiveBody = parseJson(setActiveResult.stdout) as {
      model: { id: string; isActive: boolean; name: string };
    };
    expect(setActiveBody.model.id).toBe(targetModelId);
    expect(setActiveBody.model.isActive).toBe(true);

    const listAfterResult = await runAdmin(
      ['model', 'list', '--json'],
      {
        DATABASE_URL: databaseUrl
      }
    );
    const listAfter = parseJson(listAfterResult.stdout) as {
      models: Array<{ id: string; isActive: boolean }>;
    };
    expect(listAfter.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: targetModelId, isActive: true })
      ])
    );

    const statsResult = await runAdmin(
      ['stats', '--json'],
      {
        DATABASE_URL: databaseUrl
      }
    );
    const statsBody = parseJson(statsResult.stdout) as {
      entityCounts: Record<string, number>;
      chunkCount: number;
      keyCount: number;
    };
    expect(statsBody).toMatchObject({
      entityCounts: {
        memory: 1
      },
      chunkCount: 0,
      keyCount: 1
    });

    const auditAfter = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM audit_log'
    );
    expect(Number(auditAfter.rows[0]?.count ?? '0')).toBe(
      Number(auditBefore.rows[0]?.count ?? '0') + 3
    );

    expect(seededKey.record.id).toBeTruthy();
    expect(seededEntity.id).toBeTruthy();
  }, 120_000);

  it('re-embeds entities by clearing chunks and marking them pending', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `reembed-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    const stored = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'memory that needs re-embedding'
    }))._unsafeUnwrap();

    const { createEnrichmentWorker } = await import(
      '../../src/services/enrichment-worker.js'
    );
    const { createEmbeddingService } = await import(
      '../../src/services/embedding-service.js'
    );
    const worker = createEnrichmentWorker({
      pool: database.pool,
      embeddingService: createEmbeddingService()
    });
    await worker.runOnce();

    const chunksBefore = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM chunks WHERE entity_id = $1',
      [stored.id]
    );
    expect(Number(chunksBefore.rows[0]?.count ?? '0')).toBeGreaterThan(0);

    const reembedResult = await runAdmin(
      ['reembed', '--all', '--json'],
      { DATABASE_URL: databaseUrl }
    );
    const reembedBody = parseJson(reembedResult.stdout) as {
      markedCount: number;
    };
    expect(reembedBody.markedCount).toBeGreaterThanOrEqual(1);

    const chunksAfter = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM chunks WHERE entity_id = $1',
      [stored.id]
    );
    expect(Number(chunksAfter.rows[0]?.count ?? '0')).toBe(0);

    const entityRow = await database.pool.query<{
      enrichment_status: string;
      enrichment_attempts: number;
    }>(
      'SELECT enrichment_status, enrichment_attempts FROM entities WHERE id = $1',
      [stored.id]
    );
    expect(entityRow.rows[0]?.enrichment_status).toBe('pending');
    expect(entityRow.rows[0]?.enrichment_attempts).toBe(0);

    const auditRows = await database.pool.query<{ operation: string }>(
      "SELECT operation FROM audit_log WHERE operation = 'reembed.start' ORDER BY timestamp DESC LIMIT 1"
    );
    expect(auditRows.rows[0]?.operation).toBe('reembed.start');
  }, 120_000);
});
