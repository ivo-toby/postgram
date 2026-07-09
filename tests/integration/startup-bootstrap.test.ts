import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureFirstRunBootstrapToken } from '../../src/auth/admin-service.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const startupMocks = vi.hoisted(() => ({
  pool: undefined as Pool | undefined
}));

vi.mock('../../src/db/pool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/pool.js')>();
  return {
    ...actual,
    createPool: () => {
      if (!startupMocks.pool) {
        throw new Error('startup test pool is not initialized');
      }
      return startupMocks.pool;
    }
  };
});

import { startServer } from '../../src/index.js';

const ORIGINAL_ENV = { ...process.env };

function restoreEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

describe('server startup bootstrap token', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  beforeEach(async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }
    await resetTestDatabase(database.pool);
    startupMocks.pool = database.pool;
    restoreEnvironment();
  });

  afterAll(async () => {
    restoreEnvironment();
    startupMocks.pool = undefined;
    await database?.close();
  });

  it('does not persist an unrecoverable bootstrap token when startup validation fails', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://startup-test/postgram',
      EMBEDDING_PROVIDER: 'openai',
      LOG_LEVEL: 'fatal'
    });
    delete process.env.OPENAI_API_KEY;

    await expect(startServer()).rejects.toThrow(
      'OPENAI_API_KEY is required for EMBEDDING_PROVIDER=openai'
    );

    const persisted = await database.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM admin_bootstrap_tokens'
    );
    expect(persisted.rows[0]?.count).toBe('0');

    const nextStartupToken = await ensureFirstRunBootstrapToken(database.pool, {
      ttlMs: 60_000
    });
    expect(nextStartupToken._unsafeUnwrap().status).toBe('created');
  }, 120_000);
});
