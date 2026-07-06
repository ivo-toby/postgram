import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBootstrapToken } from '../../src/auth/admin-service.js';
import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  authorizeAndExchangeOAuthToken,
  OAUTH_PUBLIC_BASE_URL,
  registerOAuthClient
} from '../helpers/oauth.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!';
const ADMIN_MFA_SECRET_KEY = 'test-admin-mfa-secret-key-32-bytes-minimum';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function getSetCookie(response: Response, name: string): string {
  const setCookie =
    response.headers.get('Set-Cookie') ?? response.headers.get('set-cookie');

  if (!setCookie || !setCookie.startsWith(`${name}=`)) {
    throw new Error(`Missing ${name} Set-Cookie header`);
  }

  return setCookie;
}

function cookieHeaderFromSetCookie(setCookie: string): string {
  return setCookie.split(';')[0] ?? setCookie;
}

function decodeBase32(value: string): Buffer {
  let bits = '';
  const bytes: number[] = [];

  for (const character of value.replace(/=+$/u, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${character}`);
    }
    bits += index.toString(2).padStart(5, '0');
  }

  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }

  return Buffer.from(bytes);
}

function totpCode(secret: string, now = new Date()): string {
  const counter = Math.floor(now.getTime() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', decodeBase32(secret))
    .update(counterBuffer)
    .digest();
  const lastByte = digest[digest.length - 1];
  if (lastByte === undefined) {
    throw new Error('Unable to generate TOTP code');
  }

  const offset = lastByte & 0x0f;
  const first = digest[offset];
  const second = digest[offset + 1];
  const third = digest[offset + 2];
  const fourth = digest[offset + 3];
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  ) {
    throw new Error('Unable to generate TOTP code');
  }

  const binary =
    ((first & 0x7f) << 24) |
    ((second & 0xff) << 16) |
    ((third & 0xff) << 8) |
    (fourth & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

async function setupPendingFirstAdmin(database: TestDatabase): Promise<{
  app: ReturnType<typeof createApp>;
  cookie: string;
  csrfToken: string;
}> {
  const bootstrap = (
    await createBootstrapToken(database.pool, {
      ttlMs: 10 * 60 * 1000
    })
  )._unsafeUnwrap();
  const app = createApp({
    pool: database.pool,
    adminMfaSecretKey: ADMIN_MFA_SECRET_KEY
  });
  const setupResponse = await app.request('/admin/api/bootstrap/setup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      bootstrapToken: bootstrap.plaintextToken,
      email: 'first@example.com',
      displayName: 'First Admin',
      password: STRONG_PASSWORD
    })
  });
  const setupBody = (await setupResponse.json()) as { csrfToken: string };

  expect(setupResponse.status).toBe(201);
  return {
    app,
    cookie: cookieHeaderFromSetCookie(
      getSetCookie(setupResponse, 'pgm_admin_session')
    ),
    csrfToken: setupBody.csrfToken
  };
}

async function setupActiveFirstAdmin(database: TestDatabase): Promise<{
  app: ReturnType<typeof createApp>;
  adminUserId: string;
  cookie: string;
  csrfToken: string;
  sessionId: string;
}> {
  const setup = await setupPendingFirstAdmin(database);
  const enrollResponse = await setup.app.request(
    '/admin/api/session/mfa/enroll',
    {
      method: 'POST',
      headers: {
        Cookie: setup.cookie,
        'X-CSRF-Token': setup.csrfToken
      }
    }
  );
  const enrollBody = (await enrollResponse.json()) as {
    factor: { id: string };
    secret: string;
  };
  expect(enrollResponse.status).toBe(201);

  const verifyResponse = await setup.app.request(
    '/admin/api/session/mfa/verify',
    {
      method: 'POST',
      headers: {
        Cookie: setup.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': setup.csrfToken
      },
      body: JSON.stringify({
        factorId: enrollBody.factor.id,
        code: totpCode(enrollBody.secret)
      })
    }
  );
  const verifyBody = (await verifyResponse.json()) as {
    user: { id: string };
    session: { id: string };
  };
  expect(verifyResponse.status).toBe(200);

  return {
    app: setup.app,
    adminUserId: verifyBody.user.id,
    cookie: setup.cookie,
    csrfToken: setup.csrfToken,
    sessionId: verifyBody.session.id
  };
}

function expectPrivateNoStore(response: Response): void {
  expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  expect(response.headers.get('Pragma')).toBe('no-cache');
  expect(response.headers.get('Vary')).toBe('Cookie');
}

function expectNoKeySecretLeak(value: unknown, allowedPlaintext?: string): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('keyHash');
  expect(serialized).not.toContain('key_hash');
  expect(serialized).not.toContain('keyPrefix');
  expect(serialized).not.toContain('key_prefix');
  expect(serialized).not.toContain('hash');
  expect(serialized).not.toContain('prefix');
  if (allowedPlaintext) {
    expect(serialized).toContain(allowedPlaintext);
  } else {
    expect(serialized).not.toContain('plaintextKey');
    expect(serialized).not.toContain('pgm-');
  }
}

describe('admin key, audit, and stats API', () => {
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

  it('creates, lists, and revokes API keys with one-time plaintext and structured admin audit attribution', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await setupActiveFirstAdmin(database);

    const createResponse = await admin.app.request('/admin/api/keys', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': admin.csrfToken
      },
      body: JSON.stringify({
        name: 'admin-alpha',
        clientId: 'codex-desktop',
        scopes: ['read', 'write'],
        allowedTypes: ['memory', 'task'],
        allowedVisibility: ['shared', 'work']
      })
    });
    const createBody = (await createResponse.json()) as {
      plaintextKey: string;
      key: {
        id: string;
        name: string;
        clientId: string;
        scopes: string[];
        allowedTypes: string[];
        allowedVisibility: string[];
        isActive: boolean;
      };
    };

    expect(createResponse.status).toBe(201);
    expectPrivateNoStore(createResponse);
    expect(createBody.plaintextKey).toMatch(/^pgm-admin-alpha-/u);
    expect(createBody.key).toMatchObject({
      name: 'admin-alpha',
      clientId: 'codex-desktop',
      scopes: ['read', 'write'],
      allowedTypes: ['memory', 'task'],
      allowedVisibility: ['shared', 'work'],
      isActive: true
    });
    expectNoKeySecretLeak(createBody.key);

    const listResponse = await admin.app.request('/admin/api/keys', {
      headers: {
        Cookie: admin.cookie
      }
    });
    const listBody = (await listResponse.json()) as {
      keys: Array<{
        id: string;
        name: string;
        clientId: string;
        isActive: boolean;
      }>;
      pagination: {
        limit: number;
        offset: number;
        nextOffset: number | null;
      };
    };
    expect(listResponse.status).toBe(200);
    expect(listBody.keys).toEqual([
      expect.objectContaining({
        id: createBody.key.id,
        name: 'admin-alpha',
        clientId: 'codex-desktop',
        isActive: true
      })
    ]);
    expect(listBody.pagination).toEqual({
      limit: 50,
      offset: 0,
      nextOffset: null
    });
    expectNoKeySecretLeak(listBody);

    const revokeResponse = await admin.app.request(
      `/admin/api/keys/${createBody.key.id}/revoke`,
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({})
      }
    );
    const revokeBody = (await revokeResponse.json()) as {
      revoked: boolean;
      id: string;
    };
    expect(revokeResponse.status).toBe(200);
    expect(revokeBody).toEqual({
      revoked: true,
      id: createBody.key.id
    });

    const auditRows = await database.pool.query<{
      operation: string;
      admin_user_id: string | null;
      entity_id: string | null;
      details: Record<string, unknown>;
    }>(
      `
        SELECT operation, admin_user_id, entity_id, details
        FROM audit_log
        WHERE operation IN ('key.create', 'key.revoke')
        ORDER BY timestamp ASC
      `
    );
    expect(auditRows.rows).toHaveLength(2);
    expect(auditRows.rows).toEqual([
      expect.objectContaining({
        operation: 'key.create',
        admin_user_id: admin.adminUserId,
        entity_id: createBody.key.id
      }),
      expect.objectContaining({
        operation: 'key.revoke',
        admin_user_id: admin.adminUserId,
        entity_id: createBody.key.id
      })
    ]);
    expect(JSON.stringify(auditRows.rows)).not.toContain(
      createBody.plaintextKey
    );
    expectNoKeySecretLeak(auditRows.rows);

    const auditResponse = await admin.app.request(
      '/admin/api/audit?operation=key.create,key.revoke&limit=5',
      {
        headers: {
          Cookie: admin.cookie
        }
      }
    );
    const auditBody = (await auditResponse.json()) as {
      audit: {
        entries: Array<{
          operation: string;
          adminUserId: string | null;
          entityId: string | null;
          details: Record<string, unknown>;
        }>;
      };
    };
    expect(auditResponse.status).toBe(200);
    expect(auditBody.audit.entries.map((entry) => entry.operation)).toEqual([
      'key.revoke',
      'key.create'
    ]);
    expect(
      auditBody.audit.entries.every(
        (entry) => entry.adminUserId === admin.adminUserId
      )
    ).toBe(true);
    expectNoKeySecretLeak(auditBody);
  }, 120_000);

  it('requires CSRF and recent step-up for key create and revoke while allowing active-MFA reads', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await setupActiveFirstAdmin(database);
    await database.pool.query(
      `
        UPDATE admin_sessions
        SET mfa_verified_at = now() - interval '11 minutes'
        WHERE id = $1
      `,
      [admin.sessionId]
    );
    const directKey = (
      await createKey(database.pool, {
        name: 'stale-step-up-target'
      })
    )._unsafeUnwrap();

    const listResponse = await admin.app.request('/admin/api/keys', {
      headers: {
        Cookie: admin.cookie
      }
    });
    expect(listResponse.status).toBe(200);

    const statsResponse = await admin.app.request('/admin/api/stats', {
      headers: {
        Cookie: admin.cookie
      }
    });
    expect(statsResponse.status).toBe(200);

    const missingCsrfResponse = await admin.app.request('/admin/api/keys', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'missing-csrf' })
    });
    expect(missingCsrfResponse.status).toBe(403);

    const staleCreateResponse = await admin.app.request('/admin/api/keys', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': admin.csrfToken
      },
      body: JSON.stringify({ name: 'stale-step-up-create' })
    });
    const staleCreateBody: unknown = await staleCreateResponse.json();
    expect(staleCreateResponse.status).toBe(403);
    expect(staleCreateBody).toMatchObject({
      error: {
        code: ErrorCode.FORBIDDEN,
        message: 'Recent admin step-up is required'
      }
    });

    const staleRevokeResponse = await admin.app.request(
      `/admin/api/keys/${directKey.record.id}/revoke`,
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({})
      }
    );
    expect(staleRevokeResponse.status).toBe(403);
  }, 120_000);

  it('accepts no-body key revoke requests with a valid CSRF step-up session', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await setupActiveFirstAdmin(database);
    const directKey = (
      await createKey(database.pool, {
        name: 'no-body-revoke-target'
      })
    )._unsafeUnwrap();

    const response = await admin.app.request(
      `/admin/api/keys/${directKey.record.id}/revoke`,
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'X-CSRF-Token': admin.csrfToken
        }
      }
    );
    const body = (await response.json()) as {
      revoked: boolean;
      id: string;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      revoked: true,
      id: directKey.record.id
    });

    const revokedRows = await database.pool.query<{ is_active: boolean }>(
      'SELECT is_active FROM api_keys WHERE id = $1',
      [directKey.record.id]
    );
    expect(revokedRows.rows[0]?.is_active).toBe(false);
  }, 120_000);

  it('rolls back key create and revoke when required audit writes fail', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await setupActiveFirstAdmin(database);

    await database.pool.query(`
      ALTER TABLE audit_log
        ADD CONSTRAINT task008_block_key_create
        CHECK (operation <> 'key.create')
    `);

    try {
      const createResponse = await admin.app.request('/admin/api/keys', {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({ name: 'audit-create-rollback' })
      });
      expect(createResponse.status).toBe(500);

      const createdRows = await database.pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM api_keys WHERE name = 'audit-create-rollback'"
      );
      expect(createdRows.rows[0]?.count).toBe('0');
    } finally {
      await database.pool.query(
        'ALTER TABLE audit_log DROP CONSTRAINT task008_block_key_create'
      );
    }

    const directKey = (
      await createKey(database.pool, {
        name: 'audit-revoke-rollback'
      })
    )._unsafeUnwrap();

    await database.pool.query(`
      ALTER TABLE audit_log
        ADD CONSTRAINT task008_block_key_revoke
        CHECK (operation <> 'key.revoke')
    `);

    try {
      const revokeResponse = await admin.app.request(
        `/admin/api/keys/${directKey.record.id}/revoke`,
        {
          method: 'POST',
          headers: {
            Cookie: admin.cookie,
            'Content-Type': 'application/json',
            'X-CSRF-Token': admin.csrfToken
          },
          body: JSON.stringify({})
        }
      );
      expect(revokeResponse.status).toBe(500);

      const revokedRows = await database.pool.query<{ is_active: boolean }>(
        'SELECT is_active FROM api_keys WHERE id = $1',
        [directKey.record.id]
      );
      expect(revokedRows.rows[0]?.is_active).toBe(true);
    } finally {
      await database.pool.query(
        'ALTER TABLE audit_log DROP CONSTRAINT task008_block_key_revoke'
      );
    }
  }, 120_000);

  it('returns audit filters with offset pagination and safe system stats for active MFA admins', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await setupActiveFirstAdmin(database);
    const apiKey = (
      await createKey(database.pool, {
        name: 'stats-api-key',
        scopes: ['read', 'write']
      })
    )._unsafeUnwrap();
    await database.pool.query(`
      INSERT INTO entities (type, content, visibility, enrichment_status)
      VALUES
        ('memory', 'stats memory', 'shared', 'completed'),
        ('task', 'stats task', 'work', 'pending')
    `);
    await database.pool.query(
      `
        INSERT INTO audit_log (
          api_key_id,
          admin_user_id,
          operation,
          entity_id,
          details,
          timestamp
        )
        VALUES
          ($1, NULL, 'entity.store', NULL, $2, now() - interval '3 minutes'),
          (NULL, $3, 'key.create', $4, $5, now() - interval '2 minutes'),
          (NULL, $3, 'key.revoke', $4, $6, now() - interval '1 minute')
      `,
      [
        apiKey.record.id,
        { diagnostic: 'safe' },
        admin.adminUserId,
        apiKey.record.id,
        { name: 'stats-api-key' },
        { revoked: true }
      ]
    );

    const auditFirstResponse = await admin.app.request(
      '/admin/api/audit?operation=key.create,key.revoke&limit=1',
      {
        headers: {
          Cookie: admin.cookie
        }
      }
    );
    const auditFirstBody = (await auditFirstResponse.json()) as {
      audit: {
        entries: Array<{ operation: string; apiKeyId: string | null }>;
        pagination: {
          limit: number;
          offset: number;
          nextOffset: number | null;
        };
      };
    };
    expect(auditFirstResponse.status).toBe(200);
    expect(auditFirstBody.audit.entries).toEqual([
      expect.objectContaining({
        operation: 'key.revoke',
        apiKeyId: null
      })
    ]);
    expect(auditFirstBody.audit.pagination).toEqual({
      limit: 1,
      offset: 0,
      nextOffset: 1
    });

    const auditSecondResponse = await admin.app.request(
      '/admin/api/audit?operation=key.create,key.revoke&limit=1&offset=1',
      {
        headers: {
          Cookie: admin.cookie
        }
      }
    );
    const auditSecondBody = (await auditSecondResponse.json()) as {
      audit: {
        entries: Array<{ operation: string }>;
        pagination: {
          limit: number;
          offset: number;
          nextOffset: number | null;
        };
      };
    };
    expect(auditSecondResponse.status).toBe(200);
    expect(auditSecondBody.audit.entries).toEqual([
      expect.objectContaining({
        operation: 'key.create'
      })
    ]);
    expect(auditSecondBody.audit.pagination).toEqual({
      limit: 1,
      offset: 1,
      nextOffset: null
    });
    expectNoKeySecretLeak(auditSecondBody);

    const statsResponse = await admin.app.request('/admin/api/stats', {
      headers: {
        Cookie: admin.cookie
      }
    });
    const statsBody = (await statsResponse.json()) as {
      stats: {
        entityCounts: Record<string, number>;
        chunkCount: number;
        keyCount: number;
        databaseSizeBytes: number;
        uptimeSeconds: number;
      };
    };
    expect(statsResponse.status).toBe(200);
    expectPrivateNoStore(statsResponse);
    expect(statsBody.stats).toMatchObject({
      entityCounts: {
        memory: 1,
        task: 1
      },
      chunkCount: 0,
      keyCount: 1
    });
    expect(statsBody.stats.databaseSizeBytes).toBeGreaterThan(0);
    expect(statsBody.stats.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expectNoKeySecretLeak(statsBody);

    const statsAudit = await database.pool.query<{
      admin_user_id: string | null;
      operation: string;
    }>(
      `
        SELECT admin_user_id, operation
        FROM audit_log
        WHERE operation = 'stats.view'
        ORDER BY timestamp DESC
        LIMIT 1
      `
    );
    expect(statsAudit.rows[0]).toEqual({
      admin_user_id: admin.adminUserId,
      operation: 'stats.view'
    });

    const diagnosticsResponse = await admin.app.request(
      '/admin/api/diagnostics/health',
      {
        headers: {
          Cookie: admin.cookie
        }
      }
    );
    expect(diagnosticsResponse.status).toBe(200);
  }, 120_000);

  it('keeps audit pagination stable when query audit rows are written between pages', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await setupActiveFirstAdmin(database);
    await database.pool.query('TRUNCATE TABLE audit_log');
    await database.pool.query(
      `
        INSERT INTO audit_log (
          admin_user_id,
          operation,
          details,
          timestamp
        )
        VALUES
          ($1, 'key.create', $2, now() - interval '2 minutes'),
          ($1, 'key.revoke', $3, now() - interval '1 minute')
      `,
      [admin.adminUserId, { name: 'first-page' }, { name: 'second-page' }]
    );

    const firstResponse = await admin.app.request('/admin/api/audit?limit=1', {
      headers: {
        Cookie: admin.cookie
      }
    });
    const firstBody = (await firstResponse.json()) as {
      audit: { entries: Array<{ operation: string }> };
    };
    expect(firstResponse.status).toBe(200);
    expect(firstBody.audit.entries).toEqual([
      expect.objectContaining({ operation: 'key.revoke' })
    ]);

    const secondResponse = await admin.app.request(
      '/admin/api/audit?limit=1&offset=1',
      {
        headers: {
          Cookie: admin.cookie
        }
      }
    );
    const secondBody = (await secondResponse.json()) as {
      audit: { entries: Array<{ operation: string }> };
    };
    expect(secondResponse.status).toBe(200);
    expect(secondBody.audit.entries).toEqual([
      expect.objectContaining({ operation: 'key.create' })
    ]);
  }, 120_000);

  it('keeps audit pagination stable when explicitly filtering audit query rows', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await setupActiveFirstAdmin(database);
    await database.pool.query('TRUNCATE TABLE audit_log');
    await database.pool.query(
      `
        INSERT INTO audit_log (
          admin_user_id,
          operation,
          details,
          timestamp
        )
        VALUES
          ($1, 'audit.query', $2, now() - interval '2 minutes'),
          ($1, 'audit.query', $3, now() - interval '1 minute')
      `,
      [
        admin.adminUserId,
        { name: 'first-query' },
        { name: 'second-query' }
      ]
    );

    const firstResponse = await admin.app.request(
      '/admin/api/audit?operation=audit.query&limit=1',
      {
        headers: {
          Cookie: admin.cookie
        }
      }
    );
    const firstBody = (await firstResponse.json()) as {
      audit: { entries: Array<{ details: { name: string } }> };
    };
    expect(firstResponse.status).toBe(200);
    expect(firstBody.audit.entries).toHaveLength(1);
    expect(firstBody.audit.entries[0]?.details.name).toBe('second-query');

    const secondResponse = await admin.app.request(
      '/admin/api/audit?operation=audit.query&limit=1&offset=1',
      {
        headers: {
          Cookie: admin.cookie
        }
      }
    );
    const secondBody = (await secondResponse.json()) as {
      audit: { entries: Array<{ details: { name: string } }> };
    };
    expect(secondResponse.status).toBe(200);
    expect(secondBody.audit.entries).toHaveLength(1);
    expect(secondBody.audit.entries[0]?.details.name).toBe('first-query');
  }, 120_000);

  it('redacts common API key aliases and secret-looking values in audit details', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await setupActiveFirstAdmin(database);
    await database.pool.query(
      `
        INSERT INTO audit_log (
          admin_user_id,
          operation,
          details
        )
        VALUES ($1, 'custom.leak', $2)
      `,
      [
        admin.adminUserId,
        {
          apiKey: 'pgm-api-key-alias-12345678901234567890123456789012',
          api_key: 'provider-api-key-secret',
          headers: {
            'x-api-key': 'nested-provider-key',
            Authorization: 'Bearer nested-authorization-token'
          },
          nested: [
            {
              providerApiKey: 'sk-provider-key-12345678901234567890'
            },
            {
              message: 'provider returned sk-message-key-12345678901234567890'
            }
          ],
          safe: 'visible'
        }
      ]
    );

    const response = await admin.app.request(
      '/admin/api/audit?operation=custom.leak&limit=1',
      {
        headers: {
          Cookie: admin.cookie
        }
      }
    );
    const body = (await response.json()) as {
      audit: {
        entries: Array<{
          details: {
            apiKey: string;
            api_key: string;
            headers: {
              'x-api-key': string;
              Authorization: string;
            };
            nested: Array<Record<string, string>>;
            safe: string;
          };
        }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.audit.entries[0]?.details).toEqual({
      apiKey: '[redacted]',
      api_key: '[redacted]',
      headers: {
        'x-api-key': '[redacted]',
        Authorization: '[redacted]'
      },
      nested: [
        {
          providerApiKey: '[redacted]'
        },
        {
          message: '[redacted]'
        }
      ],
      safe: 'visible'
    });
    expect(JSON.stringify(body)).not.toContain('pgm-api-key-alias');
    expect(JSON.stringify(body)).not.toContain('provider-api-key-secret');
    expect(JSON.stringify(body)).not.toContain('nested-provider-key');
    expect(JSON.stringify(body)).not.toContain('sk-message-key');
  }, 120_000);

  it('returns validation errors for malformed UUID filters and revoke IDs', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await setupActiveFirstAdmin(database);
    (
      await createKey(database.pool, {
        name: 'duplicate-admin-key-name'
      })
    )._unsafeUnwrap();

    const duplicateResponse = await admin.app.request('/admin/api/keys', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': admin.csrfToken
      },
      body: JSON.stringify({ name: 'duplicate-admin-key-name' })
    });
    const duplicateBody: unknown = await duplicateResponse.json();
    expect(duplicateResponse.status).toBe(409);
    expect(duplicateBody).toMatchObject({
      error: {
        code: ErrorCode.CONFLICT
      }
    });

    for (const query of [
      'apiKeyId=not-a-uuid',
      'adminUserId=not-a-uuid',
      'entityId=not-a-uuid',
      'offset=100001'
    ]) {
      const response = await admin.app.request(`/admin/api/audit?${query}`, {
        headers: {
          Cookie: admin.cookie
        }
      });
      const body: unknown = await response.json();
      expect(response.status).toBe(400);
      expect(body).toMatchObject({
        error: {
          code: ErrorCode.VALIDATION
        }
      });
    }

    const oversizedKeyOffsetResponse = await admin.app.request(
      '/admin/api/keys?offset=100001',
      {
        headers: {
          Cookie: admin.cookie
        }
      }
    );
    const oversizedKeyOffsetBody: unknown =
      await oversizedKeyOffsetResponse.json();
    expect(oversizedKeyOffsetResponse.status).toBe(400);
    expect(oversizedKeyOffsetBody).toMatchObject({
      error: {
        code: ErrorCode.VALIDATION
      }
    });

    const revokeResponse = await admin.app.request(
      '/admin/api/keys/not-a-uuid/revoke',
      {
        method: 'POST',
        headers: {
          Cookie: admin.cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': admin.csrfToken
        },
        body: JSON.stringify({})
      }
    );
    const revokeBody: unknown = await revokeResponse.json();
    expect(revokeResponse.status).toBe(400);
    expect(revokeBody).toMatchObject({
      error: {
        code: ErrorCode.VALIDATION,
        message: 'Invalid API key id'
      }
    });
  }, 120_000);

  it('preserves admin-route denial for pending-MFA sessions and ordinary bearer tokens after key/audit/stats routes are registered', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const pending = await setupPendingFirstAdmin(database);

    for (const path of [
      '/admin/api/keys',
      '/admin/api/audit',
      '/admin/api/stats',
      '/admin/api/diagnostics/health'
    ]) {
      const response = await pending.app.request(path, {
        headers: {
          Cookie: pending.cookie
        }
      });
      const body: unknown = await response.json();
      expect(response.status).toBe(403);
      expect(body).toMatchObject({
        error: {
          code: ErrorCode.FORBIDDEN,
          message: 'Active admin MFA is required'
        }
      });
    }

    await resetTestDatabase(database.pool);
    const app = createApp({
      pool: database.pool,
      adminMfaSecretKey: ADMIN_MFA_SECRET_KEY,
      oauth: {
        enabled: true,
        publicBaseUrl: OAUTH_PUBLIC_BASE_URL
      }
    });
    const apiKey = (
      await createKey(database.pool, {
        name: 'ordinary-admin-route-denial',
        scopes: ['read', 'write', 'delete'],
        allowedVisibility: ['shared', 'work', 'personal']
      })
    )._unsafeUnwrap();
    const ordinaryApiResponse = await app.request('/api/queue', {
      headers: {
        Authorization: `Bearer ${apiKey.plaintextKey}`
      }
    });
    expect(ordinaryApiResponse.status).toBe(200);

    for (const path of [
      '/admin/api/keys',
      '/admin/api/audit',
      '/admin/api/stats',
      '/admin/api/diagnostics/health'
    ]) {
      const response = await app.request(path, {
        headers: {
          Authorization: `Bearer ${apiKey.plaintextKey}`
        }
      });
      expect(response.status).toBe(401);
    }

    const { clientId } = await registerOAuthClient(app);
    const oauthToken = await authorizeAndExchangeOAuthToken(app, database, {
      clientId
    });
    const oauthApiResponse = await app.request('/api/queue', {
      headers: {
        Authorization: `Bearer ${oauthToken.accessToken}`
      }
    });
    expect(oauthApiResponse.status).toBe(200);

    for (const path of [
      '/admin/api/keys',
      '/admin/api/audit',
      '/admin/api/stats',
      '/admin/api/diagnostics/health'
    ]) {
      const response = await app.request(path, {
        headers: {
          Authorization: `Bearer ${oauthToken.accessToken}`
        }
      });
      expect(response.status).toBe(401);
    }
  }, 120_000);
});
