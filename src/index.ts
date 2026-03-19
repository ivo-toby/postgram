import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Pool } from 'pg';

import { createAuthMiddleware } from './auth/middleware.js';
import type { AuthContext } from './auth/types.js';
import { registerRestRoutes } from './transport/rest.js';
import {
  AppError,
  ErrorCode,
  normalizeError,
  toErrorResponse,
  toHttpStatus
} from './util/errors.js';

type HealthStatus = {
  postgres: 'connected' | 'disconnected';
  embeddingModel: string | null;
};

type AppVariables = {
  auth: AuthContext;
};

type AppOptions = {
  pool?: Pool;
  getHealthStatus?: () => Promise<HealthStatus> | HealthStatus;
};

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

function getDefaultHealthStatus(): HealthStatus {
  return {
    postgres: 'disconnected',
    embeddingModel: null
  };
}

export function createApp(
  options: AppOptions = {}
): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  const getHealthStatus = options.getHealthStatus ?? getDefaultHealthStatus;

  app.onError((error, c) => {
    const appError = normalizeError(error);
    return c.json(
      toErrorResponse(appError),
      toHttpStatus(appError.code) as ContentfulStatusCode
    );
  });

  app.notFound((c) =>
    c.json(
      toErrorResponse(new AppError(ErrorCode.NOT_FOUND, 'Route not found')),
      404
    )
  );

  app.get('/health', async (c) => {
    const health = await getHealthStatus();

    if (health.postgres === 'disconnected') {
      return c.json(
        {
          status: 'degraded',
          postgres: 'disconnected'
        },
        503
      );
    }

    return c.json({
      status: 'ok',
      version: '0.1.0',
      postgres: health.postgres,
      embedding_model: health.embeddingModel ?? DEFAULT_EMBEDDING_MODEL
    });
  });

  if (options.pool) {
    app.use('/api/*', createAuthMiddleware({ pool: options.pool }));
    registerRestRoutes(app, options.pool);
  }

  return app;
}
