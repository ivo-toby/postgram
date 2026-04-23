import type { Logger } from 'pino';
import type { Pool, PoolClient } from 'pg';

import type { AuthContext } from '../auth/types.js';
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

type PendingEntityRow = {
  id: string;
  content: string;
};

type PendingExtractionRow = PendingEntityRow & {
  type: string;
  visibility: string;
  owner: string | null;
};

type EnrichmentWorkerOptions = {
  pool: Pool;
  embeddingService?: EmbeddingService;
  extractionEnabled?: boolean;
  callLlm?:
    | ((prompt: string, schema?: object) => Promise<string>)
    | undefined;
  logger?: Logger;
  autoCreate?: {
    enabled: boolean;
    types: readonly string[];
    minConfidence: number;
  };
  extractionMatchMinSimilarity?: number;
};

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
  if (options.extractionEnabled && !options.callLlm) {
    throw new Error('callLlm is required when extractionEnabled is true');
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
        SELECT id, content, type, visibility, owner
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
              ...(options.callLlm ? { callLlm: options.callLlm } : {}),
              ...(options.autoCreate ? { autoCreate: options.autoCreate } : {}),
              embeddingService,
              ...(options.extractionMatchMinSimilarity !== undefined
                ? { matchMinSimilarity: options.extractionMatchMinSimilarity }
                : {})
            }
          );
          await options.pool.query(
            "UPDATE entities SET extraction_status = 'completed', extraction_error = NULL WHERE id = $1",
            [entity.id]
          );
        } catch (error) {
          if (error instanceof SemanticMatchUnavailableError) {
            // Leave extraction_status = 'pending' so the next poll retries
            // the entity once embeddings recover. Any edges already linked
            // in this pass are committed (createEdge upserts on conflict,
            // so the retry is idempotent).
            logger.warn(
              { entityId: entity.id, linkedSoFar: error.linkedSoFar },
              'extraction deferred — embeddings unavailable, will retry'
            );
          } else {
            logger.warn(
              { err: error, entityId: entity.id },
              'extraction failed'
            );
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

  return {
    async runOnce(): Promise<number> {
      let processed = 0;

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
