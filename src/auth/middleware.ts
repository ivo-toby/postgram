import type { MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Pool } from 'pg';

import {
  AppError,
  ErrorCode,
  toErrorResponse,
  toHttpStatus
} from '../util/errors.js';
import { touchLastUsedAt, validateKey } from './key-service.js';
import type { AuthContext } from './types.js';

type AuthVariables = {
  auth: AuthContext;
};

type AuthMiddlewareOptions = {
  pool: Pool;
};

export function createAuthMiddleware({
  pool
}: AuthMiddlewareOptions): MiddlewareHandler<{
  Variables: AuthVariables;
}> {
  return async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      const error = new AppError(
        ErrorCode.UNAUTHORIZED,
        'Missing Bearer token'
      );
      return c.json(
        toErrorResponse(error),
        toHttpStatus(error.code) as ContentfulStatusCode
      );
    }

    const token = header.slice(7);
    const validated = await validateKey(pool, token);

    if (validated.isErr()) {
      const error = validated.error;
      return c.json(
        toErrorResponse(error),
        toHttpStatus(error.code) as ContentfulStatusCode
      );
    }

    const auth = validated.value;
    c.set('auth', auth);
    if (auth.apiKeyId) void touchLastUsedAt(pool, auth.apiKeyId);
    await next();
  };
}
