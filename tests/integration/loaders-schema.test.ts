import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase,
} from '../helpers/postgres.js';

/**
 * Verifies migration 008 lands the new columns/table for the pluggable
 * loaders feature. Uses the same testcontainers-driven Postgres as the rest
 * of the integration suite so the assertions exercise the real schema.
 */
describe('migration 008 — pluggable loaders', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) await database.close();
  });

  it('adds mime_type, source_uri, loading_status columns to entities', async () => {
    if (!database) throw new Error('db missing');
    await resetTestDatabase(database.pool);

    const { rows } = await database.pool.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'entities'
          AND column_name IN
            ('mime_type', 'source_uri', 'loading_status', 'loading_error',
             'loading_attempts', 'loader_name')
      `,
    );
    const names = new Set(rows.map((r) => r.column_name));
    expect(names).toContain('mime_type');
    expect(names).toContain('source_uri');
    expect(names).toContain('loading_status');
    expect(names).toContain('loading_error');
    expect(names).toContain('loading_attempts');
    expect(names).toContain('loader_name');
  });

  it('adds block_kind, block_metadata to chunks with defaults', async () => {
    if (!database) throw new Error('db missing');

    const { rows } = await database.pool.query<{
      column_name: string;
      column_default: string | null;
    }>(
      `
        SELECT column_name, column_default
        FROM information_schema.columns
        WHERE table_name = 'chunks'
          AND column_name IN ('block_kind', 'block_metadata')
      `,
    );
    expect(rows).toHaveLength(2);
    const byName = new Map(rows.map((r) => [r.column_name, r.column_default]));
    expect(byName.get('block_kind')).toMatch(/text/);
    expect(byName.get('block_metadata')).toMatch(/jsonb|'{}'/);
  });

  it('creates the attachments table with expected columns', async () => {
    if (!database) throw new Error('db missing');

    const { rows } = await database.pool.query<{ column_name: string }>(
      `
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'attachments'
      `,
    );
    const names = new Set(rows.map((r) => r.column_name));
    for (const required of [
      'id',
      'entity_id',
      'ref',
      'kind',
      'mime_type',
      'byte_size',
      'sha256',
      'storage_uri',
      'metadata',
      'created_at',
    ]) {
      expect(names).toContain(required);
    }
  });

  it('enforces unique source_uri only when non-null', async () => {
    if (!database) throw new Error('db missing');
    await resetTestDatabase(database.pool);

    await database.pool.query(`
      INSERT INTO entities (type, content, source_uri)
      VALUES ('document', 'a', 'https://example.com/x')
    `);
    await expect(
      database.pool.query(`
        INSERT INTO entities (type, content, source_uri)
        VALUES ('document', 'b', 'https://example.com/x')
      `),
    ).rejects.toThrow(/duplicate key value/);

    // Two NULL source_uri rows are allowed.
    await database.pool.query(`
      INSERT INTO entities (type, content) VALUES ('memory', 'one')
    `);
    await database.pool.query(`
      INSERT INTO entities (type, content) VALUES ('memory', 'two')
    `);
  });

  it('rejects unknown attachment kind via CHECK constraint', async () => {
    if (!database) throw new Error('db missing');
    await resetTestDatabase(database.pool);

    const { rows: [entity] } = await database.pool.query<{ id: string }>(`
      INSERT INTO entities (type, content) VALUES ('document', 'x')
      RETURNING id
    `);
    if (!entity) throw new Error('entity insert failed');

    await expect(
      database.pool.query(
        `
          INSERT INTO attachments
            (entity_id, ref, kind, mime_type, byte_size, sha256, storage_uri)
          VALUES ($1, 'r', 'something-bogus', 'image/png', 0, 'aa', '/x')
        `,
        [entity.id],
      ),
    ).rejects.toThrow(/check constraint|attachments_kind_check/);
  });

  it('rejects loading_status outside the allowed set', async () => {
    if (!database) throw new Error('db missing');
    await resetTestDatabase(database.pool);

    await expect(
      database.pool.query(`
        INSERT INTO entities (type, content, loading_status)
        VALUES ('document', 'x', 'bogus')
      `),
    ).rejects.toThrow(/check constraint|loading_status/);
  });
});
