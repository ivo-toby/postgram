import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAdminSession, createAdminUser, createBootstrapToken } from '../../src/auth/admin-service.js';
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

function invalidTotpCode(secret: string): string {
  return totpCode(secret) === '000000' ? '000001' : '000000';
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

async function enrollAndVerifyFirstAdmin(database: TestDatabase): Promise<{
  app: ReturnType<typeof createApp>;
  cookie: string;
  csrfToken: string;
  secret: string;
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
  expect(verifyResponse.status).toBe(200);

  return {
    ...setup,
    secret: enrollBody.secret
  };
}

describe('admin MFA routes', () => {
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

  it('enrolls and verifies TOTP for the pending first admin without leaking stored secrets', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const { app, cookie, csrfToken } = await setupPendingFirstAdmin(database);

    const enrollResponse = await app.request('/admin/api/session/mfa/enroll', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': csrfToken
      }
    });
    const enrollBody = (await enrollResponse.json()) as {
      factor: {
        id: string;
        type: string;
        status: string;
        createdAt: string;
      };
      secret: string;
      otpauthUrl: string;
    };

    expect(enrollResponse.status).toBe(201);
    expect(enrollBody.factor).toMatchObject({
      type: 'totp',
      status: 'pending'
    });
    expect(enrollBody.secret).toMatch(/^[A-Z2-7]{32}$/u);
    expect(enrollBody.otpauthUrl).toContain('otpauth://totp/Postgram');
    expect(JSON.stringify(enrollBody)).not.toContain('secret_ciphertext');
    expect(JSON.stringify(enrollBody)).not.toContain('secretCiphertext');

    const invalidResponse = await app.request(
      '/admin/api/session/mfa/verify',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          factorId: enrollBody.factor.id,
          code: '000000'
        })
      }
    );
    expect(invalidResponse.status).toBe(401);

    const verifyResponse = await app.request(
      '/admin/api/session/mfa/verify',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          factorId: enrollBody.factor.id,
          code: totpCode(enrollBody.secret)
        })
      }
    );
    const verifyBody = (await verifyResponse.json()) as {
      user: { status: string };
      session: { mfaVerified: boolean };
    };

    expect(verifyResponse.status).toBe(200);
    expect(verifyBody).toMatchObject({
      user: {
        status: 'active'
      },
      session: {
        mfaVerified: true
      }
    });
    expect(JSON.stringify(verifyBody)).not.toContain(enrollBody.secret);

    const currentResponse = await app.request('/admin/api/session/current', {
      headers: {
        Cookie: cookie
      }
    });
    const currentBody: unknown = await currentResponse.json();
    expect(currentResponse.status).toBe(200);
    expect(currentBody).toMatchObject({
      user: {
        status: 'active'
      },
      session: {
        mfaVerified: true
      }
    });
    expect(JSON.stringify(currentBody)).not.toContain(enrollBody.secret);

    const databaseState = await database.pool.query<{
      user_status: string;
      factor_status: string;
      mfa_verified_at: Date | null;
    }>(
      `
        SELECT
          u.status AS user_status,
          f.status AS factor_status,
          s.mfa_verified_at
        FROM admin_users u
        JOIN admin_mfa_factors f ON f.admin_user_id = u.id
        JOIN admin_sessions s ON s.admin_user_id = u.id
      `
    );
    expect(databaseState.rows[0]).toMatchObject({
      user_status: 'active',
      factor_status: 'verified'
    });
    expect(databaseState.rows[0]?.mfa_verified_at).toBeInstanceOf(Date);

    const auditRows = await database.pool.query<{
      operation: string;
      details: unknown;
    }>(
      `
        SELECT operation, details
        FROM audit_log
        WHERE operation IN ('admin.mfa.enroll', 'admin.mfa.verify')
        ORDER BY timestamp ASC
      `
    );
    expect(auditRows.rows.map((row) => row.operation)).toEqual([
      'admin.mfa.enroll',
      'admin.mfa.verify'
    ]);
    expect(JSON.stringify(auditRows.rows)).not.toContain(enrollBody.secret);
  }, 120_000);

  it('denies pending-MFA sessions from step-up while keeping setup session routes usable', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const { app, cookie, csrfToken } = await setupPendingFirstAdmin(database);

    const currentResponse = await app.request('/admin/api/session/current', {
      headers: {
        Cookie: cookie
      }
    });
    expect(currentResponse.status).toBe(200);

    const csrfResponse = await app.request('/admin/api/session/csrf', {
      headers: {
        Cookie: cookie
      }
    });
    expect(csrfResponse.status).toBe(200);

    const stepUpResponse = await app.request('/admin/api/session/step-up', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        code: '123456'
      })
    });
    const stepUpBody: unknown = await stepUpResponse.json();
    expect(stepUpResponse.status).toBe(403);
    expect(stepUpBody).toEqual({
      error: {
        code: ErrorCode.FORBIDDEN,
        message: 'Active admin MFA is required',
        details: {}
      }
    });

    const logoutResponse = await app.request('/admin/api/session/logout', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': csrfToken
      }
    });
    expect(logoutResponse.status).toBe(200);
  }, 120_000);

  it('challenges an active MFA admin after login and refreshes the step-up marker', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const { app, secret } = await enrollAndVerifyFirstAdmin(database);
    const loginResponse = await app.request('/admin/api/session/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'first@example.com',
        password: STRONG_PASSWORD
      })
    });
    const loginBody = (await loginResponse.json()) as { csrfToken: string };
    const loginCookie = cookieHeaderFromSetCookie(
      getSetCookie(loginResponse, 'pgm_admin_session')
    );
    expect(loginResponse.status).toBe(200);

    const prematureStepUpResponse = await app.request(
      '/admin/api/session/step-up',
      {
        method: 'POST',
        headers: {
          Cookie: loginCookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': loginBody.csrfToken
        },
        body: JSON.stringify({
          code: totpCode(secret)
        })
      }
    );
    expect(prematureStepUpResponse.status).toBe(403);

    const wrongChallengeResponse = await app.request(
      '/admin/api/session/mfa/challenge',
      {
        method: 'POST',
        headers: {
          Cookie: loginCookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': loginBody.csrfToken
        },
        body: JSON.stringify({
          code: '000000'
        })
      }
    );
    expect(wrongChallengeResponse.status).toBe(401);

    const challengeResponse = await app.request(
      '/admin/api/session/mfa/challenge',
      {
        method: 'POST',
        headers: {
          Cookie: loginCookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': loginBody.csrfToken
        },
        body: JSON.stringify({
          code: totpCode(secret)
        })
      }
    );
    const challengeBody = (await challengeResponse.json()) as {
      session: { mfaVerified: boolean };
    };
    expect(challengeResponse.status).toBe(200);
    expect(challengeBody.session.mfaVerified).toBe(true);
    expect(JSON.stringify(challengeBody)).not.toContain(secret);

    await database.pool.query(
      `
        UPDATE admin_sessions
        SET mfa_verified_at = now() - interval '20 minutes'
        WHERE id = (
          SELECT id
          FROM admin_sessions
          ORDER BY created_at DESC
          LIMIT 1
        )
      `
    );

    const stepUpResponse = await app.request('/admin/api/session/step-up', {
      method: 'POST',
      headers: {
        Cookie: loginCookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': loginBody.csrfToken
      },
      body: JSON.stringify({
        code: totpCode(secret)
      })
    });
    const stepUpBody = (await stepUpResponse.json()) as {
      stepUp: { fresh: boolean; expiresAt: string };
      session: { mfaVerified: boolean };
    };
    expect(stepUpResponse.status).toBe(200);
    expect(stepUpBody).toMatchObject({
      stepUp: {
        fresh: true
      },
      session: {
        mfaVerified: true
      }
    });
    expect(new Date(stepUpBody.stepUp.expiresAt).getTime()).toBeGreaterThan(
      Date.now()
    );

    const auditRows = await database.pool.query<{ operation: string }>(
      `
        SELECT operation
        FROM audit_log
        WHERE operation IN ('admin.mfa.challenge', 'admin.step_up')
        ORDER BY timestamp ASC
      `
    );
    expect(auditRows.rows.map((row) => row.operation)).toEqual([
      'admin.mfa.challenge',
      'admin.step_up'
    ]);
  }, 120_000);

  it('rate-limits MFA verification and step-up route attempts', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const { app, cookie, csrfToken } = await setupPendingFirstAdmin(database);
    const enrollResponse = await app.request('/admin/api/session/mfa/enroll', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': csrfToken
      }
    });
    const enrollBody = (await enrollResponse.json()) as {
      factor: { id: string };
      secret: string;
    };
    expect(enrollResponse.status).toBe(201);

    const invalidCode = invalidTotpCode(enrollBody.secret);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failedVerifyResponse = await app.request(
        '/admin/api/session/mfa/verify',
        {
          method: 'POST',
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          },
          body: JSON.stringify({
            factorId: enrollBody.factor.id,
            code: invalidCode
          })
        }
      );
      expect(failedVerifyResponse.status).toBe(401);
    }

    const limitedVerifyResponse = await app.request(
      '/admin/api/session/mfa/verify',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          factorId: enrollBody.factor.id,
          code: totpCode(enrollBody.secret)
        })
      }
    );
    const limitedVerifyBody: unknown = await limitedVerifyResponse.json();
    expect(limitedVerifyResponse.status).toBe(429);
    expect(limitedVerifyBody).toMatchObject({
      error: {
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many MFA attempts'
      }
    });

    await database.pool.query(
      "DELETE FROM admin_auth_attempts WHERE attempt_type = 'mfa'"
    );

    const verifyResponse = await app.request('/admin/api/session/mfa/verify', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        factorId: enrollBody.factor.id,
        code: totpCode(enrollBody.secret)
      })
    });
    expect(verifyResponse.status).toBe(200);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failedStepUpResponse = await app.request(
        '/admin/api/session/step-up',
        {
          method: 'POST',
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          },
          body: JSON.stringify({
            code: invalidCode
          })
        }
      );
      expect(failedStepUpResponse.status).toBe(401);
    }

    const limitedStepUpResponse = await app.request(
      '/admin/api/session/step-up',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          code: totpCode(enrollBody.secret)
        })
      }
    );
    const limitedStepUpBody: unknown = await limitedStepUpResponse.json();
    expect(limitedStepUpResponse.status).toBe(429);
    expect(limitedStepUpBody).toMatchObject({
      error: {
        code: ErrorCode.RATE_LIMITED,
        message: 'Too many step-up attempts'
      }
    });
  }, 120_000);

  it('does not allow ordinary API-key bearer or MCP OAuth bearer tokens to bypass MFA endpoints', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

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
        name: 'ordinary-mfa-route-denial',
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

    const apiKeyEnrollResponse = await app.request(
      '/admin/api/session/mfa/enroll',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.plaintextKey}`,
          'X-CSRF-Token': 'not-a-session-csrf-token'
        }
      }
    );
    expect(apiKeyEnrollResponse.status).toBe(401);

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

    const oauthStepUpResponse = await app.request(
      '/admin/api/session/step-up',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${oauthToken.accessToken}`,
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'not-a-session-csrf-token'
        },
        body: JSON.stringify({
          code: '123456'
        })
      }
    );
    expect(oauthStepUpResponse.status).toBe(401);
  }, 120_000);

  it('requires CSRF protection for MFA mutations', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const user = (
      await createAdminUser(database.pool, {
        email: 'csrf-mfa@example.com',
        password: STRONG_PASSWORD
      })
    )._unsafeUnwrap();
    const session = (
      await createAdminSession(database.pool, {
        adminUserId: user.id,
        ttlMs: 60 * 60 * 1000
      })
    )._unsafeUnwrap();
    const app = createApp({
      pool: database.pool,
      adminMfaSecretKey: ADMIN_MFA_SECRET_KEY
    });

    const response = await app.request('/admin/api/session/mfa/enroll', {
      method: 'POST',
      headers: {
        Cookie: `pgm_admin_session=${session.plaintextToken}`
      }
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: {
        code: ErrorCode.FORBIDDEN,
        message: 'Invalid CSRF token',
        details: {}
      }
    });
  }, 120_000);
});
