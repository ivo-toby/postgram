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

const VECTOR_WEIGHT = 0.6;
const BM25_WEIGHT = 0.4;

export function normalizeBm25Scores<T extends { bm25: number }>(
  results: T[]
): T[] {
  const maxBm25 = Math.max(...results.map((r) => r.bm25));

  if (maxBm25 === 0) {
    return results;
  }

  return results.map((r) => ({
    ...r,
    bm25: r.bm25 / maxBm25
  }));
}

export function blendScores(
  vectorScore: number,
  normalizedBm25Score: number
): number {
  return VECTOR_WEIGHT * vectorScore + BM25_WEIGHT * normalizedBm25Score;
}

type SearchContext = {
  threshold: number;
  recencyWeight: number;
  limit: number;
  now: Date;
};

async function runHybridSearch(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  ctx: SearchContext & { queryEmbedding: number[] }
): Promise<{ results: SearchResult[] }> {
  const rows = await pool.query<SearchRow & { bm25: number }>(
    `
      SELECT
        e.*,
        c.content AS chunk_content,
        1 - (c.embedding <=> $1::vector) AS similarity,
        ts_rank(e.search_tsvector, plainto_tsquery('simple', $6)) AS bm25
      FROM chunks c
      JOIN entities e ON e.id = c.entity_id
      WHERE e.status IS DISTINCT FROM 'archived'
        AND ($2::text IS NULL OR e.type = $2)
        AND ($3::text[] IS NULL OR e.tags @> $3)
        AND ($4::text[] IS NULL OR e.type = ANY($4))
        AND e.visibility = ANY($5)
    `,
    [
      vectorToSql(ctx.queryEmbedding),
      input.type ?? null,
      input.tags?.length ? input.tags : null,
      auth.allowedTypes,
      auth.allowedVisibility,
      input.query
    ]
  );

  const withNormalizedBm25 = normalizeBm25Scores(
    rows.rows.map((row) => ({
      row,
      bm25: Number(row.bm25)
    }))
  );

  const scored = withNormalizedBm25
    .map(({ row, bm25 }) => {
      const entity = mapEntity(row);
      const similarity = Number(row.similarity);
      const blended = blendScores(similarity, bm25);
      const ageDays =
        (ctx.now.getTime() - row.created_at.getTime()) / (1000 * 60 * 60 * 24);
      const score = applyRecencyBoost({
        similarity: blended,
        ageDays,
        recencyWeight: ctx.recencyWeight,
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
    .filter((result) => result.score >= ctx.threshold);

  return {
    results: deduplicateResults(scored).slice(0, ctx.limit)
  };
}

async function runBm25OnlySearch(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  ctx: SearchContext
): Promise<{ results: SearchResult[] }> {
  const rows = await pool.query<EntityRow & { bm25: number }>(
    `
      SELECT
        e.*,
        ts_rank(e.search_tsvector, plainto_tsquery('simple', $1)) AS bm25
      FROM entities e
      WHERE e.status IS DISTINCT FROM 'archived'
        AND e.content IS NOT NULL
        AND e.search_tsvector @@ plainto_tsquery('simple', $1)
        AND ($2::text IS NULL OR e.type = $2)
        AND ($3::text[] IS NULL OR e.tags @> $3)
        AND ($4::text[] IS NULL OR e.type = ANY($4))
        AND e.visibility = ANY($5)
      ORDER BY bm25 DESC
      LIMIT $6
    `,
    [
      input.query,
      input.type ?? null,
      input.tags?.length ? input.tags : null,
      auth.allowedTypes,
      auth.allowedVisibility,
      ctx.limit
    ]
  );

  const withNormalized = normalizeBm25Scores(
    rows.rows.map((row) => ({
      row,
      bm25: Number(row.bm25)
    }))
  );

  const scored = withNormalized.map(({ row, bm25 }) => {
    const entity = mapEntity(row);
    const ageDays =
      (ctx.now.getTime() - row.created_at.getTime()) / (1000 * 60 * 60 * 24);
    const score = applyRecencyBoost({
      similarity: bm25,
      ageDays,
      recencyWeight: ctx.recencyWeight,
      halfLifeDays: 30
    });

    return {
      entity,
      entityId: entity.id,
      chunkContent: row.content ?? '',
      similarity: 0,
      score
    };
  });

  return {
    results: scored
  };
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

      const threshold = input.threshold ?? 0.35;
      const recencyWeight = input.recencyWeight ?? 0.1;
      const limit = input.limit ?? 10;
      const now = options.now?.() ?? new Date();

      const embeddingService =
        options.embeddingService ?? createEmbeddingService();

      let queryEmbedding: number[] | null = null;
      try {
        queryEmbedding = await embeddingService.embedQuery(input.query);
      } catch {
        // Embedding failed — fall through to BM25-only
      }

      if (queryEmbedding) {
        return runHybridSearch(pool, auth, input, {
          queryEmbedding,
          threshold,
          recencyWeight,
          limit,
          now
        });
      }

      return runBm25OnlySearch(pool, auth, input, {
        threshold,
        recencyWeight,
        limit,
        now
      });
    })(),
    (error) => toAppError(error, 'Failed to search entities')
  );
}
