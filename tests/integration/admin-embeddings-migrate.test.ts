import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  MigrateRefusal,
  assertEmbeddingDimensionAgreement,
  runMigrate
} from '../../src/services/embeddings/admin.js';
import { storeEntity } from '../../src/services/entity-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import type { EmbeddingProviderConfig } from '../../src/services/embeddings/providers.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuth(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000103',
    keyName: 'worker-key',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

function targetOllamaConfig(dimensions: number): EmbeddingProviderConfig {
  return {
    provider: 'ollama',
    model: 'bge-m3',
    dimensions,
    baseUrl: 'http://stub.local'
  };
}

async function seedChunks(database: TestDatabase, count: number): Promise<void> {
  await seedApiKey(database.pool, {
    id: '00000000-0000-0000-0000-000000000103',
    name: 'worker-key'
  });

  const activeModel = await database.pool.query<{ id: string }>(
    `SELECT id FROM embedding_models WHERE is_active = true LIMIT 1`
  );
  const modelId = activeModel.rows[0]?.id;
  if (!modelId) {
    throw new Error('no active model');
  }

  for (let i = 0; i < count; i += 1) {
    const entity = (
      await storeEntity(database.pool, makeAuth(), {
        type: 'memory',
        content: `seed entity ${i}`
      })
    )._unsafeUnwrap();

    const zero = `[${new Array(1536).fill(0).join(',')}]`;
    await database.pool.query(
      `
        INSERT INTO chunks (entity_id, chunk_index, content, embedding, model_id, token_count)
        VALUES ($1, 0, $2, $3::vector, $4, 1)
      `,
      [entity.id, `seed ${i}`, zero, modelId]
    );
  }
}

describe('pgm-admin embeddings migrate', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) throw new Error('db not ready');
    await resetTestDatabase(database.pool);
    // Each test starts with a fresh vector(1536) column. Migration tests in
    // this suite may leave it at other dimensions, so reset here explicitly.
    await database.pool.query(
      `ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(1536)`
    );
  });

  afterAll(async () => {
    if (database) await database.close();
  });

  it('dry-run reports counts, performs no schema changes, but writes an audit row', async () => {
    if (!database) throw new Error('db not ready');
    await seedChunks(database, 3);

    const report = await runMigrate({
      pool: database.pool,
      providerConfig: targetOllamaConfig(1024),
      targetDimensions: 1024,
      dryRun: true,
      yes: false
    });

    expect(report.dryRun).toBe(true);
    expect(report.effects.chunksDiscarded).toBe(3);
    expect(report.effects.entitiesMarkedPending).toBe(3);
    expect(report.newModelId).toBeNull();

    const chunkCount = await database.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM chunks'
    );
    expect(Number(chunkCount.rows[0]?.count ?? '0')).toBe(3);

    const activeModel = await database.pool.query<{ dimensions: number }>(
      'SELECT dimensions FROM embedding_models WHERE is_active = true'
    );
    expect(activeModel.rows[0]?.dimensions).toBe(1536);

    const audit = await database.pool.query<{ details: { dry_run: boolean } }>(
      `SELECT details FROM audit_log WHERE operation = 'embeddings.migrate' ORDER BY timestamp DESC LIMIT 1`
    );
    expect(audit.rows[0]?.details?.dry_run).toBe(true);
  }, 120_000);

  it('refuses without --yes outside dry-run (exit code 64)', async () => {
    if (!database) throw new Error('db not ready');
    await seedChunks(database, 1);

    await expect(
      runMigrate({
        pool: database.pool,
        providerConfig: targetOllamaConfig(1024),
        targetDimensions: 1024,
        dryRun: false,
        yes: false
      })
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof MigrateRefusal && error.exitCode === 64;
    });
  }, 120_000);

  it('refuses when config dimensions disagree with target (exit code 65)', async () => {
    if (!database) throw new Error('db not ready');
    await seedChunks(database, 1);

    await expect(
      runMigrate({
        pool: database.pool,
        providerConfig: targetOllamaConfig(1024),
        targetDimensions: 768,
        dryRun: false,
        yes: true
      })
    ).rejects.toSatisfy((error: unknown) => {
      return error instanceof MigrateRefusal && error.exitCode === 65;
    });
  }, 120_000);

  it('performs the migration end-to-end under --yes', async () => {
    if (!database) throw new Error('db not ready');
    await seedChunks(database, 2);

    const report = await runMigrate({
      pool: database.pool,
      providerConfig: targetOllamaConfig(1024),
      targetDimensions: 1024,
      dryRun: false,
      yes: true
    });

    expect(report.dryRun).toBe(false);
    expect(report.effects.chunksDiscarded).toBe(2);
    expect(report.effects.entitiesMarkedPending).toBe(2);
    expect(report.newModelId).not.toBeNull();

    const chunkCount = await database.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM chunks'
    );
    expect(Number(chunkCount.rows[0]?.count ?? '0')).toBe(0);

    const activeModel = await database.pool.query<{ provider: string; name: string; dimensions: number }>(
      'SELECT provider, name, dimensions FROM embedding_models WHERE is_active = true'
    );
    expect(activeModel.rows[0]).toEqual({
      provider: 'ollama',
      name: 'bge-m3',
      dimensions: 1024
    });

    const entities = await database.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM entities WHERE content IS NOT NULL AND enrichment_status = 'pending'`
    );
    expect(Number(entities.rows[0]?.count ?? '0')).toBe(2);

    const colTypmod = await database.pool.query<{ atttypmod: number }>(
      `
        SELECT a.atttypmod
        FROM pg_attribute a
        JOIN pg_class c ON a.attrelid = c.oid
        WHERE c.relname = 'chunks' AND a.attname = 'embedding'
      `
    );
    expect(colTypmod.rows[0]?.atttypmod).toBe(1024);

    const mismatch = await assertEmbeddingDimensionAgreement(database.pool, {
      provider: 'ollama',
      model: 'bge-m3',
      dimensions: 1024
    });
    expect(mismatch).toBeNull();

    const startupMismatch = await assertEmbeddingDimensionAgreement(database.pool, {
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536
    });
    expect(startupMismatch).not.toBeNull();
    expect(startupMismatch?.message).toContain('pgm-admin embeddings migrate');

    const audit = await database.pool.query<{ operation: string; details: { dry_run: boolean; new_model_id: string } }>(
      `SELECT operation, details FROM audit_log WHERE operation = 'embeddings.migrate' ORDER BY timestamp DESC LIMIT 1`
    );
    expect(audit.rows[0]?.details?.dry_run).toBe(false);
    expect(audit.rows[0]?.details?.new_model_id).toBeTruthy();
  }, 180_000);

  it('is a true no-op on re-run with the same target — preserves regenerated chunks and does not re-mark entities', async () => {
    if (!database) throw new Error('db not ready');

    const first = await runMigrate({
      pool: database.pool,
      providerConfig: targetOllamaConfig(1024),
      targetDimensions: 1024,
      dryRun: false,
      yes: true
    });
    expect(first.target.dimensions).toBe(1024);
    const firstModelId = first.newModelId;

    // Simulate a downstream enrichment catch-up: seed a regenerated chunk
    // at the new dimension, mark an entity completed.
    await seedApiKey(database.pool, {
      id: '00000000-0000-0000-0000-000000000103',
      name: 'worker-key'
    });
    const entity = (
      await storeEntity(database.pool, makeAuth(), {
        type: 'memory',
        content: 'post-migration regenerated entity'
      })
    )._unsafeUnwrap();
    const zero = `[${new Array(1024).fill(0).join(',')}]`;
    await database.pool.query(
      `
        INSERT INTO chunks (entity_id, chunk_index, content, embedding, model_id, token_count)
        VALUES ($1, 0, $2, $3::vector, $4, 1)
      `,
      [entity.id, 'chunk after migrate', zero, firstModelId]
    );
    await database.pool.query(
      `UPDATE entities SET enrichment_status = 'completed', enrichment_attempts = 0 WHERE id = $1`,
      [entity.id]
    );

    const second = await runMigrate({
      pool: database.pool,
      providerConfig: targetOllamaConfig(1024),
      targetDimensions: 1024,
      dryRun: false,
      yes: true
    });

    expect(second.effects.chunksDiscarded).toBe(0);
    expect(second.effects.entitiesMarkedPending).toBe(0);
    expect(second.newModelId).toBe(firstModelId);

    // Regenerated chunk must still be present.
    const chunkCount = await database.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM chunks WHERE entity_id = $1',
      [entity.id]
    );
    expect(Number(chunkCount.rows[0]?.count ?? '0')).toBe(1);

    // Entity stays in 'completed' — no re-pending.
    const entityRow = await database.pool.query<{ enrichment_status: string }>(
      'SELECT enrichment_status FROM entities WHERE id = $1',
      [entity.id]
    );
    expect(entityRow.rows[0]?.enrichment_status).toBe('completed');

    // Still exactly one active bge-m3 row.
    const modelRows = await database.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM embedding_models WHERE provider = 'ollama' AND name = 'bge-m3' AND dimensions = 1024`
    );
    expect(Number(modelRows.rows[0]?.count ?? '0')).toBe(1);

    // Audit row flags the no-op.
    const audit = await database.pool.query<{ details: { idempotent_no_op?: boolean } }>(
      `SELECT details FROM audit_log WHERE operation = 'embeddings.migrate' ORDER BY timestamp DESC LIMIT 1`
    );
    expect(audit.rows[0]?.details?.idempotent_no_op).toBe(true);
  }, 180_000);

  it('detects same-dimension provider/model switch as a mismatch', async () => {
    if (!database) throw new Error('db not ready');

    // Seed: OpenAI text-embedding-3-small at 1536 dims (default from test helper).
    // Caller: configures a hypothetical different provider/model at the SAME 1536 dims.
    const mismatch = await assertEmbeddingDimensionAgreement(database.pool, {
      provider: 'ollama',
      model: 'nomic-embed-text',
      dimensions: 1536
    });

    expect(mismatch).not.toBeNull();
    expect(mismatch?.details.activeModel?.dimensions).toBe(1536);
    expect(mismatch?.message).toContain('identity mismatch');
    expect(mismatch?.message).toContain('pgm-admin embeddings migrate');
  }, 60_000);

  it('writes an audit row inside the migration transaction', async () => {
    if (!database) throw new Error('db not ready');

    const beforeCount = await database.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_log WHERE operation = 'embeddings.migrate'`
    );

    await runMigrate({
      pool: database.pool,
      providerConfig: targetOllamaConfig(1024),
      targetDimensions: 1024,
      dryRun: false,
      yes: true
    });

    const afterCount = await database.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_log WHERE operation = 'embeddings.migrate'`
    );

    expect(Number(afterCount.rows[0]?.count ?? '0')).toBe(
      Number(beforeCount.rows[0]?.count ?? '0') + 1
    );
  }, 180_000);
});
