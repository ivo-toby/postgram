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
import { ownerSqlCondition } from './owner-filter.js';
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
  owner: string | null;
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
  related?: Array<{
    entity: { id: string; type: string; content: string | null; metadata: Record<string, unknown> };
    relation: string;
    direction: 'outgoing' | 'incoming';
  }> | undefined;
};

type SearchInput = {
  query: string;
  type?: EntityType | undefined;
  tags?: string[] | undefined;
  visibility?: Visibility | undefined;
  owner?: string | undefined;
  limit?: number | undefined;
  threshold?: number | undefined;
  recencyWeight?: number | undefined;
  expandGraph?: boolean | undefined;
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
    owner: row.owner,
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

// Fetch at most this many candidates from DB for JS-side reranking.
// Prevents OOM when the corpus is large — vector similarity is pre-sorted
// so we get the best candidates and BM25/recency reranking still works correctly
// over the candidate set.
const CANDIDATE_CAP = 500;

async function runHybridSearch(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  ctx: SearchContext & { queryEmbedding: number[]; queryText: string }
): Promise<{ results: SearchResult[] }> {
  const candidateLimit = Math.min(ctx.limit * 20, CANDIDATE_CAP);

  const rows = await pool.query<SearchRow & { bm25: number }>(
    `
      SELECT
        e.*,
        c.content AS chunk_content,
        1 - (c.embedding <=> $1::vector) AS similarity,
        ts_rank(e.search_tsvector, plainto_tsquery('simple', $8)) AS bm25
      FROM chunks c
      JOIN entities e ON e.id = c.entity_id
      WHERE e.status IS DISTINCT FROM 'archived'
        AND ($2::text IS NULL OR e.type = $2)
        AND ($3::text[] IS NULL OR e.tags @> $3)
        AND ($4::text[] IS NULL OR e.type = ANY($4))
        AND e.visibility = ANY($5)
        AND ($6::text IS NULL OR e.visibility = $6)
        AND ${ownerSqlCondition('e.owner', '$7')}
      ORDER BY c.embedding <=> $1::vector
      LIMIT $9
    `,
    [
      vectorToSql(ctx.queryEmbedding),
      input.type ?? null,
      input.tags?.length ? input.tags : null,
      auth.allowedTypes,
      auth.allowedVisibility,
      input.visibility ?? null,
      input.owner ?? null,
      ctx.queryText,
      candidateLimit
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

export function searchEntities(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  options: SearchOptions = {}
): ServiceResult<{ results: SearchResult[] }> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const query = input.query.trim();
      if (!query) {
        throw new AppError(ErrorCode.VALIDATION, 'Query must not be empty');
      }

      const threshold = input.threshold ?? 0.35;
      const recencyWeight = input.recencyWeight ?? 0.1;
      const limit = input.limit ?? 10;
      const now = options.now?.() ?? new Date();

      const embeddingService =
        options.embeddingService ?? createEmbeddingService();
      const activeModel = await embeddingService.getActiveModel(pool);

      let queryEmbedding: number[];
      try {
        queryEmbedding = await embeddingService.embedQuery(query, activeModel);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }

        throw new AppError(
          ErrorCode.EMBEDDING_FAILED,
          error instanceof Error ? error.message : 'Failed to embed query text'
        );
      }

      const results = await runHybridSearch(pool, auth, input, {
        queryEmbedding,
        queryText: query,
        threshold,
        recencyWeight,
        limit,
        now
      });

      if (input.expandGraph && results.results.length > 0) {
        // Batch graph expansion: 2 queries total instead of 2N
        const resultEntityIds = results.results.map((r) => r.entityId);

        const allEdges = await pool.query<{
          source_id: string; target_id: string; relation: string;
        }>(
          'SELECT source_id, target_id, relation FROM edges WHERE source_id = ANY($1) OR target_id = ANY($1)',
          [resultEntityIds]
        );

        // Collect all neighbor IDs and build per-entity edge info
        const edgesByEntityId = new Map<string, Array<{ entityId: string; relation: string; direction: 'outgoing' | 'incoming' }>>();
        const allNeighborIds = new Set<string>();

        for (const edge of allEdges.rows) {
          for (const entityId of resultEntityIds) {
            if (edge.source_id === entityId) {
              if (!edgesByEntityId.has(entityId)) edgesByEntityId.set(entityId, []);
              edgesByEntityId.get(entityId)!.push({ entityId: edge.target_id, relation: edge.relation, direction: 'outgoing' });
              allNeighborIds.add(edge.target_id);
            } else if (edge.target_id === entityId) {
              if (!edgesByEntityId.has(entityId)) edgesByEntityId.set(entityId, []);
              edgesByEntityId.get(entityId)!.push({ entityId: edge.source_id, relation: edge.relation, direction: 'incoming' });
              allNeighborIds.add(edge.source_id);
            }
          }
        }

        if (allNeighborIds.size > 0) {
          const neighbors = await pool.query<{
            id: string; type: string; content: string | null; metadata: Record<string, unknown>;
          }>(
            `SELECT id, type, content, metadata FROM entities
             WHERE id = ANY($1)
               AND status IS DISTINCT FROM 'archived'
               AND ($2::text[] IS NULL OR type = ANY($2))
               AND visibility = ANY($3)
               AND ${ownerSqlCondition('owner', '$4')}`,
            [
              Array.from(allNeighborIds),
              auth.allowedTypes,
              auth.allowedVisibility,
              input.owner ?? null
            ]
          );

          const neighborMap = new Map(neighbors.rows.map((n) => [n.id, n]));

          for (const result of results.results) {
            const edgeInfo = edgesByEntityId.get(result.entityId);
            if (!edgeInfo) continue;
            result.related = edgeInfo
              .map((info) => {
                const entity = neighborMap.get(info.entityId);
                if (!entity) return null;
                return { entity, relation: info.relation, direction: info.direction };
              })
              .filter((r): r is NonNullable<typeof r> => r !== null);
          }
        }
      }

      return results;
    })(),
    (error) => toAppError(error, 'Failed to search entities')
  );
}
