import type { Context, Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Pool } from 'pg';
import { z } from 'zod';

import {
  createAdminSession,
  createFirstAdminWithBootstrapToken,
  invalidateAdminSession,
  verifyAdminPassword,
  type AdminUserRecord
} from '../auth/admin-service.js';
import {
  beginAdminTotpEnrollment,
  verifyAdminTotpChallenge,
  verifyAdminTotpEnrollment,
  verifyAdminTotpStepUp,
  type AdminMfaFactorRecord
} from '../auth/admin-mfa-service.js';
import {
  ADMIN_STEP_UP_TTL_MS,
  ADMIN_SESSION_COOKIE,
  createAdminSessionMiddleware,
  issueAdminCsrfToken,
  setAdminNoStoreHeaders,
  type AdminRequestContext
} from '../auth/admin-middleware.js';
import {
  AppError,
  ErrorCode,
  toErrorResponse,
  toHttpStatus
} from '../util/errors.js';
import {
  registerAdminProviderConfigRoutes,
  type AdminProviderConfigRouteOptions
} from './admin-provider-config.js';

type AdminApp = Hono<{
  Variables: {
    admin: AdminRequestContext;
  };
}>;

type AdminRouteOptions = AdminProviderConfigRouteOptions & {
  adminMfaSecretKey?: string | undefined;
};

type BootstrapState =
  | 'configured'
  | 'locked'
  | 'misconfigured'
  | 'unbootstrapped';

type RateLimitedAttemptType = 'bootstrap' | 'login' | 'mfa' | 'step_up';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const ADMIN_MFA_SECRET_KEY_MIN_LENGTH = 32;
const LOCAL_INSECURE_COOKIE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const bootstrapSetupSchema = z
  .object({
    bootstrapToken: z.string().optional(),
    email: z.string().min(1),
    password: z.string().min(1),
    displayName: z.string().trim().min(1).max(120).optional()
  })
  .strict();

const loginSchema = z
  .object({
    email: z.string().min(1),
    password: z.string().min(1)
  })
  .strict();

const mfaVerifySchema = z
  .object({
    factorId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/u)
  })
  .strict();

const mfaChallengeSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/u)
  })
  .strict();

function parseJsonBody<T>(schema: z.ZodSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new AppError(
      ErrorCode.VALIDATION,
      parsed.error.issues[0]?.message ?? 'Invalid request'
    );
  }

  return parsed.data;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError(ErrorCode.VALIDATION, 'Expected JSON request body');
  }
}

function toAdminUserResponse(user: AdminUserRecord) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    mfaRequired: user.mfaRequired
  };
}

function toSessionResponse(session: AdminRequestContext['session']) {
  return {
    id: session.id,
    expiresAt: session.expiresAt,
    mfaVerified: session.mfaVerifiedAt !== null
  };
}

function toMfaFactorResponse(factor: AdminMfaFactorRecord) {
  return {
    id: factor.id,
    type: factor.type,
    status: factor.status,
    createdAt: factor.createdAt,
    verifiedAt: factor.verifiedAt
  };
}

function toStepUpResponse(session: AdminRequestContext['session']) {
  const verifiedAt = session.mfaVerifiedAt;
  return {
    fresh: verifiedAt !== null,
    expiresAt:
      verifiedAt === null
        ? null
        : new Date(Date.parse(verifiedAt) + ADMIN_STEP_UP_TTL_MS).toISOString()
  };
}

function shouldUseSecureCookie(c: Context): boolean {
  const url = new URL(c.req.url);
  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');

  if (url.protocol === 'https:') {
    return true;
  }

  return !LOCAL_INSECURE_COOKIE_HOSTS.has(hostname);
}

function setAdminSessionCookie(
  c: Context,
  plaintextToken: string,
  ttlMs: number
): void {
  setCookie(c, ADMIN_SESSION_COOKIE, plaintextToken, {
    httpOnly: true,
    maxAge: Math.floor(ttlMs / 1000),
    path: '/admin',
    sameSite: 'Lax',
    secure: shouldUseSecureCookie(c)
  });
}

function clearAdminSessionCookie(c: Context): void {
  setCookie(c, ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/admin',
    sameSite: 'Lax',
    secure: shouldUseSecureCookie(c)
  });
}

function safeBootstrapError(): AppError {
  return new AppError(
    ErrorCode.UNAUTHORIZED,
    'Unable to complete bootstrap setup'
  );
}

function safeLoginError(): AppError {
  return new AppError(ErrorCode.UNAUTHORIZED, 'Unable to sign in');
}

function rateLimitError(type: RateLimitedAttemptType): AppError {
  return new AppError(
    ErrorCode.RATE_LIMITED,
    type === 'bootstrap'
      ? 'Too many bootstrap attempts'
      : type === 'login'
        ? 'Too many login attempts'
        : type === 'mfa'
          ? 'Too many MFA attempts'
          : 'Too many step-up attempts'
  );
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

async function getBootstrapState(pool: Pool): Promise<BootstrapState> {
  const adminCount = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM admin_users'
  );

  if (adminCount.rows[0]?.count !== '0') {
    return 'configured';
  }

  const availableToken = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM admin_bootstrap_tokens
      WHERE consumed_at IS NULL
        AND invalidated_at IS NULL
        AND expires_at > now()
      LIMIT 1
    `
  );

  return availableToken.rows.length > 0 ? 'unbootstrapped' : 'locked';
}

async function isRateLimited(
  pool: Pool,
  input: {
    attemptType: RateLimitedAttemptType;
    identifier?: string | undefined;
    now: Date;
  }
): Promise<boolean> {
  const since = new Date(input.now.getTime() - RATE_LIMIT_WINDOW_MS);
  const result = await pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM admin_auth_attempts
      WHERE attempt_type = $1
        AND succeeded = false
        AND created_at >= $2
        AND (
          $3::boolean = true
          OR identifier = $4
        )
    `,
    [
      input.attemptType,
      since,
      input.identifier === undefined,
      input.identifier ?? null
    ]
  );

  return (
    Number.parseInt(result.rows[0]?.count ?? '0', 10) >= MAX_FAILED_ATTEMPTS
  );
}

async function recordAdminAuthAttempt(
  pool: Pool,
  input: {
    attemptType: RateLimitedAttemptType;
    succeeded: boolean;
    identifier?: string | undefined;
    adminUserId?: string | undefined;
    now: Date;
  }
): Promise<void> {
  await pool.query(
    `
      INSERT INTO admin_auth_attempts (
        admin_user_id,
        attempt_type,
        identifier,
        succeeded,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      input.adminUserId ?? null,
      input.attemptType,
      input.identifier ?? null,
      input.succeeded,
      input.now
    ]
  );
}

function safeMfaError(): AppError {
  return new AppError(ErrorCode.UNAUTHORIZED, 'Unable to verify MFA challenge');
}

function activeAdminMfaError(): AppError {
  return new AppError(ErrorCode.FORBIDDEN, 'Active admin MFA is required');
}

function adminMfaVerificationError(): AppError {
  return new AppError(
    ErrorCode.FORBIDDEN,
    'Admin MFA verification is required'
  );
}

function requireAdminMfaSecretKey(secretKey: string | undefined): string {
  if (!secretKey || secretKey.trim().length < ADMIN_MFA_SECRET_KEY_MIN_LENGTH) {
    throw new AppError(
      ErrorCode.INTERNAL,
      'Admin MFA secret key is not configured'
    );
  }

  return secretKey;
}

function jsonError(c: Context, error: AppError, status?: ContentfulStatusCode) {
  return c.json(
    toErrorResponse(error),
    status ?? (toHttpStatus(error.code) as ContentfulStatusCode)
  );
}

export function registerAdminRoutes(
  app: AdminApp,
  pool: Pool,
  options: AdminRouteOptions = {}
): void {
  app.get('/admin/api/bootstrap/status', async (c) => {
    setAdminNoStoreHeaders(c);
    try {
      return c.json({ state: await getBootstrapState(pool) });
    } catch {
      return c.json({ state: 'misconfigured' satisfies BootstrapState });
    }
  });

  app.post('/admin/api/bootstrap/setup', async (c) => {
    setAdminNoStoreHeaders(c);
    const now = new Date();
    const body = parseJsonBody(bootstrapSetupSchema, await readJson(c));

    if (
      await isRateLimited(pool, {
        attemptType: 'bootstrap',
        now
      })
    ) {
      throw rateLimitError('bootstrap');
    }

    if (!body.bootstrapToken) {
      await recordAdminAuthAttempt(pool, {
        attemptType: 'bootstrap',
        succeeded: false,
        now
      });
      throw safeBootstrapError();
    }

    const firstAdmin = await createFirstAdminWithBootstrapToken(pool, {
      bootstrapToken: body.bootstrapToken,
      email: body.email,
      password: body.password,
      now,
      ...(body.displayName !== undefined
        ? { displayName: body.displayName }
        : {})
    });

    if (firstAdmin.isErr() && firstAdmin.error.code === ErrorCode.INTERNAL) {
      throw firstAdmin.error;
    }

    if (firstAdmin.isErr()) {
      if (firstAdmin.error.code !== ErrorCode.UNAUTHORIZED) {
        await recordAdminAuthAttempt(pool, {
          attemptType: 'bootstrap',
          succeeded: false,
          now
        });
      }

      throw safeBootstrapError();
    }

    const session = await createAdminSession(pool, {
      adminUserId: firstAdmin.value.id,
      ttlMs: SESSION_TTL_MS,
      now
    });

    if (session.isErr()) {
      throw session.error;
    }

    setAdminSessionCookie(c, session.value.plaintextToken, SESSION_TTL_MS);
    return c.json(
      {
        state: 'mfa_required',
        user: toAdminUserResponse(firstAdmin.value),
        session: toSessionResponse(session.value.session),
        csrfToken: issueAdminCsrfToken(session.value.plaintextToken)
      },
      201
    );
  });

  app.post('/admin/api/session/login', async (c) => {
    setAdminNoStoreHeaders(c);
    const now = new Date();
    const body = parseJsonBody(loginSchema, await readJson(c));
    const identifier = normalizeIdentifier(body.email);

    if (
      (await isRateLimited(pool, {
        attemptType: 'login',
        now
      })) ||
      (await isRateLimited(pool, {
        attemptType: 'login',
        identifier,
        now
      }))
    ) {
      throw rateLimitError('login');
    }

    const verified = await verifyAdminPassword(pool, {
      email: body.email,
      password: body.password
    });

    if (verified.isErr()) {
      if (verified.error.code === ErrorCode.INTERNAL) {
        throw verified.error;
      }

      await recordAdminAuthAttempt(pool, {
        attemptType: 'login',
        identifier,
        succeeded: false,
        now
      });
      throw safeLoginError();
    }

    await recordAdminAuthAttempt(pool, {
      adminUserId: verified.value.id,
      attemptType: 'login',
      identifier,
      succeeded: true,
      now
    });

    const session = await createAdminSession(pool, {
      adminUserId: verified.value.id,
      ttlMs: SESSION_TTL_MS,
      now
    });

    if (session.isErr()) {
      throw session.error;
    }

    setAdminSessionCookie(c, session.value.plaintextToken, SESSION_TTL_MS);
    return c.json({
      user: toAdminUserResponse(verified.value),
      session: toSessionResponse(session.value.session),
      csrfToken: issueAdminCsrfToken(session.value.plaintextToken)
    });
  });

  app.get(
    '/admin/api/session/current',
    createAdminSessionMiddleware({ pool, enforceCsrf: false }),
    (c) => {
      const admin = c.get('admin');
      setAdminNoStoreHeaders(c);
      return c.json({
        user: toAdminUserResponse(admin.user),
        session: toSessionResponse(admin.session)
      });
    }
  );

  app.get(
    '/admin/api/session/csrf',
    createAdminSessionMiddleware({ pool, enforceCsrf: false }),
    (c) => {
      const admin = c.get('admin');
      setAdminNoStoreHeaders(c);
      return c.json({
        csrfToken: issueAdminCsrfToken(admin.sessionToken)
      });
    }
  );

  app.post(
    '/admin/api/session/mfa/enroll',
    createAdminSessionMiddleware({ pool }),
    async (c) => {
      const admin = c.get('admin');
      setAdminNoStoreHeaders(c);

      const enrollment = await beginAdminTotpEnrollment(pool, {
        adminUserId: admin.user.id,
        accountName: admin.user.email,
        issuer: 'Postgram',
        secretKey: requireAdminMfaSecretKey(options.adminMfaSecretKey)
      });

      if (enrollment.isErr()) {
        throw enrollment.error;
      }

      return c.json(
        {
          factor: toMfaFactorResponse(enrollment.value.factor),
          secret: enrollment.value.secret,
          otpauthUrl: enrollment.value.otpauthUrl
        },
        201
      );
    }
  );

  app.post(
    '/admin/api/session/mfa/verify',
    createAdminSessionMiddleware({ pool }),
    async (c) => {
      const admin = c.get('admin');
      setAdminNoStoreHeaders(c);
      const now = new Date();
      const body = parseJsonBody(mfaVerifySchema, await readJson(c));

      if (
        await isRateLimited(pool, {
          attemptType: 'mfa',
          identifier: admin.user.id,
          now
        })
      ) {
        throw rateLimitError('mfa');
      }

      const verified = await verifyAdminTotpEnrollment(pool, {
        adminUserId: admin.user.id,
        sessionId: admin.session.id,
        factorId: body.factorId,
        code: body.code,
        secretKey: requireAdminMfaSecretKey(options.adminMfaSecretKey),
        now
      });

      if (verified.isErr()) {
        if (verified.error.code === ErrorCode.INTERNAL) {
          throw verified.error;
        }

        throw safeMfaError();
      }

      return c.json({
        user: toAdminUserResponse(verified.value.user),
        session: toSessionResponse(verified.value.session),
        factor: toMfaFactorResponse(verified.value.factor),
        stepUp: toStepUpResponse(verified.value.session)
      });
    }
  );

  app.post(
    '/admin/api/session/mfa/challenge',
    createAdminSessionMiddleware({ pool }),
    async (c) => {
      const admin = c.get('admin');
      setAdminNoStoreHeaders(c);
      const now = new Date();
      const body = parseJsonBody(mfaChallengeSchema, await readJson(c));

      if (admin.user.status !== 'active' || !admin.user.mfaRequired) {
        return jsonError(c, activeAdminMfaError());
      }

      if (
        await isRateLimited(pool, {
          attemptType: 'mfa',
          identifier: admin.user.id,
          now
        })
      ) {
        throw rateLimitError('mfa');
      }

      const challenge = await verifyAdminTotpChallenge(pool, {
        adminUserId: admin.user.id,
        sessionId: admin.session.id,
        code: body.code,
        secretKey: requireAdminMfaSecretKey(options.adminMfaSecretKey),
        now
      });

      if (challenge.isErr()) {
        if (challenge.error.code === ErrorCode.INTERNAL) {
          throw challenge.error;
        }

        throw safeMfaError();
      }

      return c.json({
        user: toAdminUserResponse(challenge.value.user),
        session: toSessionResponse(challenge.value.session),
        stepUp: toStepUpResponse(challenge.value.session)
      });
    }
  );

  app.post(
    '/admin/api/session/step-up',
    createAdminSessionMiddleware({ pool }),
    async (c) => {
      const admin = c.get('admin');
      setAdminNoStoreHeaders(c);
      const now = new Date();
      const body = parseJsonBody(mfaChallengeSchema, await readJson(c));

      if (admin.user.status !== 'active' || !admin.user.mfaRequired) {
        return jsonError(c, activeAdminMfaError());
      }

      if (!admin.session.mfaVerifiedAt) {
        return jsonError(c, adminMfaVerificationError());
      }

      if (
        await isRateLimited(pool, {
          attemptType: 'step_up',
          identifier: admin.user.id,
          now
        })
      ) {
        throw rateLimitError('step_up');
      }

      const stepUp = await verifyAdminTotpStepUp(pool, {
        adminUserId: admin.user.id,
        sessionId: admin.session.id,
        code: body.code,
        secretKey: requireAdminMfaSecretKey(options.adminMfaSecretKey),
        now
      });

      if (stepUp.isErr()) {
        if (stepUp.error.code === ErrorCode.INTERNAL) {
          throw stepUp.error;
        }

        throw safeMfaError();
      }

      return c.json({
        user: toAdminUserResponse(stepUp.value.user),
        session: toSessionResponse(stepUp.value.session),
        stepUp: toStepUpResponse(stepUp.value.session)
      });
    }
  );

  app.post(
    '/admin/api/session/logout',
    createAdminSessionMiddleware({ pool }),
    async (c) => {
      const admin = c.get('admin');
      const invalidated = await invalidateAdminSession(
        pool,
        admin.sessionToken
      );

      if (invalidated.isErr()) {
        if (invalidated.error.code === ErrorCode.UNAUTHORIZED) {
          setAdminNoStoreHeaders(c);
          return jsonError(
            c,
            new AppError(ErrorCode.UNAUTHORIZED, 'Invalid admin session')
          );
        }

        throw invalidated.error;
      }

      setAdminNoStoreHeaders(c);
      clearAdminSessionCookie(c);
      return c.json({ ok: true });
    }
  );

  registerAdminProviderConfigRoutes(app, pool, options);
}
