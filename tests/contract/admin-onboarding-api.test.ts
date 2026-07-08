import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createAdminSession,
  createAdminUser
} from '../../src/auth/admin-service.js';
import { createKey } from '../../src/auth/key-service.js';
import { createApp } from '../../src/index.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const STRONG_PASSWORD = 'Correct-Horse-Battery-42!';

async function createActiveAdminSession(database: TestDatabase): Promise<{
  adminUserId: string;
  cookie: string;
  csrfToken: string;
}> {
  const user = (
    await createAdminUser(database.pool, {
      email: 'onboarding-admin@example.com',
      password: STRONG_PASSWORD
    })
  )._unsafeUnwrap();

  await database.pool.query(
    "UPDATE admin_users SET status = 'active' WHERE id = $1",
    [user.id]
  );

  const session = (
    await createAdminSession(database.pool, {
      adminUserId: user.id,
      ttlMs: 60 * 60 * 1000,
      mfaVerified: true
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
    adminUserId: user.id,
    cookie: `pgm_admin_session=${session.plaintextToken}`,
    csrfToken: csrfBody.csrfToken
  };
}

function expectNoStore(response: Response): void {
  expect(response.headers.get('Cache-Control')).toBe('no-store, private');
  expect(response.headers.get('Pragma')).toBe('no-cache');
  expect(response.headers.get('Vary')).toBe('Cookie');
}

describe('admin onboarding API', () => {
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

  it('requires an active admin session instead of ordinary API bearer auth', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const apiKey = (
      await createKey(database.pool, {
        name: 'ordinary-api-key',
        scopes: ['read', 'write']
      })
    )._unsafeUnwrap();
    const app = createApp({ pool: database.pool });

    const unauthenticated = await app.request('/admin/api/onboarding');
    expect(unauthenticated.status).toBe(401);

    const bearer = await app.request('/admin/api/onboarding', {
      headers: {
        Authorization: `Bearer ${apiKey.plaintextKey}`
      }
    });
    expect(bearer.status).toBe(401);
  }, 120_000);

  it('reads default state and resumes updated progress from Postgres', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await createActiveAdminSession(database);
    const app = createApp({ pool: database.pool });

    const initial = await app.request('/admin/api/onboarding', {
      headers: {
        Cookie: admin.cookie
      }
    });
    const initialBody = (await initial.json()) as {
      onboarding: {
        status: string;
        currentStep: string;
        completedSteps: string[];
        skippedAt: string | null;
        completedAt: string | null;
        updatedAt: string;
      };
    };

    expect(initial.status).toBe(200);
    expectNoStore(initial);
    expect(initialBody.onboarding).toMatchObject({
      status: 'in_progress',
      currentStep: 'setup',
      completedSteps: [],
      skippedAt: null,
      completedAt: null
    });
    expect(initialBody.onboarding.updatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/
    );

    const withoutCsrf = await app.request('/admin/api/onboarding', {
      method: 'PUT',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        currentStep: 'provider_config',
        completedSteps: ['setup']
      })
    });
    expect(withoutCsrf.status).toBe(403);

    const updated = await app.request('/admin/api/onboarding', {
      method: 'PUT',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': admin.csrfToken
      },
      body: JSON.stringify({
        currentStep: 'provider_config',
        completedSteps: ['setup']
      })
    });
    const updatedBody = (await updated.json()) as typeof initialBody;

    expect(updated.status).toBe(200);
    expect(updatedBody.onboarding).toMatchObject({
      status: 'in_progress',
      currentStep: 'provider_config',
      completedSteps: ['setup'],
      skippedAt: null,
      completedAt: null
    });

    const restartedApp = createApp({ pool: database.pool });
    const resumed = await restartedApp.request('/admin/api/onboarding', {
      headers: {
        Cookie: admin.cookie
      }
    });
    const resumedBody = (await resumed.json()) as typeof initialBody;

    expect(resumed.status).toBe(200);
    expect(resumedBody.onboarding).toMatchObject({
      status: 'in_progress',
      currentStep: 'provider_config',
      completedSteps: ['setup']
    });
  }, 120_000);

  it('deliberately skips and completes onboarding with audit evidence', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const admin = await createActiveAdminSession(database);
    const app = createApp({ pool: database.pool });

    const skipped = await app.request('/admin/api/onboarding/skip', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': admin.csrfToken
      },
      body: JSON.stringify({})
    });
    const skippedBody = (await skipped.json()) as {
      onboarding: {
        status: string;
        skippedAt: string | null;
        completedAt: string | null;
      };
    };

    expect(skipped.status).toBe(200);
    expect(skippedBody.onboarding.status).toBe('skipped');
    expect(skippedBody.onboarding.skippedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(skippedBody.onboarding.completedAt).toBeNull();

    const completed = await app.request('/admin/api/onboarding/complete', {
      method: 'POST',
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': admin.csrfToken
      },
      body: JSON.stringify({})
    });
    const completedBody = (await completed.json()) as {
      onboarding: {
        status: string;
        currentStep: string;
        completedSteps: string[];
        skippedAt: string | null;
        completedAt: string | null;
      };
    };

    expect(completed.status).toBe(200);
    expect(completedBody.onboarding).toMatchObject({
      status: 'completed',
      currentStep: 'maintenance',
      completedSteps: [
        'setup',
        'provider_config',
        'secrets',
        'validate_apply',
        'backup_restore',
        'maintenance'
      ],
      skippedAt: null
    });
    expect(completedBody.onboarding.completedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/
    );

    const audit = await database.pool.query<{ operation: string }>(
      `
        SELECT operation
        FROM audit_log
        WHERE admin_user_id = $1
          AND operation IN ('admin.onboarding.skip', 'admin.onboarding.complete')
        ORDER BY timestamp ASC
      `,
      [admin.adminUserId]
    );

    expect(audit.rows.map((row) => row.operation)).toEqual([
      'admin.onboarding.skip',
      'admin.onboarding.complete'
    ]);
  }, 120_000);
});
