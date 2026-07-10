import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createAdminUser,
  createBootstrapToken,
  consumeBootstrapToken
} from '../../src/auth/admin-service.js';
import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';
import {
  authorizeAndExchangeOAuthToken,
  OAUTH_PUBLIC_BASE_URL,
  registerOAuthClient
} from '../helpers/oauth.js';

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!';
const GENERIC_BOOTSTRAP_ERROR = {
  error: {
    code: ErrorCode.UNAUTHORIZED,
    message: 'Unable to complete bootstrap setup',
    details: {}
  }
};

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

function expectSessionCookie(
  setCookie: string,
  options: { secure: boolean }
): void {
  expect(setCookie).toContain('pgm_admin_session=');
  expect(setCookie).toContain('HttpOnly');
  if (options.secure) {
    expect(setCookie).toContain('Secure');
  } else {
    expect(setCookie).not.toContain('Secure');
  }
  expect(setCookie).toContain('SameSite=Lax');
  expect(setCookie).toContain('Path=/admin');
}

function expectPrivateNoStore(response: Response): void {
  expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  expect(response.headers.get('Pragma')).toBe('no-cache');
  expect(response.headers.get('Vary')).toBe('Cookie');
}

async function createLoggedInAdmin(database: TestDatabase): Promise<{
  cookie: string;
  csrfToken: string;
}> {
  const user = (
    await createAdminUser(database.pool, {
      email: 'route-admin@example.com',
      password: STRONG_PASSWORD
    })
  )._unsafeUnwrap();
  const session = (
    await createAdminSession(database.pool, {
      adminUserId: user.id,
      ttlMs: 60 * 60 * 1000
    })
  )._unsafeUnwrap();

  const app = createApp({ pool: database.pool });
  const csrfResponse = await app.request('/admin/api/session/csrf', {
    headers: {
      Cookie: `pgm_admin_session=${session.plaintextToken}`
    }
  });
  const csrfBody = (await csrfResponse.json()) as { csrfToken: string };

  expect(csrfResponse.status).toBe(200);
  return {
    cookie: `pgm_admin_session=${session.plaintextToken}`,
    csrfToken: csrfBody.csrfToken
  };
}

describe('admin auth routes', () => {
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

  it('reports bootstrap status without returning bootstrap token material', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({ pool: database.pool });

    const lockedResponse = await app.request('/admin/api/bootstrap/status');
    const lockedBody: unknown = await lockedResponse.json();
    expect(lockedResponse.status).toBe(200);
    expect(lockedBody).toEqual({ state: 'locked' });

    const bootstrap = (
      await createBootstrapToken(database.pool, {
        ttlMs: 10 * 60 * 1000
      })
    )._unsafeUnwrap();

    const unbootstrappedResponse = await app.request(
      '/admin/api/bootstrap/status'
    );
    const unbootstrappedBody: unknown = await unbootstrappedResponse.json();
    expect(unbootstrappedResponse.status).toBe(200);
    expect(unbootstrappedBody).toEqual({ state: 'unbootstrapped' });
    expect(JSON.stringify(unbootstrappedBody)).not.toContain(
      bootstrap.plaintextToken
    );

    const setupResponse = await app.request('/admin/api/bootstrap/setup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bootstrapToken: bootstrap.plaintextToken,
        email: 'first@example.com',
        password: STRONG_PASSWORD
      })
    });
    expect(setupResponse.status).toBe(201);

    const configuredResponse = await app.request('/admin/api/bootstrap/status');
    const configuredBody: unknown = await configuredResponse.json();
    expect(configuredResponse.status).toBe(200);
    expect(configuredBody).toEqual({ state: 'configured' });
  }, 120_000);

  it('maps missing, invalid, expired, and used bootstrap tokens to the same safe error', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({ pool: database.pool });
    const now = new Date();
    const expired = (
      await createBootstrapToken(database.pool, {
        ttlMs: 1,
        now: new Date(now.getTime() - 60_000)
      })
    )._unsafeUnwrap();
    const used = (
      await createBootstrapToken(database.pool, {
        ttlMs: 10 * 60 * 1000
      })
    )._unsafeUnwrap();
    await consumeBootstrapToken(database.pool, used.plaintextToken);

    const requests = [
      {},
      { bootstrapToken: 'pgm-admin-bootstrap-not-a-real-token' },
      { bootstrapToken: expired.plaintextToken },
      { bootstrapToken: used.plaintextToken }
    ];

    for (const request of requests) {
      const response = await app.request('/admin/api/bootstrap/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...request,
          email: 'first@example.com',
          password:
            'password' in request && typeof request.password === 'string'
              ? request.password
              : STRONG_PASSWORD
        })
      });
      const body: unknown = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual(GENERIC_BOOTSTRAP_ERROR);
    }

    await resetTestDatabase(database.pool);
    const validWeakPasswordToken = (
      await createBootstrapToken(database.pool, {
        ttlMs: 10 * 60 * 1000
      })
    )._unsafeUnwrap();

    for (const request of [
      {
        bootstrapToken: validWeakPasswordToken.plaintextToken,
        password: 'password123'
      },
      {
        bootstrapToken: 'pgm-admin-bootstrap-invalid-with-weak-password',
        password: 'password123'
      }
    ]) {
      const response = await app.request('/admin/api/bootstrap/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...request,
          email: 'first@example.com'
        })
      });
      const body: unknown = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual(GENERIC_BOOTSTRAP_ERROR);
    }
  }, 120_000);

  it('creates only a pending-MFA first admin and issues a session cookie plus CSRF token', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const bootstrap = (
      await createBootstrapToken(database.pool, {
        ttlMs: 10 * 60 * 1000
      })
    )._unsafeUnwrap();
    const app = createApp({ pool: database.pool });

    const response = await app.request(
      'http://postgram.example.test/admin/api/bootstrap/setup',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bootstrapToken: bootstrap.plaintextToken,
          email: 'First@Example.com',
          displayName: 'First Admin',
          password: STRONG_PASSWORD
        })
      }
    );
    const body = (await response.json()) as {
      state: string;
      csrfToken: string;
      user: {
        email: string;
        displayName: string;
        status: string;
        mfaRequired: boolean;
      };
    };

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      state: 'mfa_required',
      user: {
        email: 'first@example.com',
        displayName: 'First Admin',
        status: 'pending_mfa',
        mfaRequired: true
      }
    });
    expect(body.csrfToken).toEqual(expect.any(String));
    expectSessionCookie(getSetCookie(response, 'pgm_admin_session'), {
      secure: true
    });

    const adminCount = await database.pool.query<{
      count: string;
      status: string;
    }>(
      `
        SELECT COUNT(*)::text AS count, MAX(status) AS status
        FROM admin_users
      `
    );
    expect(adminCount.rows[0]).toMatchObject({
      count: '1',
      status: 'pending_mfa'
    });
  }, 120_000);

  it('logs in with admin credentials, exposes the current session, refreshes CSRF, and clears the session on logout', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({ pool: database.pool });
    await createAdminUser(database.pool, {
      email: 'login@example.com',
      displayName: 'Login Admin',
      password: STRONG_PASSWORD
    });

    const loginResponse = await app.request(
      'http://[::1]/admin/api/session/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: 'login@example.com',
          password: STRONG_PASSWORD
        })
      }
    );
    const loginBody = (await loginResponse.json()) as { csrfToken: string };
    const sessionCookie = getSetCookie(loginResponse, 'pgm_admin_session');
    const cookie = cookieHeaderFromSetCookie(sessionCookie);

    expect(loginResponse.status).toBe(200);
    expectSessionCookie(sessionCookie, { secure: false });
    expectPrivateNoStore(loginResponse);
    expect(loginBody.csrfToken).toEqual(expect.any(String));

    const currentResponse = await app.request('/admin/api/session/current', {
      headers: {
        Cookie: cookie
      }
    });
    const currentBody: unknown = await currentResponse.json();
    expect(currentResponse.status).toBe(200);
    expectPrivateNoStore(currentResponse);
    expect(currentBody).toMatchObject({
      user: {
        email: 'login@example.com',
        status: 'pending_mfa'
      },
      session: {
        mfaVerified: false
      }
    });

    const csrfResponse = await app.request('/admin/api/session/csrf', {
      headers: {
        Cookie: cookie
      }
    });
    const csrfBody = (await csrfResponse.json()) as { csrfToken: string };
    expect(csrfResponse.status).toBe(200);
    expectPrivateNoStore(csrfResponse);
    expect(csrfBody.csrfToken).toEqual(expect.any(String));

    const logoutResponse = await app.request('/admin/api/session/logout', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': loginBody.csrfToken
      }
    });
    const logoutBody: unknown = await logoutResponse.json();
    expect(logoutResponse.status).toBe(200);
    expectPrivateNoStore(logoutResponse);
    expect(logoutBody).toEqual({ ok: true });
    expect(getSetCookie(logoutResponse, 'pgm_admin_session')).toContain(
      'Max-Age=0'
    );

    const afterLogoutResponse = await app.request(
      '/admin/api/session/current',
      {
        headers: {
          Cookie: cookie
        }
      }
    );
    expect(afterLogoutResponse.status).toBe(401);
  }, 120_000);

  it('rejects admin mutations without a valid CSRF token', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const { cookie, csrfToken } = await createLoggedInAdmin(database);
    const app = createApp({ pool: database.pool });

    const missingResponse = await app.request('/admin/api/session/logout', {
      method: 'POST',
      headers: {
        Cookie: cookie
      }
    });
    const missingBody: unknown = await missingResponse.json();
    expect(missingResponse.status).toBe(403);
    expect(missingBody).toEqual({
      error: {
        code: ErrorCode.FORBIDDEN,
        message: 'Invalid CSRF token',
        details: {}
      }
    });

    const invalidResponse = await app.request('/admin/api/session/logout', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'X-CSRF-Token': `${csrfToken}-tampered`
      }
    });
    expect(invalidResponse.status).toBe(403);
  }, 120_000);

  it('rejects missing and expired admin sessions', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const user = (
      await createAdminUser(database.pool, {
        email: 'expired@example.com',
        password: STRONG_PASSWORD
      })
    )._unsafeUnwrap();
    const expired = (
      await createAdminSession(database.pool, {
        adminUserId: user.id,
        ttlMs: 1,
        now: new Date(Date.now() - 60_000)
      })
    )._unsafeUnwrap();
    const app = createApp({ pool: database.pool });

    const missingResponse = await app.request('/admin/api/session/current');
    const missingBody: unknown = await missingResponse.json();
    expect(missingResponse.status).toBe(401);
    expect(missingBody).toEqual({
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: 'Missing admin session',
        details: {}
      }
    });

    const expiredResponse = await app.request('/admin/api/session/current', {
      headers: {
        Cookie: `pgm_admin_session=${expired.plaintextToken}`
      }
    });
    const expiredBody: unknown = await expiredResponse.json();
    expect(expiredResponse.status).toBe(401);
    expect(expiredBody).toEqual({
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: 'Invalid admin session',
        details: {}
      }
    });
  }, 120_000);

  it('does not authorize admin endpoints with ordinary API-key or MCP OAuth bearer tokens', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({
      pool: database.pool,
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

    const apiKeyAdminResponse = await app.request(
      '/admin/api/session/current',
      {
        headers: {
          Authorization: `Bearer ${apiKey.plaintextKey}`
        }
      }
    );
    expect(apiKeyAdminResponse.status).toBe(401);

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

    const oauthAdminResponse = await app.request('/admin/api/session/current', {
      headers: {
        Authorization: `Bearer ${oauthToken.accessToken}`
      }
    });
    expect(oauthAdminResponse.status).toBe(401);
  }, 120_000);

  it('rate-limits bootstrap and login attempts without accepting later valid credentials', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({ pool: database.pool });
    const bootstrap = (
      await createBootstrapToken(database.pool, {
        ttlMs: 10 * 60 * 1000
      })
    )._unsafeUnwrap();

    for (let index = 0; index < 5; index += 1) {
      const response = await app.request('/admin/api/bootstrap/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bootstrapToken: `pgm-admin-bootstrap-wrong-${index}`,
          email: 'first@example.com',
          password: STRONG_PASSWORD
        })
      });
      expect(response.status).toBe(401);
    }

    const limitedBootstrapResponse = await app.request(
      '/admin/api/bootstrap/setup',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bootstrapToken: bootstrap.plaintextToken,
          email: 'first@example.com',
          password: STRONG_PASSWORD
        })
      }
    );
    const limitedBootstrapBody: unknown = await limitedBootstrapResponse.json();
    expect(limitedBootstrapResponse.status).toBe(429);
    expect(limitedBootstrapBody).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many bootstrap attempts',
        details: {}
      }
    });

    await resetTestDatabase(database.pool);
    const weakPasswordBootstrap = (
      await createBootstrapToken(database.pool, {
        ttlMs: 10 * 60 * 1000
      })
    )._unsafeUnwrap();

    for (let index = 0; index < 5; index += 1) {
      const response = await app.request('/admin/api/bootstrap/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bootstrapToken: weakPasswordBootstrap.plaintextToken,
          email: 'first@example.com',
          password: 'password123'
        })
      });
      expect(response.status).toBe(401);
    }

    const limitedWeakPasswordBootstrapResponse = await app.request(
      '/admin/api/bootstrap/setup',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bootstrapToken: weakPasswordBootstrap.plaintextToken,
          email: 'first@example.com',
          password: STRONG_PASSWORD
        })
      }
    );
    expect(limitedWeakPasswordBootstrapResponse.status).toBe(429);

    await resetTestDatabase(database.pool);
    await createAdminUser(database.pool, {
      email: 'login-limit@example.com',
      password: STRONG_PASSWORD
    });

    for (let index = 0; index < 5; index += 1) {
      const response = await app.request('/admin/api/session/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: 'login-limit@example.com',
          password: 'Wrong-Horse-Battery-42!'
        })
      });
      expect(response.status).toBe(401);
    }

    const limitedLoginResponse = await app.request('/admin/api/session/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'login-limit@example.com',
        password: STRONG_PASSWORD
      })
    });
    const limitedLoginBody: unknown = await limitedLoginResponse.json();
    expect(limitedLoginResponse.status).toBe(429);
    expect(limitedLoginBody).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many login attempts',
        details: {}
      }
    });

    await resetTestDatabase(database.pool);
    await createAdminUser(database.pool, {
      email: 'global-login-limit@example.com',
      password: STRONG_PASSWORD
    });

    for (let index = 0; index < 5; index += 1) {
      const response = await app.request('/admin/api/session/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: `missing-login-${index}@example.com`,
          password: 'Wrong-Horse-Battery-42!'
        })
      });
      expect(response.status).toBe(401);
    }

    const globallyLimitedLoginResponse = await app.request(
      '/admin/api/session/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: 'global-login-limit@example.com',
          password: STRONG_PASSWORD
        })
      }
    );
    expect(globallyLimitedLoginResponse.status).toBe(429);
  }, 120_000);

  it('propagates internal login verifier failures without recording credential attempts', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const app = createApp({ pool: database.pool });
    await database.pool.query(
      `
        INSERT INTO admin_users (email, password_hash, status, mfa_required)
        VALUES ($1, $2, 'pending_mfa', true)
      `,
      ['corrupt-login@example.com', 'not-an-argon2-hash']
    );

    const response = await app.request('/admin/api/session/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'corrupt-login@example.com',
        password: STRONG_PASSWORD
      })
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: {
        code: ErrorCode.INTERNAL,
        message: 'Failed to verify admin password'
      }
    });

    const attempts = await database.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM admin_auth_attempts'
    );
    expect(attempts.rows[0]?.count).toBe('0');
  }, 120_000);
});
