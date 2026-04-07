import { pathToFileURL } from 'node:url';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Pool } from 'pg';

import { createAuthMiddleware } from './auth/middleware.js';
import type { AuthContext } from './auth/types.js';
import { loadConfig } from './config.js';
import { checkDatabaseHealth, createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import type { EmbeddingService } from './services/embedding-service.js';
import { createEmbeddingService } from './services/embedding-service.js';
import { createEnrichmentWorker } from './services/enrichment-worker.js';
import { registerMcpRoutes } from './transport/mcp.js';
import { registerRestRoutes } from './transport/rest.js';
import { createLogger } from './util/logger.js';
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
  embeddingService?: EmbeddingService | undefined;
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
    registerRestRoutes(app, options.pool, {
      embeddingService: options.embeddingService
    });
    registerMcpRoutes(app, options.pool, {
      embeddingService: options.embeddingService
    });
  }

  return app;
}

export async function createHealthStatus(pool: Pool): Promise<HealthStatus> {
  const postgres = await checkDatabaseHealth(pool);

  if (postgres === 'disconnected') {
    return {
      postgres,
      embeddingModel: null
    };
  }

  const modelResult = await pool.query<{ name: string }>(
    `
      SELECT name
      FROM embedding_models
      WHERE is_active = true
      LIMIT 1
    `
  );

  return {
    postgres,
    embeddingModel: modelResult.rows[0]?.name ?? null
  };
}

export async function startServer(): Promise<{
  close: () => Promise<void>;
}> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const pool = createPool(config.DATABASE_URL);

  await runMigrations(pool);

  const embeddingService = createEmbeddingService();

  try {
    const activeModel = await embeddingService.getActiveModel(pool);
    await embeddingService.embedQuery('startup validation', activeModel);
    logger.info('embedding service validated');
  } catch (error) {
    logger.warn(
      { err: error },
      'embedding service unavailable — enrichment and semantic search will fail until embeddings recover'
    );
  }

  let callLlm: ((prompt: string) => Promise<string>) | undefined;
  if (config.EXTRACTION_ENABLED) {
    const { createLlmProvider } = await import('./services/llm-provider.js');
    callLlm = createLlmProvider({
      provider: config.EXTRACTION_PROVIDER,
      model: config.EXTRACTION_MODEL,
      openaiApiKey: config.OPENAI_API_KEY,
      anthropicApiKey: config.ANTHROPIC_API_KEY,
      ollamaBaseUrl: config.OLLAMA_BASE_URL,
      ollamaApiKey: config.OLLAMA_API_KEY
    });
    logger.info(
      { provider: config.EXTRACTION_PROVIDER, model: config.EXTRACTION_MODEL },
      'LLM extraction enabled'
    );
  }

  const worker = createEnrichmentWorker({
    pool,
    embeddingService,
    extractionEnabled: config.EXTRACTION_ENABLED,
    callLlm
  });
  const interval = setInterval(() => {
    void worker.runOnce().catch((error) => {
      logger.error({ err: error }, 'enrichment worker iteration failed');
    });
  }, config.ENRICHMENT_POLL_INTERVAL_MS);

  const app = createApp({
    pool,
    embeddingService,
    getHealthStatus: () => createHealthStatus(pool)
  });

  const server = serve({
    fetch: app.fetch,
    hostname: '0.0.0.0',
    port: config.PORT
  });

  logger.info({ port: config.PORT }, 'postgram server started');

  const close = async () => {
    clearInterval(interval);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await pool.end();
  };

  process.once('SIGTERM', () => {
    void close();
  });
  process.once('SIGINT', () => {
    void close();
  });

  return { close };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
