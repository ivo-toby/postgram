import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { storeEntity } from '../../src/services/entity-service.js';
import {
  groomSessionContext,
  previewSessionContextGrooming
} from '../../src/services/memory-grooming-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import {
  createTestDatabase,
  resetTestDatabase,
  seedApiKey,
  type TestDatabase
} from '../helpers/postgres.js';

function makeAuthContext(): AuthContext {
  return {
    apiKeyId: null,
    keyName: 'groom-key',
    clientId: 'codex',
    scopes: ['read', 'write', 'delete'],
    allowedTypes: null,
    allowedVisibility: ['personal']
  };
}

describe('memory-grooming-service', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    await resetTestDatabase(database.pool);
    await seedApiKey(database.pool, {
      id: '00000000-0000-0000-0000-000000000701',
      name: 'groom-key',
      clientId: 'codex',
      scopes: ['read', 'write', 'delete'],
      allowedVisibility: ['personal']
    });
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('previews eligible session-context memories without mutating them', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'Session context: decision was made to skip graph extraction.',
      visibility: 'personal',
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'codex' },
        groom_after: '2026-01-01T00:00:00.000Z'
      }
    }))._unsafeUnwrap();

    const preview = await previewSessionContextGrooming(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      limit: 10
    });

    expect(preview.isOk()).toBe(true);
    expect(preview._unsafeUnwrap().eligible.map((entry) => entry.id)).toEqual([stored.id]);

    const row = await database.pool.query<{ status: string | null }>(
      'SELECT status FROM entities WHERE id = $1',
      [stored.id]
    );
    expect(row.rows[0]?.status).toBeNull();
  });

  it('requires confirmation before archiving outside dry-run', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const result = await groomSessionContext(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      mode: 'archive',
      dryRun: false,
      confirm: false,
      limit: 10
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('VALIDATION');
  });

  it('archives stale session context without deleting it', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const stored = (await storeEntity(database.pool, makeAuthContext(), {
      type: 'memory',
      content: 'Session context that should be archived.',
      visibility: 'personal',
      metadata: {
        memory_role: 'session_context',
        session_scope: { kind: 'client', client_id: 'codex' },
        groom_after: '2026-01-01T00:00:00.000Z'
      }
    }))._unsafeUnwrap();

    const result = await groomSessionContext(database.pool, {
      clientId: 'codex',
      now: new Date('2026-05-31T00:00:00.000Z'),
      mode: 'archive',
      dryRun: false,
      confirm: true,
      limit: 10
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ archived: 1, dryRun: false });

    const row = await database.pool.query<{ status: string | null }>(
      'SELECT status FROM entities WHERE id = $1',
      [stored.id]
    );
    expect(row.rows[0]?.status).toBe('archived');
  });
});
