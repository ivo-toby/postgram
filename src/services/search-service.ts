import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import type {
  Entity,
  EntityStatus,
  EntityType,
  EnrichmentStatus,
  Visibility
} from '../types/entities.js';
import { AppError, ErrorCode } from '../util/errors.js';
import {
  createEmbeddingService,
  type EmbeddingService,
  vectorToSql
} from './embedding-service.js';

type EntityRow = {
  id: string;
  type: EntityType;
  content: string | null;
  visibility: Visibility;
  status: EntityStatus | null;
  enrichment_status: EnrichmentStatus;
  version: number;
  tags: string[];
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type SearchRow = EntityRow & {
  chunk_content: string;
  similarity: number;
};

export type SearchResult = {
  entity: Entity;
  entityId: string;
  chunkContent: string;
  similarity: number;
  score: number;
};

type SearchInput = {
  query: string;
  type?: EntityType | undefined;
  tags?: string[] | undefined;
  limit?: number | undefined;
  threshold?: number | undefined;
  recencyWeight?: number | undefined;
};

type SearchOptions = {
  embeddingService?: EmbeddingService | undefined;
  now?: (() => Date) | undefined;
};

function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL, fallbackMessage, {
      cause: error.message
    });
  }

  return new AppError(ErrorCode.INTERNAL, fallbackMessage);
}

function mapEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    visibility: row.visibility,
    status: row.status,
    enrichmentStatus: row.enrichment_status,
    version: row.version,
    tags: row.tags,
    source: row.source,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export function applyRecencyBoost({
  similarity,
  ageDays,
  recencyWeight,
  halfLifeDays
}: {
  similarity: number;
  ageDays: number;
  recencyWeight: number;
  halfLifeDays: number;
}): number {
  return similarity * (1 + recencyWeight * Math.exp(-ageDays / halfLifeDays));
}

export function deduplicateResults<T extends { entityId: string; score: number }>(
  results: T[]
): T[] {
  const bestByEntity = new Map<string, T>();

  for (const result of results) {
    const existing = bestByEntity.get(result.entityId);
    if (!existing || result.score > existing.score) {
      bestByEntity.set(result.entityId, result);
    }
  }

  return Array.from(bestByEntity.values()).sort((left, right) => right.score - left.score);
}

export function searchEntities(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  options: SearchOptions = {}
): ServiceResult<{ results: SearchResult[] }> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const embeddingService =
        options.embeddingService ?? createEmbeddingService();
      const queryEmbedding = await embeddingService.embedQuery(input.query);
      const threshold = input.threshold ?? 0.35;
      const recencyWeight = input.recencyWeight ?? 0.1;
      const limit = input.limit ?? 10;
      const now = options.now?.() ?? new Date();

      const rows = await pool.query<SearchRow>(
        `
          SELECT
            e.*,
            c.content AS chunk_content,
            1 - (c.embedding <=> $1::vector) AS similarity
          FROM chunks c
          JOIN entities e ON e.id = c.entity_id
          WHERE e.status IS DISTINCT FROM 'archived'
            AND ($2::text IS NULL OR e.type = $2)
            AND ($3::text[] IS NULL OR e.tags @> $3)
            AND ($4::text[] IS NULL OR e.type = ANY($4))
            AND e.visibility = ANY($5)
        `,
        [
          vectorToSql(queryEmbedding),
          input.type ?? null,
          input.tags?.length ? input.tags : null,
          auth.allowedTypes,
          auth.allowedVisibility
        ]
      );

      const scored = rows.rows
        .map((row) => {
          const entity = mapEntity(row);
          const ageDays =
            (now.getTime() - row.created_at.getTime()) / (1000 * 60 * 60 * 24);
          const similarity = Number(row.similarity);
          const score = applyRecencyBoost({
            similarity,
            ageDays,
            recencyWeight,
            halfLifeDays: 30
          });

          return {
            entity,
            entityId: entity.id,
            chunkContent: row.chunk_content,
            similarity,
            score
          };
        })
        .filter((result) => result.similarity >= threshold);

      return {
        results: deduplicateResults(scored).slice(0, limit)
      };
    })(),
    (error) => toAppError(error, 'Failed to search entities')
  );
}
