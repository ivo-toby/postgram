import type { Pool, PoolClient } from 'pg';

import type { AuthContext } from '../auth/types.js';
import { chunkText } from './chunking-service.js';
import {
  createEmbeddingService,
  type EmbeddingService
} from './embedding-service.js';
import { extractAndLinkRelationships } from './extraction-service.js';

type PendingEntityRow = {
  id: string;
  content: string;
};

type PendingExtractionRow = PendingEntityRow & {
  type: string;
};

type EnrichmentWorkerOptions = {
  pool: Pool;
  embeddingService?: EmbeddingService;
  extractionEnabled?: boolean;
  callLlm?: ((prompt: string) => Promise<string>) | undefined;
};

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original failure if rollback itself fails.
  }
}

export function createEnrichmentWorker(options: EnrichmentWorkerOptions) {
  if (options.extractionEnabled && !options.callLlm) {
    throw new Error('callLlm is required when extractionEnabled is true');
  }

  const embeddingService = options.embeddingService ?? createEmbeddingService();

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
                  extraction_status = 'pending'
              WHERE id = $1
            `
          : `
              UPDATE entities
              SET enrichment_status = 'completed',
                  enrichment_attempts = 0
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

      await options.pool.query(
        `
          UPDATE entities
          SET enrichment_status = 'failed',
              enrichment_attempts = enrichment_attempts + 1
          WHERE id = $1
        `,
        [entity.id]
      );

      return true;
    } finally {
      client.release();
    }
  }

  async function processNextExtractionEntity(
    extractionAuth: AuthContext
  ): Promise<boolean> {
    const client = await options.pool.connect();
    let entity: PendingExtractionRow | undefined;

    try {
      await client.query('BEGIN');

      const extractionPending = await client.query<PendingExtractionRow>(
        `
          SELECT id, content, type
          FROM entities
          WHERE extraction_status = 'pending'
            AND content IS NOT NULL
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `
      );

      entity = extractionPending.rows[0];
      if (!entity) {
        await rollbackQuietly(client);
        return false;
      }

      await extractAndLinkRelationships(
        options.pool,
        extractionAuth,
        entity.id,
        entity.type,
        entity.content,
        options.callLlm ? { callLlm: options.callLlm } : {}
      );

      await client.query(
        "UPDATE entities SET extraction_status = 'completed' WHERE id = $1",
        [entity.id]
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await rollbackQuietly(client);

      if (!entity) {
        throw error;
      }

      await options.pool.query(
        "UPDATE entities SET extraction_status = 'failed' WHERE id = $1",
        [entity.id]
      );

      return true;
    } finally {
      client.release();
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
