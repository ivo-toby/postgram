import argon2 from 'argon2';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  consumeBootstrapToken,
  createAdminSession,
  createAdminUser,
  createBootstrapToken,
  createFirstAdminWithBootstrapToken,
  findAdminSession,
  invalidateAdminSession,
  verifyAdminPassword
} from '../../src/auth/admin-service.js';
import {
  beginAdminTotpEnrollment,
  generateTotpCode,
  verifyAdminTotpChallenge,
  verifyAdminTotpEnrollment
} from '../../src/auth/admin-mfa-service.js';
import { isAdminStepUpFresh } from '../../src/auth/admin-middleware.js';
import { createKey } from '../../src/auth/key-service.js';
import { ErrorCode } from '../../src/util/errors.js';
import {
  createTestDatabase,
  resetTestDatabase,
  type TestDatabase
} from '../helpers/postgres.js';

const ADMIN_MFA_SECRET_KEY = 'test-admin-mfa-secret-key-32-bytes-minimum';

describe('admin-auth-service', () => {
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

  it('creates admin users with argon2id password hashes and verifies passwords', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const password = 'Correct-Horse-Battery-42!';
    const created = await createAdminUser(database.pool, {
      email: 'Admin@Example.COM',
      displayName: 'Primary Admin',
      password
    });

    expect(created.isOk()).toBe(true);
    const user = created._unsafeUnwrap();
    expect(user).toMatchObject({
      email: 'admin@example.com',
      displayName: 'Primary Admin',
      status: 'pending_mfa',
      mfaRequired: true
    });
    expect(user).not.toHaveProperty('passwordHash');

    const row = await database.pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM admin_users WHERE id = $1',
      [user.id]
    );
    expect(row.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.rows[0]?.password_hash).not.toContain(password);

    const verified = await verifyAdminPassword(database.pool, {
      email: 'admin@example.com',
      password
    });
    expect(verified.isOk()).toBe(true);
    expect(verified._unsafeUnwrap().id).toBe(user.id);

    const rejected = await verifyAdminPassword(database.pool, {
      email: 'admin@example.com',
      password: 'Correct-Horse-Battery-43!'
    });
    expect(rejected.isErr()).toBe(true);
    expect(rejected._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);

    const missing = await verifyAdminPassword(database.pool, {
      email: 'missing@example.com',
      password: 'Correct-Horse-Battery-43!'
    });
    expect(missing.isErr()).toBe(true);
    expect(missing._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);
  }, 120_000);

  it('rejects weak admin passwords before storing users', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const created = await createAdminUser(database.pool, {
      email: 'weak@example.com',
      password: 'password123'
    });

    expect(created.isErr()).toBe(true);
    expect(created._unsafeUnwrapErr().code).toBe(ErrorCode.VALIDATION);

    const count = await database.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM admin_users'
    );
    expect(count.rows[0]?.count).toBe('0');
  }, 120_000);

  it('always creates pending-MFA admins even when callers pass unsafe state', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const unsafeInput = {
      email: 'unsafe@example.com',
      password: 'Correct-Horse-Battery-42!',
      status: 'active',
      mfaRequired: false
    };

    const created = await createAdminUser(database.pool, unsafeInput);

    expect(created.isOk()).toBe(true);
    expect(created._unsafeUnwrap()).toMatchObject({
      email: 'unsafe@example.com',
      status: 'pending_mfa',
      mfaRequired: true
    });
  }, 120_000);

  it('creates, looks up, expires, and invalidates admin sessions without storing token plaintext', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const user = (
      await createAdminUser(database.pool, {
        email: 'session@example.com',
        password: 'Correct-Horse-Battery-42!'
      })
    )._unsafeUnwrap();

    const now = new Date('2026-07-05T10:00:00.000Z');
    const sessionResult = await createAdminSession(database.pool, {
      adminUserId: user.id,
      ttlMs: 60 * 60 * 1000,
      now
    });

    expect(sessionResult.isOk()).toBe(true);
    const { plaintextToken, session } = sessionResult._unsafeUnwrap();
    expect(plaintextToken).toMatch(/^pgm-admin-session-/);
    expect(session).not.toHaveProperty('tokenHash');

    const row = await database.pool.query<{ token_hash: string }>(
      'SELECT token_hash FROM admin_sessions WHERE id = $1',
      [session.id]
    );
    expect(row.rows[0]?.token_hash).not.toBe(plaintextToken);
    expect(row.rows[0]?.token_hash).not.toContain(plaintextToken);

    const found = await findAdminSession(database.pool, plaintextToken, {
      now: new Date('2026-07-05T10:10:00.000Z')
    });
    expect(found.isOk()).toBe(true);
    expect(found._unsafeUnwrap().user.id).toBe(user.id);

    const expired = await findAdminSession(database.pool, plaintextToken, {
      now: new Date('2026-07-05T11:00:01.000Z')
    });
    expect(expired.isErr()).toBe(true);
    expect(expired._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);

    const replacement = (
      await createAdminSession(database.pool, {
        adminUserId: user.id,
        ttlMs: 60 * 60 * 1000,
        now
      })
    )._unsafeUnwrap();

    const invalidated = await invalidateAdminSession(
      database.pool,
      replacement.plaintextToken
    );
    expect(invalidated.isOk()).toBe(true);

    const afterLogout = await findAdminSession(
      database.pool,
      replacement.plaintextToken,
      { now }
    );
    expect(afterLogout.isErr()).toBe(true);
    expect(afterLogout._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);
  }, 120_000);

  it('rejects a session that is revoked while last-used tracking is updated', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const user = (
      await createAdminUser(database.pool, {
        email: 'race@example.com',
        password: 'Correct-Horse-Battery-42!'
      })
    )._unsafeUnwrap();

    const now = new Date('2026-07-05T10:00:00.000Z');
    const session = (
      await createAdminSession(database.pool, {
        adminUserId: user.id,
        ttlMs: 60 * 60 * 1000,
        now
      })
    )._unsafeUnwrap();

    await database.pool.query(`
      CREATE OR REPLACE FUNCTION revoke_admin_session_on_touch()
      RETURNS trigger AS $$
      BEGIN
        NEW.revoked_at = NEW.last_used_at;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_revoke_admin_session_on_touch
        BEFORE UPDATE OF last_used_at ON admin_sessions
        FOR EACH ROW EXECUTE FUNCTION revoke_admin_session_on_touch();
    `);

    try {
      const found = await findAdminSession(
        database.pool,
        session.plaintextToken,
        { now: new Date('2026-07-05T10:05:00.000Z') }
      );

      expect(found.isErr()).toBe(true);
      expect(found._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS trg_revoke_admin_session_on_touch
          ON admin_sessions;
        DROP FUNCTION IF EXISTS revoke_admin_session_on_touch();
      `);
    }
  }, 120_000);

  it('rejects a session whose admin is disabled while last-used tracking is updated', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const user = (
      await createAdminUser(database.pool, {
        email: 'disabled-race@example.com',
        password: 'Correct-Horse-Battery-42!'
      })
    )._unsafeUnwrap();

    const now = new Date('2026-07-05T10:00:00.000Z');
    const session = (
      await createAdminSession(database.pool, {
        adminUserId: user.id,
        ttlMs: 60 * 60 * 1000,
        now
      })
    )._unsafeUnwrap();

    await database.pool.query(`
      CREATE OR REPLACE FUNCTION disable_admin_user_on_session_touch()
      RETURNS trigger AS $$
      BEGIN
        UPDATE admin_users
        SET status = 'disabled'
        WHERE id = NEW.admin_user_id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_disable_admin_user_on_session_touch
        BEFORE UPDATE OF last_used_at ON admin_sessions
        FOR EACH ROW EXECUTE FUNCTION disable_admin_user_on_session_touch();
    `);

    try {
      const found = await findAdminSession(
        database.pool,
        session.plaintextToken,
        { now: new Date('2026-07-05T10:05:00.000Z') }
      );

      expect(found.isErr()).toBe(true);
      expect(found._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS trg_disable_admin_user_on_session_touch
          ON admin_sessions;
        DROP FUNCTION IF EXISTS disable_admin_user_on_session_touch();
      `);
    }
  }, 120_000);

  it('stores bootstrap tokens hash-only and enforces expiry and single-use', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const now = new Date('2026-07-05T10:00:00.000Z');
    const created = await createBootstrapToken(database.pool, {
      ttlMs: 10 * 60 * 1000,
      now
    });

    expect(created.isOk()).toBe(true);
    const { plaintextToken, token } = created._unsafeUnwrap();
    expect(plaintextToken).toMatch(/^pgm-admin-bootstrap-/);
    expect(token).not.toHaveProperty('tokenHash');

    const row = await database.pool.query<{
      token_hash: string;
      attempt_count: number;
    }>(
      'SELECT token_hash, attempt_count FROM admin_bootstrap_tokens WHERE id = $1',
      [token.id]
    );
    expect(row.rows[0]?.token_hash).not.toBe(plaintextToken);
    expect(row.rows[0]?.token_hash).not.toContain(plaintextToken);

    const wrong = await consumeBootstrapToken(database.pool, 'not-the-token', {
      now
    });
    expect(wrong.isErr()).toBe(true);
    expect(wrong._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);

    const afterWrongAttempt = await database.pool.query<{
      attempt_count: number;
    }>('SELECT attempt_count FROM admin_bootstrap_tokens WHERE id = $1', [
      token.id
    ]);
    expect(afterWrongAttempt.rows[0]?.attempt_count).toBe(1);

    const consumed = await consumeBootstrapToken(
      database.pool,
      plaintextToken,
      {
        now
      }
    );
    expect(consumed.isOk()).toBe(true);
    expect(consumed._unsafeUnwrap().consumedAt).not.toBeNull();

    const reused = await consumeBootstrapToken(database.pool, plaintextToken, {
      now
    });
    expect(reused.isErr()).toBe(true);
    expect(reused._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);

    const expiring = (
      await createBootstrapToken(database.pool, {
        ttlMs: 1,
        now
      })
    )._unsafeUnwrap();

    const expired = await consumeBootstrapToken(
      database.pool,
      expiring.plaintextToken,
      { now: new Date('2026-07-05T10:00:01.000Z') }
    );
    expect(expired.isErr()).toBe(true);
    expect(expired._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);
  }, 120_000);

  it('checks bootstrap tokens before hashing first-admin passwords', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const hashSpy = vi.spyOn(argon2, 'hash');

    try {
      const firstAdmin = await createFirstAdminWithBootstrapToken(
        database.pool,
        {
          bootstrapToken: 'pgm-admin-bootstrap-invalid',
          email: 'bootstrap-dos@example.com',
          password: 'Correct-Horse-Battery-42!'
        }
      );

      expect(firstAdmin.isErr()).toBe(true);
      expect(firstAdmin._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);
      expect(hashSpy).not.toHaveBeenCalled();
    } finally {
      hashSpy.mockRestore();
    }
  }, 120_000);

  it('atomically consumes bootstrap token while creating a pending-MFA first admin', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const now = new Date('2026-07-05T10:00:00.000Z');
    const bootstrap = (
      await createBootstrapToken(database.pool, {
        ttlMs: 10 * 60 * 1000,
        now
      })
    )._unsafeUnwrap();

    const firstAdmin = await createFirstAdminWithBootstrapToken(database.pool, {
      bootstrapToken: bootstrap.plaintextToken,
      email: 'first@example.com',
      displayName: 'First Admin',
      password: 'Correct-Horse-Battery-42!',
      now
    });

    expect(firstAdmin.isOk()).toBe(true);
    const user = firstAdmin._unsafeUnwrap();
    expect(user).toMatchObject({
      email: 'first@example.com',
      status: 'pending_mfa',
      mfaRequired: true
    });

    const state = await database.pool.query<{
      consumed_at: Date | null;
      status: string;
    }>(
      `
        SELECT bt.consumed_at, au.status
        FROM admin_bootstrap_tokens bt
        CROSS JOIN admin_users au
        WHERE bt.id = $1
      `,
      [bootstrap.token.id]
    );
    expect(state.rows[0]?.consumed_at).toBeInstanceOf(Date);
    expect(state.rows[0]?.status).toBe('pending_mfa');

    const reused = await createFirstAdminWithBootstrapToken(database.pool, {
      bootstrapToken: bootstrap.plaintextToken,
      email: 'second@example.com',
      password: 'Correct-Horse-Battery-42!',
      now
    });
    expect(reused.isErr()).toBe(true);

    const count = await database.pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM admin_users'
    );
    expect(count.rows[0]?.count).toBe('1');
  }, 120_000);

  it('serializes first-admin setup so concurrent attempts cannot create two admins', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const now = new Date('2026-07-05T10:00:00.000Z');
    const bootstrap = (
      await createBootstrapToken(database.pool, {
        ttlMs: 10 * 60 * 1000,
        now
      })
    )._unsafeUnwrap();

    const attempts = await Promise.all([
      createFirstAdminWithBootstrapToken(database.pool, {
        bootstrapToken: bootstrap.plaintextToken,
        email: 'first-a@example.com',
        password: 'Correct-Horse-Battery-42!',
        now
      }),
      createFirstAdminWithBootstrapToken(database.pool, {
        bootstrapToken: bootstrap.plaintextToken,
        email: 'first-b@example.com',
        password: 'Correct-Horse-Battery-42!',
        now
      })
    ]);

    expect(attempts.filter((result) => result.isOk())).toHaveLength(1);
    expect(attempts.filter((result) => result.isErr())).toHaveLength(1);

    const counts = await database.pool.query<{
      admin_count: string;
      consumed_count: string;
    }>(
      `
        SELECT
          (SELECT COUNT(*)::text FROM admin_users) AS admin_count,
          (SELECT COUNT(*)::text FROM admin_bootstrap_tokens WHERE consumed_at IS NOT NULL) AS consumed_count
      `
    );
    expect(counts.rows[0]).toMatchObject({
      admin_count: '1',
      consumed_count: '1'
    });
  }, 120_000);

  it('does not treat ordinary Postgram API keys as admin sessions or bootstrap tokens', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const apiKey = (
      await createKey(database.pool, {
        name: 'ordinary-api-key',
        scopes: ['read'],
        allowedVisibility: ['shared']
      })
    )._unsafeUnwrap();

    const session = await findAdminSession(database.pool, apiKey.plaintextKey);
    expect(session.isErr()).toBe(true);
    expect(session._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);

    const firstAdmin = await createFirstAdminWithBootstrapToken(database.pool, {
      bootstrapToken: apiKey.plaintextKey,
      email: 'api-key-admin@example.com',
      password: 'Correct-Horse-Battery-42!'
    });
    expect(firstAdmin.isErr()).toBe(true);
    expect(firstAdmin._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);
  }, 120_000);

  it('verifies TOTP enrollment before activating the pending first admin session', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const now = new Date('2026-07-05T10:00:00.000Z');
    const bootstrap = (
      await createBootstrapToken(database.pool, {
        ttlMs: 10 * 60 * 1000,
        now
      })
    )._unsafeUnwrap();
    const firstAdmin = (
      await createFirstAdminWithBootstrapToken(database.pool, {
        bootstrapToken: bootstrap.plaintextToken,
        email: 'mfa-first@example.com',
        password: 'Correct-Horse-Battery-42!',
        now
      })
    )._unsafeUnwrap();
    const session = (
      await createAdminSession(database.pool, {
        adminUserId: firstAdmin.id,
        ttlMs: 60 * 60 * 1000,
        now
      })
    )._unsafeUnwrap();

    const enrollment = await beginAdminTotpEnrollment(database.pool, {
      adminUserId: firstAdmin.id,
      accountName: firstAdmin.email,
      issuer: 'Postgram',
      secretKey: ADMIN_MFA_SECRET_KEY,
      now
    });
    expect(enrollment.isOk()).toBe(true);
    const pendingFactor = enrollment._unsafeUnwrap();
    expect(pendingFactor.factor).toMatchObject({
      type: 'totp',
      status: 'pending'
    });
    expect(pendingFactor.factor).not.toHaveProperty('secretCiphertext');

    const storedSecret = await database.pool.query<{
      secret_ciphertext: string | null;
    }>(
      'SELECT secret_ciphertext FROM admin_mfa_factors WHERE id = $1',
      [pendingFactor.factor.id]
    );
    expect(storedSecret.rows[0]?.secret_ciphertext).toMatch(/^totp:v1:/u);
    expect(storedSecret.rows[0]?.secret_ciphertext).not.toContain(
      pendingFactor.secret
    );

    const rejected = await verifyAdminTotpEnrollment(database.pool, {
      adminUserId: firstAdmin.id,
      sessionId: session.session.id,
      factorId: pendingFactor.factor.id,
      code: '000000',
      secretKey: ADMIN_MFA_SECRET_KEY,
      now
    });
    expect(rejected.isErr()).toBe(true);
    expect(rejected._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);

    const failedAttempts = await database.pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM admin_auth_attempts
        WHERE admin_user_id = $1
          AND attempt_type = 'mfa'
          AND succeeded = false
      `,
      [firstAdmin.id]
    );
    expect(failedAttempts.rows[0]?.count).toBe('1');

    const afterRejected = await database.pool.query<{
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
        WHERE u.id = $1
      `,
      [firstAdmin.id]
    );
    expect(afterRejected.rows[0]).toMatchObject({
      user_status: 'pending_mfa',
      factor_status: 'pending',
      mfa_verified_at: null
    });

    const verified = await verifyAdminTotpEnrollment(database.pool, {
      adminUserId: firstAdmin.id,
      sessionId: session.session.id,
      factorId: pendingFactor.factor.id,
      code: generateTotpCode(pendingFactor.secret, { now }),
      secretKey: ADMIN_MFA_SECRET_KEY,
      now
    });
    expect(verified.isOk()).toBe(true);
    expect(verified._unsafeUnwrap()).toMatchObject({
      user: {
        status: 'active'
      },
      factor: {
        status: 'verified'
      },
      session: {
        mfaVerifiedAt: now.toISOString()
      }
    });

    const stored = await database.pool.query<{
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
        WHERE u.id = $1
      `,
      [firstAdmin.id]
    );
    expect(stored.rows[0]).toMatchObject({
      user_status: 'active',
      factor_status: 'verified'
    });
    expect(stored.rows[0]?.mfa_verified_at?.toISOString()).toBe(
      now.toISOString()
    );
  }, 120_000);

  it('challenges verified TOTP factors without accepting missing or invalid factors', async () => {
    if (!database) {
      throw new Error('test database not initialized');
    }

    const now = new Date('2026-07-05T10:00:00.000Z');
    const user = (
      await createAdminUser(database.pool, {
        email: 'challenge@example.com',
        password: 'Correct-Horse-Battery-42!'
      })
    )._unsafeUnwrap();
    const session = (
      await createAdminSession(database.pool, {
        adminUserId: user.id,
        ttlMs: 60 * 60 * 1000,
        now
      })
    )._unsafeUnwrap();

    const missingFactor = await verifyAdminTotpChallenge(database.pool, {
      adminUserId: user.id,
      sessionId: session.session.id,
      code: '123456',
      secretKey: ADMIN_MFA_SECRET_KEY,
      now
    });
    expect(missingFactor.isErr()).toBe(true);
    expect(missingFactor._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);

    const afterMissingFactor = await database.pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM admin_auth_attempts
        WHERE admin_user_id = $1
          AND attempt_type = 'mfa'
          AND succeeded = false
      `,
      [user.id]
    );
    expect(afterMissingFactor.rows[0]?.count).toBe('1');

    const enrollment = (
      await beginAdminTotpEnrollment(database.pool, {
        adminUserId: user.id,
        accountName: user.email,
        issuer: 'Postgram',
        secretKey: ADMIN_MFA_SECRET_KEY,
        now
      })
    )._unsafeUnwrap();
    await verifyAdminTotpEnrollment(database.pool, {
      adminUserId: user.id,
      sessionId: session.session.id,
      factorId: enrollment.factor.id,
      code: generateTotpCode(enrollment.secret, { now }),
      secretKey: ADMIN_MFA_SECRET_KEY,
      now
    });

    const loginSession = (
      await createAdminSession(database.pool, {
        adminUserId: user.id,
        ttlMs: 60 * 60 * 1000,
        now
      })
    )._unsafeUnwrap();

    const wrongCode = await verifyAdminTotpChallenge(database.pool, {
      adminUserId: user.id,
      sessionId: loginSession.session.id,
      code: '000000',
      secretKey: ADMIN_MFA_SECRET_KEY,
      now
    });
    expect(wrongCode.isErr()).toBe(true);
    expect(wrongCode._unsafeUnwrapErr().code).toBe(ErrorCode.UNAUTHORIZED);

    const afterWrongCode = await database.pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM admin_auth_attempts
        WHERE admin_user_id = $1
          AND attempt_type = 'mfa'
          AND succeeded = false
      `,
      [user.id]
    );
    expect(afterWrongCode.rows[0]?.count).toBe('2');

    const challenge = await verifyAdminTotpChallenge(database.pool, {
      adminUserId: user.id,
      sessionId: loginSession.session.id,
      code: generateTotpCode(enrollment.secret, { now }),
      secretKey: ADMIN_MFA_SECRET_KEY,
      now
    });
    expect(challenge.isOk()).toBe(true);
    expect(challenge._unsafeUnwrap().session.mfaVerifiedAt).toBe(
      now.toISOString()
    );
  }, 120_000);

  it('evaluates recent step-up freshness from the session MFA timestamp', () => {
    const now = new Date('2026-07-05T10:00:00.000Z');
    const ttlMs = 10 * 60 * 1000;

    expect(isAdminStepUpFresh(null, { now, ttlMs })).toBe(false);
    expect(
      isAdminStepUpFresh('2026-07-05T09:51:00.001Z', {
        now,
        ttlMs
      })
    ).toBe(true);
    expect(
      isAdminStepUpFresh('2026-07-05T10:00:00.001Z', {
        now,
        ttlMs
      })
    ).toBe(false);
    expect(
      isAdminStepUpFresh('2026-07-05T09:49:59.999Z', {
        now,
        ttlMs
      })
    ).toBe(false);
    expect(
      isAdminStepUpFresh('not-a-date', {
        now,
        ttlMs
      })
    ).toBe(false);
  });
});
