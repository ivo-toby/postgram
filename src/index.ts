import { pathToFileURL } from 'node:url';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Pool } from 'pg';

import { createAuthMiddleware } from './auth/middleware.js';
import { ensureFirstRunBootstrapToken } from './auth/admin-service.js';
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
import { ensureEmbeddingIdentityAgreement } from './services/embeddings/admin.js';
import { createEnrichmentWorker } from './services/enrichment-worker.js';
import {
  createProviderPolicyFetch,
  readAppliedProviderSettingKeys,
  resolveRuntimeProviderConfig,
  type ProviderConfigDnsLookup,
  type ProviderConfigFetch,
  type ProviderConfigSettingKey
} from './services/admin-provider-config-service.js';
import { registerMcpRoutes } from './transport/mcp.js';
import { registerAdminRoutes } from './transport/admin.js';
import { registerOAuthRoutes } from './transport/oauth.js';
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
  extractionEnabled?: boolean | undefined;
  oauth?:
    | {
        enabled: boolean;
        publicBaseUrl?: string | undefined;
      }
    | undefined;
  adminMfaSecretKey?: string | undefined;
  adminSettingsEncryptionKey?: string | undefined;
  runtimeConfig?: AppConfig | undefined;
  providerConfigFetch?: ProviderConfigFetch | undefined;
  providerConfigDnsLookup?: ProviderConfigDnsLookup | undefined;
  getHealthStatus?: () => Promise<HealthStatus> | HealthStatus;
};

const FIRST_RUN_BOOTSTRAP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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

export function createAppliedProviderPolicyFetch(input: {
  settingKey: ProviderConfigSettingKey;
  provider: 'ollama' | 'openai-compatible';
  baseUrl: string;
  appliedSettingKeys:
    | ReadonlySet<ProviderConfigSettingKey>
    | readonly ProviderConfigSettingKey[];
  dnsLookup?: ProviderConfigDnsLookup | undefined;
  fetchImpl?: ProviderConfigFetch | undefined;
}): ProviderConfigFetch | undefined {
  const applied =
    'has' in input.appliedSettingKeys
      ? input.appliedSettingKeys.has(input.settingKey)
      : input.appliedSettingKeys.includes(input.settingKey);

  if (!applied) {
    return undefined;
  }

  return createProviderPolicyFetch({
    settingKey: input.settingKey,
    provider: input.provider,
    baseUrl: input.baseUrl,
    dnsLookup: input.dnsLookup,
    fetchImpl: input.fetchImpl
  });
}

function describeHost(providerConfig: EmbeddingProviderConfig): string {
  return providerConfig.provider === 'ollama'
    ? providerConfig.baseUrl
    : 'api.openai.com';
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
    registerAdminRoutes(
      app as unknown as Parameters<typeof registerAdminRoutes>[0],
      options.pool,
      {
        adminMfaSecretKey: options.adminMfaSecretKey,
        adminSettingsEncryptionKey: options.adminSettingsEncryptionKey,
        runtimeConfig: options.runtimeConfig,
        providerConfigFetch: options.providerConfigFetch,
        providerConfigDnsLookup: options.providerConfigDnsLookup,
        ...(options.extractionEnabled !== undefined
          ? { extractionEnabled: options.extractionEnabled }
          : {})
      }
    );

    if (options.oauth?.enabled) {
      if (!options.oauth.publicBaseUrl) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'PUBLIC_BASE_URL is required when OAuth is enabled'
        );
      }
      registerOAuthRoutes(app, options.pool, {
        publicBaseUrl: options.oauth.publicBaseUrl
      });
    }

    app.use('/api/*', createAuthMiddleware({ pool: options.pool }));
    registerRestRoutes(app, options.pool, {
      embeddingService: options.embeddingService,
      ...(options.extractionEnabled !== undefined
        ? { extractionEnabled: options.extractionEnabled }
        : {})
    });
    registerMcpRoutes(app, options.pool, {
      embeddingService: options.embeddingService,
      resourceMetadataUrl:
        options.oauth?.enabled && options.oauth.publicBaseUrl
          ? `${options.oauth.publicBaseUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource/mcp`
          : undefined,
      ...(options.extractionEnabled !== undefined
        ? { extractionEnabled: options.extractionEnabled }
        : {})
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

  const firstRunBootstrap = await ensureFirstRunBootstrapToken(pool, {
    ttlMs: FIRST_RUN_BOOTSTRAP_TOKEN_TTL_MS
  });
  if (firstRunBootstrap.isErr()) {
    throw firstRunBootstrap.error;
  }
  const bootstrapState = firstRunBootstrap.value;
  if (bootstrapState.status === 'created') {
    logger.warn(
      {
        bootstrapToken: bootstrapState.plaintextToken,
        expiresAt: bootstrapState.token.expiresAt
      },
      'admin first-run bootstrap token generated; use the local operator logs to complete setup'
    );
  } else if (bootstrapState.status === 'existing') {
    logger.info(
      { expiresAt: bootstrapState.token.expiresAt },
      'admin first-run bootstrap token already exists; plaintext is not recoverable'
    );
  }

  const runtimeConfigResult = await resolveRuntimeProviderConfig(pool, {
    envConfig: config,
    encryptionKey: config.ADMIN_SETTINGS_ENCRYPTION_KEY
  });
  if (runtimeConfigResult.isErr()) {
    throw runtimeConfigResult.error;
  }
  const runtimeConfig = runtimeConfigResult.value;
  const appliedProviderSettingsResult = await readAppliedProviderSettingKeys(
    pool
  );
  if (appliedProviderSettingsResult.isErr()) {
    throw appliedProviderSettingsResult.error;
  }
  const appliedProviderSettingKeys = new Set(
    appliedProviderSettingsResult.value
  );

  let providerConfig = buildEmbeddingProviderConfig(runtimeConfig);
  if (providerConfig.provider === 'ollama') {
    const settingKey = runtimeConfig.EMBEDDING_BASE_URL
      ? 'EMBEDDING_BASE_URL'
      : 'OLLAMA_BASE_URL';
    const fetchImpl = createAppliedProviderPolicyFetch({
      settingKey,
      provider: 'ollama',
      baseUrl: providerConfig.baseUrl,
      appliedSettingKeys: appliedProviderSettingKeys
    });
    providerConfig = {
      ...providerConfig,
      fetchImpl
    };
  }
  const embeddingProvider: EmbeddingProvider =
    createEmbeddingProvider(providerConfig);
  const embeddingService = createEmbeddingService({
    provider: embeddingProvider
  });

  logger.info(
    {
      provider: embeddingProvider.name,
      model: embeddingProvider.model,
      dimensions: embeddingProvider.dimensions,
      host: describeHost(providerConfig)
    },
    'embedding provider active'
  );

  const mismatch = await ensureEmbeddingIdentityAgreement(pool, {
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

  let callLlm:
    | ((prompt: string, schema?: object) => Promise<string>)
    | undefined;
  let callLlmFactory:
    | ((
        provider: string | null,
        model: string | null
      ) => (prompt: string, schema?: object) => Promise<string>)
    | undefined;
  if (runtimeConfig.EXTRACTION_ENABLED) {
    const { createLlmProvider } = await import('./services/llm-provider.js');
    type ExtractionProvider = Parameters<
      typeof createLlmProvider
    >[0]['provider'];
    const allowedProviders: readonly ExtractionProvider[] = [
      'openai',
      'anthropic',
      'ollama',
      'openai-compatible'
    ];
    callLlmFactory = (providerOverride, modelOverride) => {
      const provider: ExtractionProvider =
        providerOverride &&
        (allowedProviders as readonly string[]).includes(providerOverride)
          ? (providerOverride as ExtractionProvider)
          : runtimeConfig.EXTRACTION_PROVIDER;
      const fetchImpl =
        provider === 'openai-compatible' && runtimeConfig.EXTRACTION_BASE_URL
          ? createAppliedProviderPolicyFetch({
              settingKey: 'EXTRACTION_BASE_URL',
              provider,
              baseUrl: runtimeConfig.EXTRACTION_BASE_URL,
              appliedSettingKeys: appliedProviderSettingKeys
            })
          : provider === 'ollama'
            ? createAppliedProviderPolicyFetch({
                settingKey: 'OLLAMA_BASE_URL',
                provider,
                baseUrl: runtimeConfig.OLLAMA_BASE_URL,
                appliedSettingKeys: appliedProviderSettingKeys
              })
            : undefined;
      return createLlmProvider({
        provider,
        model: modelOverride ?? runtimeConfig.EXTRACTION_MODEL,
        openaiApiKey: runtimeConfig.OPENAI_API_KEY,
        extractionBaseUrl: runtimeConfig.EXTRACTION_BASE_URL,
        extractionApiKey: runtimeConfig.EXTRACTION_API_KEY,
        anthropicApiKey: runtimeConfig.ANTHROPIC_API_KEY,
        ollamaBaseUrl: runtimeConfig.OLLAMA_BASE_URL,
        ollamaApiKey: runtimeConfig.OLLAMA_API_KEY,
        disableThinking: runtimeConfig.EXTRACTION_DISABLE_THINKING,
        reasoningEffort: runtimeConfig.EXTRACTION_REASONING_EFFORT,
        fetchImpl
      });
    };
    callLlm = callLlmFactory(null, null);
    logger.info(
      {
        provider: runtimeConfig.EXTRACTION_PROVIDER,
        model: runtimeConfig.EXTRACTION_MODEL
      },
      'LLM extraction enabled'
    );
  }

  const worker = createEnrichmentWorker({
    pool,
    embeddingService,
    extractionEnabled: runtimeConfig.EXTRACTION_ENABLED,
    extractionMemoryMode: runtimeConfig.EXTRACTION_MEMORY_MODE,
    callLlm,
    callLlmFactory,
    logger,
    autoCreate: {
      enabled: runtimeConfig.EXTRACTION_AUTO_CREATE_ENTITIES,
      types: runtimeConfig.EXTRACTION_AUTO_CREATE_TYPES,
      minConfidence: runtimeConfig.EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE,
      minConfidenceByType:
        runtimeConfig.EXTRACTION_AUTO_CREATE_MIN_CONFIDENCE_BY_TYPE
    },
    extractionMatchMinSimilarity: runtimeConfig.EXTRACTION_MATCH_MIN_SIMILARITY,
    extractionMinContentChars: runtimeConfig.EXTRACTION_MIN_CONTENT_CHARS,
    extractionDebugLog: runtimeConfig.EXTRACTION_DEBUG_LOG,
    semanticNeighbors: {
      enabled: runtimeConfig.EXTRACTION_SEMANTIC_NEIGHBORS_ENABLED,
      maxNeighbors: runtimeConfig.EXTRACTION_SEMANTIC_NEIGHBORS_MAX,
      minSimilarity: runtimeConfig.EXTRACTION_SEMANTIC_NEIGHBORS_MIN_SIMILARITY
    }
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
    extractionEnabled: runtimeConfig.EXTRACTION_ENABLED,
    adminMfaSecretKey: config.ADMIN_MFA_SECRET_KEY,
    adminSettingsEncryptionKey: config.ADMIN_SETTINGS_ENCRYPTION_KEY,
    runtimeConfig,
    oauth: {
      enabled: runtimeConfig.OAUTH_ENABLED,
      publicBaseUrl: runtimeConfig.PUBLIC_BASE_URL
    },
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
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
    }
    process.exitCode = 1;
  });
}
