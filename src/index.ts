import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import {
  normalizeError,
  toErrorResponse,
  toHttpStatus
} from './util/errors.js';

type HealthStatus = {
  postgres: 'connected' | 'disconnected';
  embeddingModel: string | null;
};

type AppVariables = {
  auth: unknown;
};

type AppOptions = {
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

  return app;
}
