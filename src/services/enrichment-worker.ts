import type { Logger } from 'pino';
import type { Pool, PoolClient } from 'pg';

import type { AuthContext } from '../auth/types.js';
import type { LoaderInput } from '../types/loader.js';
import { createLogger } from '../util/logger.js';
import { chunkText } from './chunking-service.js';
import {
  createEmbeddingService,
  type EmbeddingService
} from './embedding-service.js';
import {
  extractAndLinkRelationships,
  SemanticMatchUnavailableError
} from './extraction-service.js';
import type { AttachmentStore } from './loaders/attachment-store.js';
import { persistLoaderResult } from './loaders/persist.js';
import type { LoaderRegistry } from './loaders/registry.js';

type PendingEntityRow = {
  id: string;
  content: string;
};

type PendingExtractionRow = PendingEntityRow & {
  type: string;
  visibility: string;
  owner: string | null;
  extraction_model_override: string | null;
  extraction_provider_override: string | null;
};

type CallLlm = (prompt: string, schema?: object) => Promise<string>;

/**
 * Factory used when an entity has an `extraction_model_override` or
 * `extraction_provider_override` set — typically by `pgm-admin
 * improve-graph --model X --provider Y`. Returning a function that builds a
 * `callLlm` lets the worker swap models per-entity without rebuilding
 * provider state on every call (the worker caches the result by
 * `provider:model`). When neither override is set the worker falls back to
 * `options.callLlm` (the env-configured default), so existing tests and
 * deployments don't need to provide a factory.
 */
type CallLlmFactory = (
  provider: string | null,
  model: string | null
) => CallLlm;

type EnrichmentWorkerOptions = {
  pool: Pool;
  embeddingService?: EmbeddingService;
  extractionEnabled?: boolean;
  callLlm?: CallLlm | undefined;
  callLlmFactory?: CallLlmFactory | undefined;
  logger?: Logger;
  autoCreate?: {
    enabled: boolean;
    types: readonly string[];
    minConfidence: number;
    minConfidenceByType?: Readonly<Record<string, number>> | undefined;
  };
  extractionMatchMinSimilarity?: number;
  extractionMinContentChars?: number;
  /**
   * When true, the worker passes a debug callback to extraction that logs
   * raw LLM responses and per-target decisions at info level. Used to
   * diagnose "no person entities" / "edges look wrong" without redeploying
   * with LOG_LEVEL=debug (which is much noisier).
   */
  extractionDebugLog?: boolean;
  semanticNeighbors?: {
    enabled: boolean;
    maxNeighbors?: number;
    minSimilarity?: number;
  };
  /**
   * Optional pluggable document loader stack. When configured, entities
   * created with loading_status='pending' are routed through the matching
   * loader before they enter the chunk/embed pipeline. Legacy entities
   * (loading_status NULL) skip the loading stage entirely.
   */
  loaderRegistry?: LoaderRegistry;
  attachmentStore?: AttachmentStore;
};

function buildLoaderInput(entity: {
  mime_type: string | null;
  source_uri: string | null;
}): LoaderInput | undefined {
  const uri = entity.source_uri;
  if (!uri) return undefined;
  if (uri.startsWith('file://')) {
    if (!entity.mime_type) return undefined;
    return {
      kind: 'localPath',
      path: uri.replace(/^file:\/\//, ''),
      mimeType: entity.mime_type,
      sourceUri: uri,
    };
  }
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return entity.mime_type
      ? { kind: 'url', url: uri, mimeType: entity.mime_type }
      : { kind: 'url', url: uri };
  }
  return undefined;
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original failure if rollback itself fails.
  }
}

const MAX_ERROR_LENGTH = 2000;

function truncateErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : String(error ?? 'unknown error');
  return raw.length > MAX_ERROR_LENGTH
    ? `${raw.slice(0, MAX_ERROR_LENGTH)}…`
    : raw;
}

export function createEnrichmentWorker(options: EnrichmentWorkerOptions) {
  if (options.extractionEnabled && !options.callLlm && !options.callLlmFactory) {
    throw new Error(
      'callLlm or callLlmFactory is required when extractionEnabled is true'
    );
  }

  const embeddingService = options.embeddingService ?? createEmbeddingService();
  const logger = options.logger ?? createLogger('info');

  async function hasPendingEnrichment(): Promise<boolean> {
    const result = await options.pool.query(
      `
        SELECT 1
        FROM entities
        WHERE content IS NOT NULL
          AND (
            enrichment_status = 'pending'
            OR (
              enrichment_status = 'failed'
              AND enrichment_attempts < 3
              AND updated_at < now() - interval '5 minutes'
            )
          )
        LIMIT 1
      `
    );

    return Boolean(result.rowCount);
  }

  async function processNextEnrichmentEntity(
    activeModel: Awaited<ReturnType<EmbeddingService['getActiveModel']>>
  ): Promise<boolean> {
    const client = await options.pool.connect();
    let entity: PendingEntityRow | undefined;

    try {
      await client.query('BEGIN');

      const pending = await client.query<PendingEntityRow>(
        `
          SELECT id, content
          FROM entities
          WHERE content IS NOT NULL
            AND (
              enrichment_status = 'pending'
              OR (
                enrichment_status = 'failed'
                AND enrichment_attempts < 3
                AND updated_at < now() - interval '5 minutes'
              )
            )
          ORDER BY
            CASE WHEN enrichment_status = 'pending' THEN 0 ELSE 1 END,
            created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `
      );

      entity = pending.rows[0];
      if (!entity) {
        await rollbackQuietly(client);
        return false;
      }

      const chunks = chunkText(entity.content);
      const embeddings = await embeddingService.embedBatch(
        chunks.map((chunk) => chunk.content),
        activeModel
      );

      await client.query('DELETE FROM chunks WHERE entity_id = $1', [entity.id]);

      for (const chunk of chunks) {
        const embedding = embeddings[chunk.chunkIndex];
        if (!embedding) {
          throw new Error('missing embedding for chunk');
        }

        await client.query(
          `
            INSERT INTO chunks (
              entity_id,
              chunk_index,
              content,
              embedding,
              model_id,
              token_count
            )
            VALUES ($1, $2, $3, $4::vector, $5, $6)
          `,
          [
            entity.id,
            chunk.chunkIndex,
            chunk.content,
            `[${embedding.join(',')}]`,
            activeModel.id,
            chunk.tokenCount
          ]
        );
      }

      await client.query(
        options.extractionEnabled
          ? `
              UPDATE entities
              SET enrichment_status = 'completed',
                  enrichment_attempts = 0,
                  enrichment_error = NULL,
                  -- Auto-created stubs only have a name as content. Running
                  -- extraction on them prompts the LLM with "what does Alice
                  -- relate to?" with no context, which free-associates new
                  -- stubs and loops. Skip them.
                  extraction_status = CASE
                    WHEN 'auto-created' = ANY(tags) THEN NULL
                    ELSE 'pending'
                  END,
                  extraction_error = NULL
              WHERE id = $1
            `
          : `
              UPDATE entities
              SET enrichment_status = 'completed',
                  enrichment_attempts = 0,
                  enrichment_error = NULL
              WHERE id = $1
            `,
        [entity.id]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await rollbackQuietly(client);

      if (!entity) {
        throw error;
      }

      logger.warn({ err: error, entityId: entity.id }, 'enrichment failed');

      await options.pool.query(
        `
          UPDATE entities
          SET enrichment_status = 'failed',
              enrichment_attempts = enrichment_attempts + 1,
              enrichment_error = $2
          WHERE id = $1
        `,
        [entity.id, truncateErrorMessage(error)]
      );

      return true;
    } finally {
      client.release();
    }
  }

  // Cache of pre-built provider functions, keyed by `provider:model`. This
  // matters when `improve-graph --model X --provider Y --limit 500` queues
  // 500 entities all pointing at the same override — building 500 provider
  // closures (each with its own captured config) is wasteful, and some
  // providers do non-trivial work in their factory (e.g. validating creds).
  const llmCache = new Map<string, CallLlm>();
  const resolveCallLlm = (
    providerOverride: string | null,
    modelOverride: string | null
  ): CallLlm | undefined => {
    if (!providerOverride && !modelOverride) {
      return options.callLlm;
    }
    if (!options.callLlmFactory) {
      // Override columns set but no factory configured. Log once per unique
      // (provider, model) pair so a misconfigured deployment shows up in
      // logs rather than silently degrading to the default model.
      const key = `MISSING_FACTORY:${providerOverride ?? ''}:${modelOverride ?? ''}`;
      if (!llmCache.has(key)) {
        logger.warn(
          { providerOverride, modelOverride },
          'extraction model override set on entity but worker has no callLlmFactory configured — falling back to default'
        );
        // Sentinel so we don't log again.
        llmCache.set(key, options.callLlm ?? (() => Promise.resolve('[]')));
      }
      return options.callLlm;
    }
    const cacheKey = `${providerOverride ?? ''}:${modelOverride ?? ''}`;
    let entry = llmCache.get(cacheKey);
    if (!entry) {
      entry = options.callLlmFactory(providerOverride, modelOverride);
      llmCache.set(cacheKey, entry);
    }
    return entry;
  };

  async function processNextExtractionEntity(
    extractionAuth: AuthContext
  ): Promise<boolean> {
    // Do NOT hold a long row-level `FOR UPDATE` across the LLM call.
    // createEdge (called inside extractAndLinkRelationships) runs on a
    // different pool connection, and its INSERT INTO edges needs a FK
    // share lock on the source entity — which would block forever behind
    // our own transaction's FOR UPDATE lock (no cycle = no deadlock
    // detection = stuck forever). Instead, use a short connection just
    // for a per-entity advisory lock.
    const candidates = await options.pool.query<PendingExtractionRow>(
      `
        SELECT id, content, type, visibility, owner,
               extraction_model_override, extraction_provider_override
        FROM entities
        WHERE extraction_status = 'pending'
          AND content IS NOT NULL
        ORDER BY created_at ASC
        LIMIT 5
      `
    );

    if (candidates.rows.length === 0) {
      return false;
    }

    const lockClient = await options.pool.connect();
    try {
      for (const entity of candidates.rows) {
        const lockRes = await lockClient.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
          [entity.id]
        );
        if (!lockRes.rows[0]?.locked) {
          continue;
        }

        const entityCallLlm = resolveCallLlm(
          entity.extraction_provider_override,
          entity.extraction_model_override
        );

        try {
          await extractAndLinkRelationships(
            options.pool,
            extractionAuth,
            {
              id: entity.id,
              type: entity.type,
              content: entity.content,
              visibility: entity.visibility,
              owner: entity.owner
            },
            {
              ...(entityCallLlm ? { callLlm: entityCallLlm } : {}),
              ...(options.autoCreate ? { autoCreate: options.autoCreate } : {}),
              embeddingService,
              ...(options.extractionMatchMinSimilarity !== undefined
                ? { matchMinSimilarity: options.extractionMatchMinSimilarity }
                : {}),
              ...(options.extractionMinContentChars !== undefined
                ? { minContentChars: options.extractionMinContentChars }
                : {}),
              ...(options.extractionDebugLog
                ? {
                    debugLog: (event, payload) =>
                      logger.info({ event, ...payload }, event)
                  }
                : {}),
              ...(options.semanticNeighbors
                ? { semanticNeighbors: options.semanticNeighbors }
                : {})
            }
          );
          // Clear the override columns on success so the next time this
          // entity is re-queued (e.g. via plain `reextract`), it falls back
          // to the env-configured default model rather than silently
          // continuing with the per-run override forever.
          await options.pool.query(
            `UPDATE entities
             SET extraction_status = 'completed',
                 extraction_error = NULL,
                 extraction_model_override = NULL,
                 extraction_provider_override = NULL
             WHERE id = $1`,
            [entity.id]
          );
        } catch (error) {
          if (error instanceof SemanticMatchUnavailableError) {
            // Leave extraction_status = 'pending' AND the override columns
            // so the next poll retries with the same model. Any edges
            // already linked in this pass are committed (createEdge upserts
            // on conflict, so the retry is idempotent).
            logger.warn(
              { entityId: entity.id, linkedSoFar: error.linkedSoFar },
              'extraction deferred — embeddings unavailable, will retry'
            );
          } else {
            logger.warn(
              { err: error, entityId: entity.id },
              'extraction failed'
            );
            // Don't clear override columns here either — operator may want
            // the failure mode investigated against the same model.
            await options.pool.query(
              "UPDATE entities SET extraction_status = 'failed', extraction_error = $2 WHERE id = $1",
              [entity.id, truncateErrorMessage(error)]
            );
          }
        } finally {
          await lockClient
            .query('SELECT pg_advisory_unlock(hashtext($1))', [entity.id])
            .catch(() => undefined);
        }
        return true;
      }
      return false;
    } finally {
      lockClient.release();
    }
  }

  type PendingLoadingRow = {
    id: string;
    mime_type: string | null;
    source_uri: string | null;
  };

  async function processNextLoadingEntity(): Promise<boolean> {
    if (!options.loaderRegistry || !options.attachmentStore) return false;

    // Claim a candidate row inside a short transaction with FOR UPDATE SKIP
    // LOCKED, then flip its status to 'running' before commit. Once the
    // transaction commits the row is no longer 'pending'/'failed', so other
    // workers' candidate queries skip it without ever holding a lock across
    // the long-running loader call. Mirrors the enrichment stage pattern.
    const claimClient = await options.pool.connect();
    let entity: PendingLoadingRow | undefined;
    try {
      await claimClient.query('BEGIN');
      const candidates = await claimClient.query<PendingLoadingRow>(
        `
          SELECT id, mime_type, source_uri
          FROM entities
          WHERE loading_status = 'pending'
             OR (
               loading_status = 'failed'
               AND loading_attempts < 3
               AND updated_at < now() - interval '5 minutes'
             )
          ORDER BY
            CASE WHEN loading_status = 'pending' THEN 0 ELSE 1 END,
            created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `,
      );
      entity = candidates.rows[0];
      if (!entity) {
        await rollbackQuietly(claimClient);
        return false;
      }
      await claimClient.query(
        `UPDATE entities SET loading_status = 'running' WHERE id = $1`,
        [entity.id],
      );
      await claimClient.query('COMMIT');
    } catch (err) {
      await rollbackQuietly(claimClient);
      throw err;
    } finally {
      claimClient.release();
    }

    const input = buildLoaderInput(entity);
    if (!input) {
      await options.pool.query(
        `
          UPDATE entities
          SET loading_status = 'failed',
              loading_attempts = loading_attempts + 1,
              loading_error = $2
          WHERE id = $1
        `,
        [
          entity.id,
          'cannot construct loader input — missing mime_type or source_uri',
        ],
      );
      return true;
    }

    const resolved = options.loaderRegistry.resolve(input);
    if (!resolved.ok) {
      await options.pool.query(
        `
          UPDATE entities
          SET loading_status = 'failed',
              loading_attempts = loading_attempts + 1,
              loading_error = $2
          WHERE id = $1
        `,
        [entity.id, `no_loader: ${resolved.error.reason}`],
      );
      return true;
    }

    const { entry } = resolved;
    // Status was already flipped to 'running' inside the claim transaction;
    // no further pre-load update needed.

    try {
      const ctx = {
        tmpDir: '/tmp',
        logger: {
          trace: () => {},
          debug: (p: unknown, m?: string) => logger.debug(p as object, m),
          info: (p: unknown, m?: string) => logger.info(p as object, m),
          warn: (p: unknown, m?: string) => logger.warn(p as object, m),
          error: (p: unknown, m?: string) => logger.error(p as object, m),
        },
        fetch: globalThis.fetch.bind(globalThis),
        options: entry.config.options,
        signal: AbortSignal.timeout(
          entry.config.kind === 'sidecar'
            ? entry.config.timeoutMs
            : 600_000,
        ),
      };

      const result = await entry.loader.load(input, ctx);
      const persisted = await persistLoaderResult(
        entity.id,
        entry.config.name,
        result,
        {
          pool: options.pool,
          attachmentStore: options.attachmentStore,
        },
      );

      // Only queue the chunk/embed pipeline if the loader produced text.
      // hasPendingEnrichment() filters on `content IS NOT NULL`, so flipping
      // a no-text entity to enrichment_status='pending' would strand it
      // there forever (image-only attachments, video without transcript,
      // etc.). For those, mark enrichment 'completed' immediately — the
      // attachments are already persisted and there's nothing to embed.
      if (persisted.contentText.length > 0) {
        await options.pool.query(
          `
            UPDATE entities
            SET enrichment_status = 'pending',
                enrichment_attempts = 0,
                enrichment_error = NULL
            WHERE id = $1
          `,
          [entity.id],
        );
      } else {
        await options.pool.query(
          `
            UPDATE entities
            SET enrichment_status = 'completed',
                enrichment_attempts = 0,
                enrichment_error = NULL
            WHERE id = $1
          `,
          [entity.id],
        );
      }
      logger.info(
        {
          loader: entry.config.name,
          entityId: entity.id,
          attachments: persisted.attachmentCount,
          textChars: persisted.contentText.length,
          enrichmentQueued: persisted.contentText.length > 0,
        },
        'loader applied',
      );
    } catch (err) {
      logger.warn(
        { err, entityId: entity.id, loader: entry.config.name },
        'loading failed',
      );
      await options.pool.query(
        `
          UPDATE entities
          SET loading_status = 'failed',
              loading_attempts = loading_attempts + 1,
              loading_error = $2
          WHERE id = $1
        `,
        [entity.id, truncateErrorMessage(err)],
      );
    }
    return true;
  }

  return {
    async runOnce(): Promise<number> {
      let processed = 0;

      if (options.loaderRegistry && options.attachmentStore) {
        while (await processNextLoadingEntity()) {
          processed += 1;
        }
      }

      if (await hasPendingEnrichment()) {
        const activeModel = await embeddingService.getActiveModel(options.pool);

        while (await processNextEnrichmentEntity(activeModel)) {
          processed += 1;
        }
      }

      if (options.extractionEnabled) {
        const extractionAuth: AuthContext = {
          apiKeyId: null,
          keyName: 'system-extraction',
          scopes: ['read', 'write', 'delete'] as const,
          allowedTypes: null,
          allowedVisibility: ['personal', 'work', 'shared'] as const
        };

        while (await processNextExtractionEntity(extractionAuth)) {
          processed += 1;
        }
      }

      return processed;
    }
  };
}
