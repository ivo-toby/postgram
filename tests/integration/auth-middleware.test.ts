import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Hono } from 'hono';

import { createAuthMiddleware } from '../../src/auth/middleware.js';
import { createKey, revokeKey } from '../../src/auth/key-service.js';
import type { AuthContext } from '../../src/auth/types.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

describe('auth middleware', () => {
  let database: TestDatabase | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, 120_000);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  });

  it('rejects requests without a bearer token', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = new Hono<{ Variables: { auth: AuthContext } }>();
    app.use('/api/*', createAuthMiddleware({ pool: database.pool }));
    app.get('/api/protected', (c) => c.json({ ok: true }));

    const response = await app.request('/api/protected');
    const body: unknown = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: 'Missing Bearer token',
        details: {}
      }
    });
  });

  it('attaches auth context and touches last_used_at for valid keys', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const created = (await createKey(database.pool, {
      name: 'middleware-alpha',
      scopes: ['read']
    }))._unsafeUnwrap();

    const app = new Hono<{ Variables: { auth: AuthContext } }>();
    app.use('/api/*', createAuthMiddleware({ pool: database.pool }));
    app.get('/api/protected', (c) => {
      const auth = c.get('auth');
      return c.json({
        apiKeyId: auth.apiKeyId,
        keyName: auth.keyName
      });
    });

    const response = await app.request('/api/protected', {
      headers: {
        Authorization: `Bearer ${created.plaintextKey}`
      }
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      apiKeyId: created.record.id,
      keyName: 'middleware-alpha'
    });

    const refreshed = await database.pool.query<{
      last_used_at: Date | null;
    }>(
      'SELECT last_used_at FROM api_keys WHERE id = $1',
      [created.record.id]
    );

    expect(refreshed.rows[0]?.last_used_at).toBeInstanceOf(Date);
  }, 120_000);

  it('rejects revoked keys', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const created = (await createKey(database.pool, {
      name: 'middleware-beta',
      scopes: ['read']
    }))._unsafeUnwrap();
    await revokeKey(database.pool, created.record.id);

    const app = new Hono<{ Variables: { auth: AuthContext } }>();
    app.use('/api/*', createAuthMiddleware({ pool: database.pool }));
    app.get('/api/protected', (c) => c.json({ ok: true }));

    const response = await app.request('/api/protected', {
      headers: {
        Authorization: `Bearer ${created.plaintextKey}`
      }
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid API key',
        details: {}
      }
    });
  }, 120_000);
});
