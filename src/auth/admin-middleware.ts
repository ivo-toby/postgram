import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Pool } from 'pg';

import {
  findAdminSession,
  type AdminSessionRecord,
  type AdminUserRecord
} from './admin-service.js';
import {
  AppError,
  ErrorCode,
  toErrorResponse,
  toHttpStatus
} from '../util/errors.js';

export const ADMIN_SESSION_COOKIE = 'pgm_admin_session';
export const ADMIN_CSRF_HEADER = 'X-CSRF-Token';
export const ADMIN_STEP_UP_TTL_MS = 10 * 60 * 1000;

export type AdminRequestContext = {
  sessionToken: string;
  session: AdminSessionRecord;
  user: AdminUserRecord;
};

type AdminVariables = {
  admin: AdminRequestContext;
};

type AdminMiddlewareOptions = {
  pool: Pool;
  enforceCsrf?: boolean | undefined;
};

type ActiveAdminMiddlewareOptions = {
  requireStepUp?: boolean | undefined;
  stepUpTtlMs?: number | undefined;
  now?: (() => Date) | undefined;
};

const UNSAFE_METHODS = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);
const CSRF_PURPOSE = 'postgram-admin-csrf';

export function setAdminNoStoreHeaders(c: Context): void {
  c.header('Cache-Control', 'no-store, private');
  c.header('Pragma', 'no-cache');
  c.header('Vary', 'Cookie');
}

function errorResponse(c: Parameters<MiddlewareHandler>[0], error: AppError) {
  setAdminNoStoreHeaders(c);
  return c.json(
    toErrorResponse(error),
    toHttpStatus(error.code) as ContentfulStatusCode
  );
}

function signCsrfToken(sessionToken: string, nonce: string): string {
  return createHmac('sha256', sessionToken)
    .update(`${CSRF_PURPOSE}:${nonce}`, 'utf8')
    .digest('base64url');
}

export function issueAdminCsrfToken(sessionToken: string): string {
  const nonce = randomBytes(32).toString('base64url');
  return `${nonce}.${signCsrfToken(sessionToken, nonce)}`;
}

export function verifyAdminCsrfToken(
  sessionToken: string,
  csrfToken: string | undefined
): boolean {
  if (!csrfToken) {
    return false;
  }

  const [nonce, signature, extra] = csrfToken.split('.');
  if (!nonce || !signature || extra !== undefined) {
    return false;
  }

  const expected = signCsrfToken(sessionToken, nonce);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function createAdminSessionMiddleware({
  pool,
  enforceCsrf = true
}: AdminMiddlewareOptions): MiddlewareHandler<{
  Variables: AdminVariables;
}> {
  return async (c, next) => {
    const sessionToken = getCookie(c, ADMIN_SESSION_COOKIE);
    if (!sessionToken) {
      return errorResponse(
        c,
        new AppError(ErrorCode.UNAUTHORIZED, 'Missing admin session')
      );
    }

    const sessionResult = await findAdminSession(pool, sessionToken);
    if (sessionResult.isErr()) {
      const error =
        sessionResult.error.code === ErrorCode.UNAUTHORIZED
          ? new AppError(ErrorCode.UNAUTHORIZED, 'Invalid admin session')
          : sessionResult.error;
      return errorResponse(c, error);
    }

    c.set('admin', {
      sessionToken,
      session: sessionResult.value.session,
      user: sessionResult.value.user
    });

    if (enforceCsrf && UNSAFE_METHODS.has(c.req.method.toUpperCase())) {
      const csrfToken = c.req.header(ADMIN_CSRF_HEADER);
      if (!verifyAdminCsrfToken(sessionToken, csrfToken)) {
        return errorResponse(
          c,
          new AppError(ErrorCode.FORBIDDEN, 'Invalid CSRF token')
        );
      }
    }

    await next();
  };
}

export function isAdminStepUpFresh(
  mfaVerifiedAt: string | null,
  input: {
    now?: Date | undefined;
    ttlMs?: number | undefined;
  } = {}
): boolean {
  if (!mfaVerifiedAt) {
    return false;
  }

  const verifiedAtMs = Date.parse(mfaVerifiedAt);
  if (!Number.isFinite(verifiedAtMs)) {
    return false;
  }

  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? ADMIN_STEP_UP_TTL_MS;
  const ageMs = now.getTime() - verifiedAtMs;
  return ageMs >= 0 && ageMs <= ttlMs;
}

export function createActiveAdminMiddleware({
  requireStepUp = false,
  stepUpTtlMs = ADMIN_STEP_UP_TTL_MS,
  now = () => new Date()
}: ActiveAdminMiddlewareOptions = {}): MiddlewareHandler<{
  Variables: AdminVariables;
}> {
  return async (c, next) => {
    const admin = c.get('admin');
    if (admin.user.status !== 'active' || !admin.user.mfaRequired) {
      return errorResponse(
        c,
        new AppError(ErrorCode.FORBIDDEN, 'Active admin MFA is required')
      );
    }

    if (!admin.session.mfaVerifiedAt) {
      return errorResponse(
        c,
        new AppError(ErrorCode.FORBIDDEN, 'Admin MFA verification is required')
      );
    }

    if (
      requireStepUp &&
      !isAdminStepUpFresh(admin.session.mfaVerifiedAt, {
        now: now(),
        ttlMs: stepUpTtlMs
      })
    ) {
      return errorResponse(
        c,
        new AppError(ErrorCode.FORBIDDEN, 'Recent admin step-up is required')
      );
    }

    await next();
  };
}
