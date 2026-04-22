import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getQueueStatus } from '../../src/services/queue-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

function unrestrictedAuth(): AuthContext {
  return {
    apiKeyId: '00000000-0000-0000-0000-000000000601',
    keyName: 'queue-unrestricted',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal', 'work', 'shared']
  };
}

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

    const status = await getQueueStatus(database.pool, unrestrictedAuth());
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

    const status = await getQueueStatus(database.pool, unrestrictedAuth(), {
      includeFailures: true
    });
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

  it('restricts counts and failures to the caller\'s allowed types and visibility', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    // Three failures across mixed types and visibilities.
    await database.pool.query(
      `INSERT INTO entities (type, content, visibility, enrichment_status, extraction_status, extraction_error, metadata)
       VALUES
         ('document', 'doc-shared',   'shared',   'completed', 'failed', 'doc shared error',   '{"path":"a.md"}'::jsonb),
         ('memory',   'mem-shared',   'shared',   'completed', 'failed', 'mem shared error',   '{}'::jsonb),
         ('document', 'doc-personal', 'personal', 'completed', 'failed', 'doc personal error', '{"path":"p.md"}'::jsonb)`
    );

    const restricted: AuthContext = {
      apiKeyId: '00000000-0000-0000-0000-000000000602',
      keyName: 'queue-restricted',
      scopes: ['read'],
      allowedTypes: ['document'],        // memory excluded
      allowedVisibility: ['shared']      // personal excluded
    };

    const status = await getQueueStatus(database.pool, restricted, {
      includeFailures: true
    });

    // Only the shared document failure is visible → 1 each in counts + failures.
    expect(status.extraction).toEqual({ pending: 0, completed: 0, failed: 1 });
    expect(status.failures).toHaveLength(1);
    expect(status.failures?.[0]).toMatchObject({
      type: 'document',
      error: 'doc shared error',
      path: 'a.md'
    });
  }, 120_000);
});
