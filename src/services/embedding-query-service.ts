import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import { AppError, ErrorCode } from '../util/errors.js';
import { ownerSqlCondition } from './owner-filter.js';

export type EntityEmbedding = {
  id: string;
  embedding: number[];
};

type EmbeddingRow = {
  entity_id: string;
  embedding: string;
};

export type GetEntityEmbeddingsInput = {
  ids: string[];
  owner?: string | undefined;
};

export function getEntityEmbeddings(
  pool: Pool,
  auth: AuthContext,
  input: GetEntityEmbeddingsInput
): ServiceResult<EntityEmbedding[]> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const ids = input.ids;
      if (ids.length === 0) return [];

      const result = await pool.query<EmbeddingRow>(
        `
          SELECT
            c.entity_id,
            AVG(c.embedding)::text AS embedding
          FROM chunks c
          JOIN entities e ON e.id = c.entity_id
          WHERE e.id = ANY($1::uuid[])
            AND ($2::text[] IS NULL OR e.type = ANY($2))
            AND e.visibility = ANY($3)
            AND ${ownerSqlCondition('e.owner', '$4')}
          GROUP BY c.entity_id
        `,
        [
          ids,
          auth.allowedTypes,
          auth.allowedVisibility,
          input.owner ?? null
        ]
      );

      return result.rows.map((row): EntityEmbedding => ({
        id: row.entity_id,
        embedding: JSON.parse(row.embedding) as number[]
      }));
    })(),
    (error) => {
      if (error instanceof AppError) return error;
      return new AppError(
        ErrorCode.INTERNAL,
        'Failed to load embeddings',
        {
          cause: error instanceof Error ? error.message : String(error)
        }
      );
    }
  );
}
