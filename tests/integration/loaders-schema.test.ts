import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

type ColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

describe('document loaders schema', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await resetTestDatabase(database.pool);
  });

  async function insertEntity(): Promise<string> {
    const result = await database.pool.query<{ id: string }>(
      `INSERT INTO entities (type, content) VALUES ('document', 'body')
       RETURNING id`
    );
    return result.rows[0]!.id;
  }

  async function insertAttachment(
    entityId: string,
    overrides: { role?: string; ref?: string; kind?: string } = {}
  ): Promise<void> {
    await database.pool.query(
      `INSERT INTO attachments
         (entity_id, role, ref, kind, mime_type, byte_size, sha256, storage_uri)
       VALUES ($1, $2, $3, $4, 'application/pdf', 10, 'abc', 'file:///x')`,
      [
        entityId,
        overrides.role ?? 'original',
        overrides.ref ?? 'original',
        overrides.kind ?? 'document'
      ]
    );
  }

  it('adds the loading columns to entities', async () => {
    const result = await database.pool.query<ColumnRow>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'entities'
          AND column_name IN ('mime_type', 'loading_status', 'loading_error',
                              'loading_attempts', 'loader_name')`
    );
    const columns = new Map(result.rows.map((row) => [row.column_name, row]));

    expect(columns.size).toBe(5);
    for (const name of [
      'mime_type',
      'loading_status',
      'loading_error',
      'loader_name'
    ]) {
      expect(columns.get(name)?.data_type).toBe('text');
      expect(columns.get(name)?.is_nullable).toBe('YES');
      expect(columns.get(name)?.column_default).toBeNull();
    }
    expect(columns.get('loading_attempts')?.data_type).toBe('integer');
    expect(columns.get('loading_attempts')?.is_nullable).toBe('NO');
    expect(columns.get('loading_attempts')?.column_default).toBe('0');
  });

  it('leaves loading_status NULL for ordinary inserts', async () => {
    const id = await insertEntity();
    const result = await database.pool.query<{
      loading_status: string | null;
      loading_attempts: number;
    }>('SELECT loading_status, loading_attempts FROM entities WHERE id = $1', [
      id
    ]);

    expect(result.rows[0]?.loading_status).toBeNull();
    expect(result.rows[0]?.loading_attempts).toBe(0);
  });

  it('creates the loading and attachment indexes', async () => {
    const result = await database.pool.query<{ indexname: string }>(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN ('idx_entities_loading_status',
                            'idx_attachments_entity_id',
                            'idx_attachments_sha256')`
    );

    expect(result.rows.map((row) => row.indexname).sort()).toEqual([
      'idx_attachments_entity_id',
      'idx_attachments_sha256',
      'idx_entities_loading_status'
    ]);
  });

  it('accepts every valid loading_status and rejects others', async () => {
    const id = await insertEntity();
    for (const status of ['pending', 'running', 'completed', 'failed']) {
      await database.pool.query(
        'UPDATE entities SET loading_status = $2 WHERE id = $1',
        [id, status]
      );
    }
    await expect(
      database.pool.query(
        `UPDATE entities SET loading_status = 'bogus' WHERE id = $1`,
        [id]
      )
    ).rejects.toThrow(/check constraint/);
  });

  it('rejects an unknown attachment role', async () => {
    const id = await insertEntity();
    await expect(insertAttachment(id, { role: 'bogus' })).rejects.toThrow(
      /check constraint/
    );
  });

  it('rejects an unknown attachment kind', async () => {
    const id = await insertEntity();
    await expect(insertAttachment(id, { kind: 'bogus' })).rejects.toThrow(
      /check constraint/
    );
  });

  it('rejects a negative byte_size', async () => {
    const id = await insertEntity();
    await expect(
      database.pool.query(
        `INSERT INTO attachments
           (entity_id, role, ref, kind, mime_type, byte_size, sha256, storage_uri)
         VALUES ($1, 'derived', 'a', 'image', 'image/png', -1, 'abc', 'x')`,
        [id]
      )
    ).rejects.toThrow(/check constraint/);
  });

  it('enforces UNIQUE (entity_id, ref)', async () => {
    const id = await insertEntity();
    await insertAttachment(id, { role: 'derived', ref: 'page-1.png' });
    await expect(
      insertAttachment(id, { role: 'derived', ref: 'page-1.png' })
    ).rejects.toThrow(/unique/);

    const other = await insertEntity();
    await insertAttachment(other, { role: 'derived', ref: 'page-1.png' });
  });

  it('allows one original attachment per entity and many derived', async () => {
    const id = await insertEntity();
    await insertAttachment(id, { role: 'original', ref: 'original' });
    await expect(
      insertAttachment(id, { role: 'original', ref: 'original-2' })
    ).rejects.toThrow(/idx_attachments_one_original/);

    await insertAttachment(id, { role: 'derived', ref: 'd1' });
    await insertAttachment(id, { role: 'derived', ref: 'd2' });
    await insertAttachment(id, { role: 'derived', ref: 'd3' });

    const count = await database.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM attachments WHERE entity_id = $1',
      [id]
    );
    expect(count.rows[0]?.n).toBe('4');
  });

  it('deletes attachments when the entity is deleted', async () => {
    const id = await insertEntity();
    await insertAttachment(id, { role: 'original', ref: 'original' });
    await insertAttachment(id, { role: 'derived', ref: 'd1' });

    await database.pool.query('DELETE FROM entities WHERE id = $1', [id]);

    const count = await database.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM attachments'
    );
    expect(count.rows[0]?.n).toBe('0');
  });
});
