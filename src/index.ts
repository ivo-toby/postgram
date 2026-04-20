import { pathToFileURL } from 'node:url';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Pool } from 'pg';

import { createAuthMiddleware } from './auth/middleware.js';
import type { AuthContext } from './auth/types.js';
import { loadConfig } from './config.js';
import type { AppConfig } from './config.js';
import { checkDatabaseHealth, createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import type { EmbeddingService } from './services/embedding-service.js';
import { createEmbeddingService } from './services/embedding-service.js';
import {
  createEmbeddingProvider,
  resolveEmbeddingDefaults,
  type EmbeddingProvider,
  type EmbeddingProviderConfig
} from './services/embeddings/providers.js';
import { assertEmbeddingDimensionAgreement } from './services/embeddings/admin.js';
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

function getDefaultHealthStatus(): HealthStatus {
  return {
    postgres: 'disconnected',
    embeddingModel: null
  };
}

export function buildEmbeddingProviderConfig(
  config: AppConfig
): EmbeddingProviderConfig {
  // Per-provider defaults apply only when BOTH model and dimensions are
  // unset. If the operator picks a non-default model, they must also declare
  // the dimension — otherwise we would silently send requests whose expected
  // length does not match the model's actual output.
  const hasExplicitModel = config.EMBEDDING_MODEL !== undefined;
  const hasExplicitDimensions = config.EMBEDDING_DIMENSIONS !== undefined;
  if (hasExplicitModel && !hasExplicitDimensions) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'EMBEDDING_MODEL is set but EMBEDDING_DIMENSIONS is not — declare the embedding dimension explicitly when overriding the model'
    );
  }

  const { model, dimensions } = resolveEmbeddingDefaults(
    config.EMBEDDING_PROVIDER,
    config.EMBEDDING_MODEL,
    config.EMBEDDING_DIMENSIONS
  );

  if (config.EMBEDDING_PROVIDER === 'openai') {
    if (!config.OPENAI_API_KEY) {
      throw new AppError(
        ErrorCode.VALIDATION,
        'OPENAI_API_KEY is required for EMBEDDING_PROVIDER=openai'
      );
    }
    return {
      provider: 'openai',
      model,
      dimensions,
      apiKey: config.OPENAI_API_KEY
    };
  }

  const baseUrl = config.EMBEDDING_BASE_URL ?? config.OLLAMA_BASE_URL;
  return {
    provider: 'ollama',
    model,
    dimensions,
    baseUrl,
    apiKey: config.EMBEDDING_API_KEY
  };
}

function describeHost(providerConfig: EmbeddingProviderConfig): string {
  return providerConfig.provider === 'ollama' ? providerConfig.baseUrl : 'api.openai.com';
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
      embedding_model: health.embeddingModel
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

  const providerConfig = buildEmbeddingProviderConfig(config);
  const embeddingProvider: EmbeddingProvider = createEmbeddingProvider(providerConfig);
  const embeddingService = createEmbeddingService({ provider: embeddingProvider });

  logger.info(
    {
      provider: embeddingProvider.name,
      model: embeddingProvider.model,
      dimensions: embeddingProvider.dimensions,
      host: describeHost(providerConfig)
    },
    'embedding provider active'
  );

  const mismatch = await assertEmbeddingDimensionAgreement(pool, {
    provider: embeddingProvider.name,
    model: embeddingProvider.model,
    dimensions: embeddingProvider.dimensions
  });
  if (mismatch) {
    logger.error(mismatch.message);
    throw new AppError(ErrorCode.VALIDATION, mismatch.message, {
      configured: mismatch.details.configured,
      activeModel: mismatch.details.activeModel
    });
  }

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
  let workerActive = true;
  const workerLoop = async () => {
    while (workerActive) {
      try {
        await worker.runOnce();
      } catch (error) {
        logger.error({ err: error }, 'enrichment worker iteration failed');
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, config.ENRICHMENT_POLL_INTERVAL_MS);
      });
    }
  };
  void workerLoop();

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
    workerActive = false;
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
    if (error instanceof AppError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exitCode = 1;
  });
}
