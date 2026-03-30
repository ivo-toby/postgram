import type { Pool } from 'pg';

import { chunkText } from './chunking-service.js';
import {
  createEmbeddingService,
  type EmbeddingService,
  vectorToSql
} from './embedding-service.js';

type PendingEntityRow = {
  id: string;
  content: string;
};

type EnrichmentWorkerOptions = {
  pool: Pool;
  embeddingService?: EmbeddingService;
};

export function createEnrichmentWorker(options: EnrichmentWorkerOptions) {
  const embeddingService = options.embeddingService ?? createEmbeddingService();

  return {
    async runOnce(): Promise<number> {
      const pending = await options.pool.query<PendingEntityRow>(
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
        `
      );

      if (pending.rows.length === 0) {
        return 0;
      }

      const activeModel = await embeddingService.getActiveModel(options.pool);
      let processed = 0;

      for (const entity of pending.rows) {
        try {
          const chunks = chunkText(entity.content);
          const embeddings = await embeddingService.embedBatch(
            chunks.map((chunk) => chunk.content)
          );
          const client = await options.pool.connect();

          try {
            await client.query('BEGIN');
            await client.query('DELETE FROM chunks WHERE entity_id = $1', [
              entity.id
            ]);

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
                  vectorToSql(embedding),
                  activeModel.id,
                  chunk.tokenCount
                ]
              );
            }

            await client.query(
              `
                UPDATE entities
                SET enrichment_status = 'completed',
                    enrichment_attempts = 0
                WHERE id = $1
              `,
              [entity.id]
            );
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
        } catch {
          await options.pool.query(
            `
              UPDATE entities
              SET enrichment_status = 'failed',
                  enrichment_attempts = enrichment_attempts + 1
              WHERE id = $1
            `,
            [entity.id]
          );
        }

        processed += 1;
      }

      return processed;
    }
  };
}
