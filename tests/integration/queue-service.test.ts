import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getQueueStatus } from '../../src/services/queue-service.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

describe('queue-service', () => {
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

  it('returns aggregate counts without failures by default', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await database.pool.query(
      `INSERT INTO entities (type, content, enrichment_status, extraction_status, extraction_error, metadata)
       VALUES
         ('document', 'ok doc',  'completed', 'completed', NULL,           '{}'::jsonb),
         ('document', 'bad doc', 'completed', 'failed',    'llm exploded', '{"path":"bad.md"}'::jsonb)`
    );

    const status = await getQueueStatus(database.pool);
    expect(status.extraction).toEqual({ pending: 0, completed: 1, failed: 1 });
    expect(status.failures).toBeUndefined();
  }, 120_000);

  it('includes failure messages and paths when requested', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await database.pool.query(
      `INSERT INTO entities (type, content, enrichment_status, enrichment_error, metadata)
       VALUES ('memory', 'broken embed', 'failed', 'embedding API 500', '{}'::jsonb)`
    );
    await database.pool.query(
      `INSERT INTO entities (type, content, enrichment_status, extraction_status, extraction_error, metadata)
       VALUES ('document', 'broken extract', 'completed', 'failed', 'llm context exceeded', '{"path":"bad.md"}'::jsonb)`
    );

    const status = await getQueueStatus(database.pool, { includeFailures: true });
    expect(status.failures).toBeDefined();
    expect(status.failures).toHaveLength(2);

    const byKind = Object.fromEntries(
      (status.failures ?? []).map((f) => [f.kind, f])
    );
    expect(byKind['enrichment']).toMatchObject({
      kind: 'enrichment',
      error: 'embedding API 500',
      path: null
    });
    expect(byKind['extraction']).toMatchObject({
      kind: 'extraction',
      error: 'llm context exceeded',
      path: 'bad.md'
    });
  }, 120_000);
});
