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

  it('re-extracts entities by resetting extraction_status and clearing errors', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `reextract-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    const stored = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'memory that needs re-extraction'
    }))._unsafeUnwrap();

    // Simulate a prior failed extraction with an error message.
    await database.pool.query(
      `UPDATE entities
       SET extraction_status = 'failed',
           extraction_error = 'llm timed out'
       WHERE id = $1`,
      [stored.id]
    );

    const reextractResult = await runAdmin(
      ['reextract', '--all', '--json'],
      { DATABASE_URL: databaseUrl }
    );
    const reextractBody = parseJson(reextractResult.stdout) as {
      markedCount: number;
    };
    expect(reextractBody.markedCount).toBeGreaterThanOrEqual(1);

    const entityRow = await database.pool.query<{
      extraction_status: string;
      extraction_error: string | null;
    }>(
      'SELECT extraction_status, extraction_error FROM entities WHERE id = $1',
      [stored.id]
    );
    expect(entityRow.rows[0]?.extraction_status).toBe('pending');
    expect(entityRow.rows[0]?.extraction_error).toBeNull();

    const auditRows = await database.pool.query<{ operation: string }>(
      "SELECT operation FROM audit_log WHERE operation = 'reextract.start' ORDER BY timestamp DESC LIMIT 1"
    );
    expect(auditRows.rows[0]?.operation).toBe('reextract.start');
  }, 120_000);

  it('reextract skips archived and auto-created entities', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `scope-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    const active = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'normal entity that should be reextracted'
    }))._unsafeUnwrap();
    const archived = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'archived entity that should NOT be touched'
    }))._unsafeUnwrap();
    await database.pool.query(
      "UPDATE entities SET status = 'archived', extraction_status = 'completed' WHERE id = $1",
      [archived.id]
    );

    // Simulate an auto-created stub — should also be skipped to prevent loop.
    const autoStub = await database.pool.query<{ id: string }>(
      `INSERT INTO entities (type, content, visibility, enrichment_status, extraction_status, tags)
       VALUES ('person', 'Alice', 'shared', 'completed', NULL, ARRAY['auto-created'])
       RETURNING id`
    );

    // Ensure the active entity is in a post-extraction state so we can verify it resets.
    await database.pool.query(
      "UPDATE entities SET extraction_status = 'completed' WHERE id = $1",
      [active.id]
    );

    const result = await runAdmin(
      ['reextract', '--all', '--json'],
      { DATABASE_URL: databaseUrl }
    );
    const body = parseJson(result.stdout) as { markedCount: number };
    expect(body.markedCount).toBe(1);

    const rows = await database.pool.query<{
      id: string;
      extraction_status: string | null;
    }>(
      'SELECT id, extraction_status FROM entities WHERE id = ANY($1)',
      [[active.id, archived.id, autoStub.rows[0]!.id]]
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId[active.id]?.extraction_status).toBe('pending');
    expect(byId[archived.id]?.extraction_status).toBe('completed');
    expect(byId[autoStub.rows[0]!.id]?.extraction_status).toBeNull();

    // --include-auto-created re-queues auto-created stubs (archived still skipped).
    const forced = await runAdmin(
      ['reextract', '--all', '--include-auto-created', '--json'],
      { DATABASE_URL: databaseUrl }
    );
    const forcedBody = parseJson(forced.stdout) as { markedCount: number };
    expect(forcedBody.markedCount).toBe(2);

    const after = await database.pool.query<{
      id: string;
      extraction_status: string | null;
    }>(
      'SELECT id, extraction_status FROM entities WHERE id = ANY($1)',
      [[archived.id, autoStub.rows[0]!.id]]
    );
    const afterById = Object.fromEntries(after.rows.map((r) => [r.id, r]));
    expect(afterById[archived.id]?.extraction_status).toBe('completed');
    expect(afterById[autoStub.rows[0]!.id]?.extraction_status).toBe('pending');
  }, 120_000);

  it('reextract --show-skipped reports per-category skipped counts', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `skipped-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    // 1 normal entity (will be marked), 1 archived, 1 auto-created. The
    // no-content bucket is harder to seed via storeEntity (it requires
    // content), so a direct insert with NULL content covers that case.
    const active = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'normal entity that should be reextracted'
    }))._unsafeUnwrap();
    const archived = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'archived entity'
    }))._unsafeUnwrap();
    await database.pool.query(
      "UPDATE entities SET status = 'archived' WHERE id = $1",
      [archived.id]
    );
    await database.pool.query(
      `INSERT INTO entities (type, content, visibility, enrichment_status, extraction_status, tags)
       VALUES ('memory', 'Bob', 'shared', 'completed', 'completed', ARRAY['auto-created'])`
    );
    await database.pool.query(
      `INSERT INTO entities (type, content, visibility, enrichment_status, extraction_status)
       VALUES ('memory', NULL, 'shared', 'completed', 'completed')`
    );

    const result = await runAdmin(
      ['reextract', '--type', 'memory', '--show-skipped', '--json'],
      { DATABASE_URL: databaseUrl }
    );
    const body = parseJson(result.stdout) as {
      markedCount: number;
      skipped: { noContent: number; archived: number; autoCreated: number };
    };
    expect(body.markedCount).toBeGreaterThanOrEqual(1);
    expect(body.skipped.archived).toBeGreaterThanOrEqual(1);
    expect(body.skipped.autoCreated).toBeGreaterThanOrEqual(1);
    expect(body.skipped.noContent).toBeGreaterThanOrEqual(1);

    // Ensure the active entity was the one marked.
    const entityRow = await database.pool.query<{ extraction_status: string }>(
      'SELECT extraction_status FROM entities WHERE id = $1',
      [active.id]
    );
    expect(entityRow.rows[0]?.extraction_status).toBe('pending');
  }, 120_000);

  it('validate-edges returns a structured --json error when extraction is not configured', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    // EXTRACTION_ENABLED unset → handleCliFailure should produce a
    // structured JSON payload on stdout and exit non-zero. Without the fix,
    // loadConfig/createLlmProvider failures would throw uncaught.
    let exitCode: number | null = null;
    let stdout = '';
    try {
      await runAdmin(['validate-edges', '--json'], {
        DATABASE_URL: databaseUrl,
        EXTRACTION_ENABLED: 'false',
        OPENAI_API_KEY: 'sk-test-fake' // satisfy loadConfig's superRefine
      });
    } catch (error) {
      const err = error as { code: number; stdout: string };
      exitCode = err.code;
      stdout = err.stdout;
    }
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout.trim()) as {
      error: { code: string; message: string };
    };
    expect(parsed.error.message).toMatch(/EXTRACTION_ENABLED/);
  }, 120_000);

  it('reextract --clean-edges deletes prior llm-extraction edges', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `clean-edges-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    const src = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory', content: 'source'
    }))._unsafeUnwrap();
    const tgt = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'project', content: 'target'
    }))._unsafeUnwrap();

    await database.pool.query(
      `INSERT INTO edges (source_id, target_id, relation, source, confidence)
       VALUES ($1, $2, 'involves', 'llm-extraction', 0.9),
              ($1, $2, 'part_of',  'manual',         1.0)`,
      [src.id, tgt.id]
    );

    const result = await runAdmin(
      ['reextract', '--all', '--clean-edges', '--json'],
      { DATABASE_URL: databaseUrl }
    );
    const body = parseJson(result.stdout) as {
      markedCount: number;
      deletedEdges: number;
    };
    expect(body.deletedEdges).toBe(1);

    const remaining = await database.pool.query<{ source: string }>(
      'SELECT source FROM edges'
    );
    expect(remaining.rows).toHaveLength(1);
    expect(remaining.rows[0]?.source).toBe('manual');
  }, 120_000);

  it('reextract --only-failed re-queues only failed entities', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `reextract-failed-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    const failed = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'entity that failed extraction'
    }))._unsafeUnwrap();
    const completed = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'entity that succeeded extraction'
    }))._unsafeUnwrap();

    await database.pool.query(
      `UPDATE entities
       SET extraction_status = 'failed',
           extraction_error = 'llm timed out'
       WHERE id = $1`,
      [failed.id]
    );
    await database.pool.query(
      "UPDATE entities SET extraction_status = 'completed' WHERE id = $1",
      [completed.id]
    );

    const result = await runAdmin(
      ['reextract', '--only-failed', '--json'],
      { DATABASE_URL: databaseUrl }
    );
    const body = parseJson(result.stdout) as { markedCount: number };
    expect(body.markedCount).toBe(1);

    const rows = await database.pool.query<{
      id: string;
      extraction_status: string | null;
      extraction_error: string | null;
    }>(
      'SELECT id, extraction_status, extraction_error FROM entities WHERE id = ANY($1)',
      [[failed.id, completed.id]]
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId[failed.id]?.extraction_status).toBe('pending');
    expect(byId[failed.id]?.extraction_error).toBeNull();
    expect(byId[completed.id]?.extraction_status).toBe('completed');

    const auditRows = await database.pool.query<{ details: { onlyFailed: boolean } }>(
      "SELECT details FROM audit_log WHERE operation = 'reextract.start' ORDER BY timestamp DESC LIMIT 1"
    );
    expect(auditRows.rows[0]?.details.onlyFailed).toBe(true);
  }, 120_000);

  it('reextract --id re-queues a single entity', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `reextract-id-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    const target = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'this single entity should be re-extracted'
    }))._unsafeUnwrap();
    const other = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'this entity should NOT be touched'
    }))._unsafeUnwrap();
    await database.pool.query(
      "UPDATE entities SET extraction_status = 'completed' WHERE id IN ($1, $2)",
      [target.id, other.id]
    );

    const result = await runAdmin(
      ['reextract', '--id', target.id, '--json'],
      { DATABASE_URL: databaseUrl }
    );
    const body = parseJson(result.stdout) as { markedCount: number };
    expect(body.markedCount).toBe(1);

    const rows = await database.pool.query<{
      id: string;
      extraction_status: string | null;
    }>(
      'SELECT id, extraction_status FROM entities WHERE id = ANY($1)',
      [[target.id, other.id]]
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId[target.id]?.extraction_status).toBe('pending');
    expect(byId[other.id]?.extraction_status).toBe('completed');
  }, 120_000);

  it('reextract --id rejects malformed UUIDs before touching the DB', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    let stdout = '';
    try {
      await runAdmin(['reextract', '--id', 'not-a-uuid', '--json'], {
        DATABASE_URL: databaseUrl
      });
      throw new Error('expected non-zero exit');
    } catch (err) {
      stdout = (err as { stdout?: string }).stdout ?? '';
    }
    expect(stdout).toMatch(/must be a valid UUID/);
  }, 120_000);

  it('reextract --limit caps the number of entities marked', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `reextract-limit-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    // Create five entities; --limit 2 should mark only two.
    for (let i = 0; i < 5; i++) {
      (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
        type: 'memory',
        content: `entity ${i}`
      }))._unsafeUnwrap();
    }
    await database.pool.query(
      "UPDATE entities SET extraction_status = 'completed'"
    );

    const result = await runAdmin(
      ['reextract', '--all', '--limit', '2', '--json'],
      { DATABASE_URL: databaseUrl }
    );
    const body = parseJson(result.stdout) as { markedCount: number };
    expect(body.markedCount).toBe(2);

    const pendingCount = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM entities WHERE extraction_status = 'pending'"
    );
    expect(Number(pendingCount.rows[0]!.count)).toBe(2);
  }, 120_000);

  it('reextract --limit rejects non-positive values', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    let stdout = '';
    try {
      await runAdmin(['reextract', '--all', '--limit', '0', '--json'], {
        DATABASE_URL: databaseUrl
      });
      throw new Error('expected non-zero exit');
    } catch (err) {
      stdout = (err as { stdout?: string }).stdout ?? '';
    }
    expect(stdout).toMatch(/must be a positive integer/);
  }, 120_000);

  it('improve-graph queues selected entities and stores model/provider override', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `improve-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    const source = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'Alice helped review the change to the auth subsystem and signed off'
    }))._unsafeUnwrap();
    const other = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'unrelated entity'
    }))._unsafeUnwrap();
    await database.pool.query(
      "UPDATE entities SET extraction_status = 'completed'"
    );

    const result = await runAdmin(
      [
        'improve-graph',
        '--id', source.id,
        '--model', 'claude-sonnet-4-6',
        '--provider', 'anthropic',
        '--json'
      ],
      { DATABASE_URL: databaseUrl }
    );
    const body = parseJson(result.stdout) as {
      markedCount: number;
      model: string | null;
      provider: string | null;
    };
    expect(body.markedCount).toBe(1);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.provider).toBe('anthropic');

    const rows = await database.pool.query<{
      id: string;
      extraction_status: string | null;
      extraction_model_override: string | null;
      extraction_provider_override: string | null;
    }>(
      `SELECT id, extraction_status,
              extraction_model_override, extraction_provider_override
       FROM entities WHERE id = ANY($1)`,
      [[source.id, other.id]]
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId[source.id]).toMatchObject({
      extraction_status: 'pending',
      extraction_model_override: 'claude-sonnet-4-6',
      extraction_provider_override: 'anthropic'
    });
    // Other entity untouched: still completed, no override.
    expect(byId[other.id]).toMatchObject({
      extraction_status: 'completed',
      extraction_model_override: null,
      extraction_provider_override: null
    });

    const auditRows = await database.pool.query<{
      operation: string;
      details: { markedCount: number; model: string };
    }>(
      "SELECT operation, details FROM audit_log WHERE operation = 'improve-graph.queue' ORDER BY timestamp DESC LIMIT 1"
    );
    expect(auditRows.rows[0]?.operation).toBe('improve-graph.queue');
    expect(auditRows.rows[0]?.details.model).toBe('claude-sonnet-4-6');
  }, 120_000);

  it('improve-graph without --model leaves override columns null (worker uses env default)', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `improve-noopt-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    const source = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'entity to be improved with default model'
    }))._unsafeUnwrap();
    await database.pool.query(
      "UPDATE entities SET extraction_status = 'completed' WHERE id = $1",
      [source.id]
    );

    await runAdmin(
      ['improve-graph', '--id', source.id, '--json'],
      { DATABASE_URL: databaseUrl }
    );

    const row = await database.pool.query<{
      extraction_status: string | null;
      extraction_model_override: string | null;
      extraction_provider_override: string | null;
    }>(
      `SELECT extraction_status, extraction_model_override, extraction_provider_override
       FROM entities WHERE id = $1`,
      [source.id]
    );
    expect(row.rows[0]).toMatchObject({
      extraction_status: 'pending',
      extraction_model_override: null,
      extraction_provider_override: null
    });
  }, 120_000);

  it('improve-graph --clean-edges deletes prior llm-extraction edges for queued rows', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `improve-clean-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    const source = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'source for improve-graph clean-edges test'
    }))._unsafeUnwrap();
    const target = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'person',
      content: 'Alice'
    }))._unsafeUnwrap();
    await database.pool.query(
      `INSERT INTO edges (source_id, target_id, relation, confidence, source)
       VALUES ($1, $2, 'mentioned_in', 0.9, 'llm-extraction')`,
      [source.id, target.id]
    );

    const result = await runAdmin(
      ['improve-graph', '--id', source.id, '--clean-edges', '--json'],
      { DATABASE_URL: databaseUrl }
    );
    const body = parseJson(result.stdout) as {
      markedCount: number;
      deletedEdges: number;
    };
    expect(body.markedCount).toBe(1);
    expect(body.deletedEdges).toBe(1);

    const remaining = await database.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM edges WHERE source_id = $1`,
      [source.id]
    );
    expect(Number(remaining.rows[0]!.count)).toBe(0);
  }, 120_000);

  it('improve-graph rejects --provider values outside the allowed list', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    let stdout = '';
    try {
      await runAdmin(
        ['improve-graph', '--all', '--provider', 'mistral', '--json'],
        { DATABASE_URL: databaseUrl }
      );
      throw new Error('expected non-zero exit');
    } catch (err) {
      stdout = (err as { stdout?: string }).stdout ?? '';
    }
    expect(stdout).toMatch(/--provider must be one of/);
  }, 120_000);

  it('reembed --only-failed re-queues only failed entities', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `reembed-failed-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    const failed = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'entity that failed enrichment'
    }))._unsafeUnwrap();
    const completed = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory',
      content: 'entity that succeeded enrichment'
    }))._unsafeUnwrap();

    await database.pool.query(
      `UPDATE entities
       SET enrichment_status = 'failed',
           enrichment_attempts = 3
       WHERE id = $1`,
      [failed.id]
    );
    await database.pool.query(
      `UPDATE entities
       SET enrichment_status = 'completed',
           enrichment_attempts = 1
       WHERE id = $1`,
      [completed.id]
    );

    const result = await runAdmin(
      ['reembed', '--only-failed', '--json'],
      { DATABASE_URL: databaseUrl }
    );
    const body = parseJson(result.stdout) as { markedCount: number };
    expect(body.markedCount).toBe(1);

    const rows = await database.pool.query<{
      id: string;
      enrichment_status: string | null;
      enrichment_attempts: number;
    }>(
      'SELECT id, enrichment_status, enrichment_attempts FROM entities WHERE id = ANY($1)',
      [[failed.id, completed.id]]
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId[failed.id]?.enrichment_status).toBe('pending');
    expect(byId[failed.id]?.enrichment_attempts).toBe(0);
    expect(byId[completed.id]?.enrichment_status).toBe('completed');
    expect(byId[completed.id]?.enrichment_attempts).toBe(1);

    const auditRows = await database.pool.query<{ details: { onlyFailed: boolean } }>(
      "SELECT details FROM audit_log WHERE operation = 'reembed.start' ORDER BY timestamp DESC LIMIT 1"
    );
    expect(auditRows.rows[0]?.details.onlyFailed).toBe(true);
  }, 120_000);

  it('prune-edges deletes edges below threshold and supports --dry-run', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const databaseUrl = getDatabaseUrl(database);

    const seededKey = (await createKey(database.pool, {
      name: `prune-${crypto.randomUUID()}`,
      scopes: ['read', 'write', 'delete']
    }))._unsafeUnwrap();

    const src = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'memory', content: 'source'
    }))._unsafeUnwrap();
    const tgt = (await storeEntity(database.pool, makeAuthContext(seededKey.record.id), {
      type: 'project', content: 'target'
    }))._unsafeUnwrap();

    await database.pool.query(
      `INSERT INTO edges (source_id, target_id, relation, source, confidence)
       VALUES ($1, $2, 'involves',  'llm-extraction', 0.2),
              ($1, $2, 'part_of',   'llm-extraction', 0.5),
              ($1, $2, 'related_to', 'manual',         0.1)`,
      [src.id, tgt.id]
    );

    const dryRun = await runAdmin(
      ['prune-edges', '--below', '0.4', '--json', '--dry-run'],
      { DATABASE_URL: databaseUrl }
    );
    const dryBody = parseJson(dryRun.stdout) as { wouldDelete: number };
    expect(dryBody.wouldDelete).toBe(1);

    const countBefore = await database.pool.query<{ count: string }>(
      'SELECT count(*)::text FROM edges'
    );
    expect(Number(countBefore.rows[0]?.count)).toBe(3);

    const actual = await runAdmin(
      ['prune-edges', '--below', '0.4', '--json'],
      { DATABASE_URL: databaseUrl }
    );
    const actualBody = parseJson(actual.stdout) as { deleted: number };
    expect(actualBody.deleted).toBe(1);

    const remaining = await database.pool.query<{ relation: string; source: string }>(
      'SELECT relation, source FROM edges ORDER BY relation'
    );
    expect(remaining.rows).toEqual([
      { relation: 'part_of', source: 'llm-extraction' },
      { relation: 'related_to', source: 'manual' }
    ]);
  }, 120_000);
});
