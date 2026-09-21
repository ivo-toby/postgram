import { ResultAsync } from 'neverthrow';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';

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
  type QueryEmbeddingCacheStatus,
  vectorToSql
} from './embedding-service.js';
import { resolveEnvJevJudge } from './jev-retrieval-judge.js';
import type {
  JevRetrievalJudge,
  JevShadowObservation
} from './jev-retrieval-judge.js';
import type { MemoryRole } from './memory-role-service.js';

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
  score: number;
};

type EmptySearchRow = {
  [Key in keyof SearchRow]: null;
};

type SearchEnvelopeRow =
  | (SearchRow & { result_present: true; candidate_count: number })
  | (EmptySearchRow & { result_present: false; candidate_count: number });

export type SearchResult = {
  entity: Entity;
  entityId: string;
  chunkContent: string;
  similarity: number;
  score: number;
  edges?: SearchEdgeSummary | undefined;
  related?: Array<{
    entity: { id: string; type: string; content: string | null; metadata: Record<string, unknown> };
    relation: string;
    direction: 'outgoing' | 'incoming';
  }> | undefined;
};

export type SearchEdgeSummary = {
  count: number;
  relations: Array<{ relation: string; count: number }>;
};

export type SearchEdgeSummaryRow = {
  result_entity_id: string;
  relation: string;
};

type SearchInput = {
  query: string;
  type?: EntityType | undefined;
  tags?: string[] | undefined;
  visibility?: Visibility | undefined;
  owner?: string | undefined;
  memoryRole?: MemoryRole | undefined;
  limit?: number | undefined;
  threshold?: number | undefined;
  recencyWeight?: number | undefined;
  expandGraph?: boolean | undefined;
  includeArchived?: boolean | undefined;
  includeContent?: boolean | undefined;
};

type SearchStrategyOverride = 'auto' | 'exact' | 'hnsw';
type HybridSearchStrategy = 'exact' | 'hnsw' | 'hnsw_exact_fallback';

type SearchOptions = {
  embeddingService?: EmbeddingService | undefined;
  now?: (() => Date) | undefined;
  logger?: Pick<Logger, 'debug' | 'warn'> | undefined;
  strategyOverride?: SearchStrategyOverride | undefined;
  onStrategy?: ((strategy: HybridSearchStrategy) => void) | undefined;
  /**
   * Shadow-mode Jev retrieval judge. Judgments are logged inside the
   * `search.completed` debug payload and never influence results. When
   * omitted, a judge is resolved once from the JEV_* env flags; with
   * JEV_SHADOW_ENABLED off (default) this resolves to nothing, the Jev client
   * is never constructed and the SDK is never imported at runtime.
   */
  jevJudge?: JevRetrievalJudge | undefined;
};

export type SearchResponse = {
  results: SearchResult[];
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

export function scopedMemoryVisibilitySql(
  metadataColumn: string,
  clientIdPlaceholder: string
): string {
  return `(
    (
      COALESCE(${metadataColumn}->>'memory_role', 'durable_memory') = 'session_context'
      AND ${metadataColumn} #>> '{session_scope,client_id}' = ${clientIdPlaceholder}
    )
    OR (
      COALESCE(${metadataColumn}->>'memory_role', 'durable_memory') <> 'session_context'
      AND (
        ${metadataColumn} #>> '{session_scope,client_id}' IS NULL
        OR ${metadataColumn} #>> '{session_scope,client_id}' = ${clientIdPlaceholder}
      )
    )
  )`;
}

export function buildSearchEdgeSummaries(
  rows: SearchEdgeSummaryRow[]
): Map<string, SearchEdgeSummary> {
  const relationsByEntityId = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const relationCounts =
      relationsByEntityId.get(row.result_entity_id) ?? new Map<string, number>();
    relationCounts.set(row.relation, (relationCounts.get(row.relation) ?? 0) + 1);
    relationsByEntityId.set(row.result_entity_id, relationCounts);
  }

  const summaries = new Map<string, SearchEdgeSummary>();
  for (const [entityId, relationCounts] of relationsByEntityId) {
    const relations = Array.from(relationCounts.entries())
      .map(([relation, count]) => ({ relation, count }))
      .sort(
        (left, right) =>
          right.count - left.count || left.relation.localeCompare(right.relation)
      );

    summaries.set(entityId, {
      count: relations.reduce((total, entry) => total + entry.count, 0),
      relations
    });
  }

  return summaries;
}

// Ranking weights. These are interpolated into the SQL below rather than
// applied in JS so that thresholding, deduplication and the final LIMIT all
// happen inside Postgres — only the rows that survive get their content
// hydrated and shipped across the wire.
export const VECTOR_WEIGHT = 0.6;
export const BM25_WEIGHT = 0.4;
export const RECENCY_HALF_LIFE_DAYS = 30;

type SearchContext = {
  threshold: number;
  recencyWeight: number;
  limit: number;
  now: Date;
};

// Exact search remains faster for small filtered sets. Above this point the
// vector distance work dominates and HNSW should choose the candidates.
const EXACT_SEARCH_MAX_CHUNKS = 5_000;
const CANDIDATE_MULTIPLIER = 20;
const CANDIDATE_CAP = 500;

const hnswIterativeScanSupport = new WeakMap<Pool, boolean>();

type HybridEntityAlias = 'e' | 'filtered';

function hybridEntityFilterConditions(alias: HybridEntityAlias): string {
  return `
    ($10::boolean = true OR ${alias}.status IS DISTINCT FROM 'archived')
    AND ($2::text IS NULL OR ${alias}.type = $2)
    AND ($3::text[] IS NULL OR ${alias}.tags @> $3)
    AND ($4::text[] IS NULL OR ${alias}.type = ANY($4))
    AND ${alias}.visibility = ANY($5)
    AND ($6::text IS NULL OR ${alias}.visibility = $6)
    AND ${ownerSqlCondition(`${alias}.owner`, '$7')}
    AND (
      $11::text IS NULL
      OR (
        ${alias}.type = 'memory'
        AND COALESCE(${alias}.metadata->>'memory_role', 'durable_memory') = $11
      )
    )
    AND ${scopedMemoryVisibilitySql(`${alias}.metadata`, '$12')}
  `;
}

const EXACT_CANDIDATES_SQL = `
  SELECT
    e.id AS entity_id,
    c.id AS chunk_id,
    e.created_at,
    1 - (c.embedding <=> $1::vector) AS similarity,
    c.embedding <=> $1::vector AS distance,
    ts_rank(e.search_tsvector, plainto_tsquery('simple', $8)) AS bm25
  FROM chunks c
  JOIN entities e ON e.id = c.entity_id
  WHERE ${hybridEntityFilterConditions('e')}
  ORDER BY (c.embedding <=> $1::vector) + 0
  LIMIT $9
`;

const HNSW_CANDIDATES_SQL = `
  SELECT
    e.id AS entity_id,
    c.id AS chunk_id,
    e.created_at,
    1 - (c.embedding <=> $1::vector) AS similarity,
    c.embedding <=> $1::vector AS distance,
    ts_rank(e.search_tsvector, plainto_tsquery('simple', $8)) AS bm25
  FROM chunks c
  CROSS JOIN LATERAL (
    SELECT
      filtered.id,
      filtered.created_at,
      filtered.search_tsvector
    FROM entities filtered
    WHERE filtered.id = c.entity_id
      AND ${hybridEntityFilterConditions('filtered')}
    -- Prevent PostgreSQL from flattening this into the entity-first plan that
    -- scans every chunk before sorting by vector distance.
    OFFSET 0
  ) e
  ORDER BY distance
  LIMIT $9
`;

type HybridQueryResult = {
  results: SearchResult[];
  candidateCount: number;
  candidateLimit: number;
};
type HybridSearchResult = {
  results: SearchResult[];
  strategy: HybridSearchStrategy;
};
type HybridSearchContext = SearchContext & {
  queryEmbedding: number[];
  queryText: string;
};

function mapSearchRows(rows: SearchRow[]): SearchResult[] {
  return rows.map((row) => {
    const entity = mapEntity(row);
    return {
      entity,
      entityId: entity.id,
      chunkContent: row.chunk_content,
      similarity: Number(row.similarity),
      score: Number(row.score)
    };
  });
}

function mapSearchEnvelopeRows(rows: SearchEnvelopeRow[]): {
  results: SearchResult[];
  candidateCount: number;
} {
  const resultRows: SearchRow[] = [];
  for (const row of rows) {
    if (row.result_present) {
      resultRows.push(row);
    }
  }
  return {
    results: mapSearchRows(resultRows),
    candidateCount: Number(rows[0]?.candidate_count ?? 0)
  };
}

function buildHybridSearchSql(
  candidateSql: string,
  includeContent: boolean
): string {
  const contentProjection = includeContent
    ? 'e.content'
    : 'NULL::text AS content';

  return `
    WITH candidates AS MATERIALIZED (
      ${candidateSql}
    ),
    normalized AS (
      SELECT
        candidates.*,
        CASE
          WHEN MAX(bm25) OVER () = 0 THEN bm25
          ELSE bm25 / MAX(bm25) OVER ()
        END AS normalized_bm25
      FROM candidates
    ),
    scored AS (
      SELECT
        normalized.*,
        (
          ${VECTOR_WEIGHT} * similarity + ${BM25_WEIGHT} * normalized_bm25
        ) * (
          1 + $13::double precision * EXP(
            -EXTRACT(EPOCH FROM ($14::timestamptz - created_at))
            / 86400.0
            / ${RECENCY_HALF_LIFE_DAYS}.0
          )
        ) AS score
      FROM normalized
    ),
    deduplicated AS (
      SELECT
        scored.*,
        ROW_NUMBER() OVER (
          PARTITION BY entity_id
          ORDER BY score DESC, chunk_id
        ) AS entity_rank
      FROM scored
      WHERE score >= $15
    ),
    top_results AS MATERIALIZED (
      SELECT *
      FROM deduplicated
      WHERE entity_rank = 1
      ORDER BY score DESC
      LIMIT $16
    ),
    candidate_stats AS (
      SELECT COUNT(*)::integer AS candidate_count
      FROM candidates
    )
    SELECT
      top_results.entity_id IS NOT NULL AS result_present,
      candidate_stats.candidate_count,
      e.id,
      e.type,
      ${contentProjection},
      e.visibility,
      e.owner,
      e.status,
      e.enrichment_status,
      e.version,
      e.tags,
      e.source,
      e.metadata,
      e.created_at,
      e.updated_at,
      c.content AS chunk_content,
      top_results.similarity,
      top_results.score
    FROM candidate_stats
    LEFT JOIN top_results ON true
    LEFT JOIN entities e ON e.id = top_results.entity_id
    LEFT JOIN chunks c ON c.id = top_results.chunk_id
    ORDER BY top_results.score DESC NULLS LAST
  `;
}

function hybridSearchValues(
  auth: AuthContext,
  input: SearchInput,
  ctx: HybridSearchContext,
  candidateLimit: number
): unknown[] {
  return [
    vectorToSql(ctx.queryEmbedding),
    input.type ?? null,
    input.tags?.length ? input.tags : null,
    auth.allowedTypes,
    auth.allowedVisibility,
    input.visibility ?? null,
    input.owner ?? null,
    ctx.queryText,
    candidateLimit,
    input.includeArchived ?? false,
    input.memoryRole ?? null,
    auth.clientId,
    ctx.recencyWeight,
    ctx.now,
    ctx.threshold,
    ctx.limit
  ];
}

async function executeHybridSearch(
  queryable: Pool | PoolClient,
  auth: AuthContext,
  input: SearchInput,
  ctx: HybridSearchContext,
  strategy: 'exact' | 'hnsw'
): Promise<HybridQueryResult> {
  const candidateLimit = Math.min(
    ctx.limit * CANDIDATE_MULTIPLIER,
    CANDIDATE_CAP
  );
  const candidateSql =
    strategy === 'hnsw' ? HNSW_CANDIDATES_SQL : EXACT_CANDIDATES_SQL;
  const rows = await queryable.query<SearchEnvelopeRow>(
    buildHybridSearchSql(candidateSql, input.includeContent ?? true),
    hybridSearchValues(auth, input, ctx, candidateLimit)
  );
  const mapped = mapSearchEnvelopeRows(rows.rows);
  return { ...mapped, candidateLimit };
}

function isBroadSearch(auth: AuthContext, input: SearchInput): boolean {
  const allVisibilities: Visibility[] = ['personal', 'work', 'shared'];
  return (
    auth.allowedTypes === null &&
    allVisibilities.every((visibility) =>
      auth.allowedVisibility.includes(visibility)
    ) &&
    input.type === undefined &&
    !input.tags?.length &&
    input.visibility === undefined &&
    input.owner === undefined &&
    input.memoryRole === undefined
  );
}

async function countFilteredChunks(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput
): Promise<number> {
  const rows = await pool.query<{ chunk_count: string }>(
    `SELECT count(*)::text AS chunk_count
     FROM (
       SELECT 1
       FROM chunks c
       JOIN entities e ON e.id = c.entity_id
       WHERE ($1::boolean = true OR e.status IS DISTINCT FROM 'archived')
         AND ($2::text IS NULL OR e.type = $2)
         AND ($3::text[] IS NULL OR e.tags @> $3)
         AND ($4::text[] IS NULL OR e.type = ANY($4))
         AND e.visibility = ANY($5)
         AND ($6::text IS NULL OR e.visibility = $6)
         AND ${ownerSqlCondition('e.owner', '$7')}
         AND (
           $8::text IS NULL
           OR (
             e.type = 'memory'
             AND COALESCE(e.metadata->>'memory_role', 'durable_memory') = $8
           )
         )
         AND ${scopedMemoryVisibilitySql('e.metadata', '$9')}
       LIMIT $10
     ) matching_chunks`,
    [
      input.includeArchived ?? false,
      input.type ?? null,
      input.tags?.length ? input.tags : null,
      auth.allowedTypes,
      auth.allowedVisibility,
      input.visibility ?? null,
      input.owner ?? null,
      input.memoryRole ?? null,
      auth.clientId,
      EXACT_SEARCH_MAX_CHUNKS + 1
    ]
  );
  return Number(rows.rows[0]?.chunk_count ?? '0');
}

function hasPgErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original query or configuration error.
  }
}

async function executeHnswSearch(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  ctx: HybridSearchContext
): Promise<HybridQueryResult | null> {
  if (hnswIterativeScanSupport.get(pool) === false) {
    return null;
  }

  const client = await pool.connect();
  let transactionActive = false;
  try {
    await client.query('BEGIN');
    transactionActive = true;
    await client.query("SELECT '[0]'::vector");
    try {
      await client.query("SET LOCAL hnsw.iterative_scan = 'strict_order'");
      hnswIterativeScanSupport.set(pool, true);
    } catch (error) {
      if (!hasPgErrorCode(error, '42704')) {
        throw error;
      }
      hnswIterativeScanSupport.set(pool, false);
      await rollbackQuietly(client);
      transactionActive = false;
      return null;
    }

    const results = await executeHybridSearch(
      client,
      auth,
      input,
      ctx,
      'hnsw'
    );
    await client.query('COMMIT');
    transactionActive = false;
    return results;
  } catch (error) {
    if (transactionActive) {
      await rollbackQuietly(client);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function runHybridSearch(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  ctx: HybridSearchContext,
  strategyOverride: SearchStrategyOverride = 'auto'
): Promise<HybridSearchResult> {
  if (strategyOverride === 'exact') {
    const exactResults = await executeHybridSearch(
      pool,
      auth,
      input,
      ctx,
      'exact'
    );
    return { results: exactResults.results, strategy: 'exact' };
  }

  const useHnsw =
    strategyOverride === 'hnsw' ||
    isBroadSearch(auth, input) ||
    (await countFilteredChunks(pool, auth, input)) > EXACT_SEARCH_MAX_CHUNKS;

  if (useHnsw) {
    const hnswResults = await executeHnswSearch(pool, auth, input, ctx);
    if (
      hnswResults &&
      hnswResults.candidateCount >= hnswResults.candidateLimit
    ) {
      return { results: hnswResults.results, strategy: 'hnsw' };
    }

    const exactResults = await executeHybridSearch(
      pool,
      auth,
      input,
      ctx,
      'exact'
    );
    return {
      results: exactResults.results,
      strategy: hnswResults ? 'hnsw_exact_fallback' : 'exact'
    };
  }

  const exactResults = await executeHybridSearch(
    pool,
    auth,
    input,
    ctx,
    'exact'
  );
  return {
    results: exactResults.results,
    strategy: 'exact'
  };
}

async function fetchSearchEdgeSummaries(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  resultEntityIds: string[]
): Promise<Map<string, SearchEdgeSummary>> {
  if (resultEntityIds.length === 0) {
    return new Map();
  }

  const rows = await pool.query<SearchEdgeSummaryRow>(
    `
      WITH result_edges AS (
        SELECT e.source_id AS result_entity_id, e.source_id, e.target_id, e.relation
        FROM unnest($1::uuid[]) AS anchor(id)
        JOIN edges e ON e.source_id = anchor.id
        UNION ALL
        SELECT e.target_id AS result_entity_id, e.source_id, e.target_id, e.relation
        FROM unnest($1::uuid[]) AS anchor(id)
        JOIN edges e ON e.target_id = anchor.id
      )
      SELECT result_edges.result_entity_id, result_edges.relation
      FROM result_edges
      JOIN entities src ON src.id = result_edges.source_id
      JOIN entities tgt ON tgt.id = result_edges.target_id
      WHERE src.status IS DISTINCT FROM 'archived'
        AND tgt.status IS DISTINCT FROM 'archived'
        AND ($2::text[] IS NULL OR src.type = ANY($2))
        AND ($2::text[] IS NULL OR tgt.type = ANY($2))
        AND src.visibility = ANY($3)
        AND tgt.visibility = ANY($3)
        AND ${ownerSqlCondition('src.owner', '$4')}
        AND ${ownerSqlCondition('tgt.owner', '$4')}
        AND ${scopedMemoryVisibilitySql('src.metadata', '$5')}
        AND ${scopedMemoryVisibilitySql('tgt.metadata', '$5')}
    `,
    [
      resultEntityIds,
      auth.allowedTypes,
      auth.allowedVisibility,
      input.owner ?? null,
      auth.clientId
    ]
  );

  return buildSearchEdgeSummaries(rows.rows);
}

export function searchEntities(
  pool: Pool,
  auth: AuthContext,
  input: SearchInput,
  options: SearchOptions = {}
): ServiceResult<SearchResponse> {
  return ResultAsync.fromPromise(
    (async () => {
      const startedAt = Date.now();
      requireScope(auth, 'read');

      const query = input.query.trim();
      if (!query) {
        throw new AppError(ErrorCode.VALIDATION, 'Query must not be empty');
      }

      const threshold = input.threshold ?? 0.35;
      const recencyWeight = input.recencyWeight ?? 0.1;
      const limit = input.limit ?? 10;
      const now = options.now?.() ?? new Date();
      const timings: Record<string, number> = {};
      let cacheStatus: QueryEmbeddingCacheStatus = 'bypass';

      const embeddingService =
        options.embeddingService ?? createEmbeddingService();
      const searchContext = {
        queryText: query,
        threshold,
        recencyWeight,
        limit,
        now
      };

      const modelStartedAt = Date.now();
      const activeModel = await embeddingService.getActiveModelForQuery(pool);
      timings['activeModelMs'] = Date.now() - modelStartedAt;

      const embeddingStartedAt = Date.now();
      let queryEmbedding: number[];
      try {
        queryEmbedding = await embeddingService.embedQuery(
          query,
          activeModel,
          {
            pool,
            // Partitions cache entries per client so one client cannot detect
            // another's queries by timing a hit. An unauthenticated context has
            // no scope and simply is not cached.
            ...(auth.clientId ? { cacheScope: auth.clientId } : {}),
            onCacheStatus: (status) => {
              cacheStatus = status;
            }
          }
        );
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }

        throw new AppError(
          ErrorCode.EMBEDDING_FAILED,
          error instanceof Error ? error.message : 'Failed to embed query text'
        );
      }
      timings['embeddingMs'] = Date.now() - embeddingStartedAt;

      const hybridStartedAt = Date.now();
      const results = await runHybridSearch(
        pool,
        auth,
        input,
        {
          ...searchContext,
          queryEmbedding
        },
        options.strategyOverride
      );
      timings['hybridSqlMs'] = Date.now() - hybridStartedAt;
      options.onStrategy?.(results.strategy);

      // Shadow-mode Jev retrieval judging: best-effort and logged only — never
      // used to filter, rerank or gate graph expansion. A Jev failure
      // degrades to per-candidate skips and must never fail the search.
      const jevJudge = options.jevJudge ?? resolveEnvJevJudge();
      let jev: JevShadowObservation | undefined;
      if (jevJudge && results.results.length > 0) {
        const judgeStartedAt = Date.now();
        try {
          jev = await jevJudge({
            query,
            candidates: results.results.map((result) => ({
              entityId: result.entityId,
              chunkContent: result.chunkContent,
              entityType: result.entity.type,
              tags: result.entity.tags,
              similarity: result.similarity,
              score: result.score
            })),
            logger: options.logger
          });
        } catch (error) {
          // The judge is fail-open by contract; this guard keeps it true even
          // if the judge module itself regresses.
          jev = undefined;
          options.logger?.warn(
            {
              event: 'jev.unavailable',
              reason: error instanceof Error ? error.message : 'unknown error'
            },
            'jev shadow judge failed; skipping judgments'
          );
        }
        timings['jevMs'] = Date.now() - judgeStartedAt;
      }

      const edgeStartedAt = Date.now();
      const resultEntityIds = results.results.map((r) => r.entityId);
      if (!input.expandGraph) {
        const edgeSummaries = await fetchSearchEdgeSummaries(
          pool,
          auth,
          input,
          resultEntityIds
        );
        for (const result of results.results) {
          const summary = edgeSummaries.get(result.entityId);
          if (summary) {
            result.edges = summary;
          }
        }
      }

      if (input.expandGraph && results.results.length > 0) {
        // Batch graph expansion: 2 queries total instead of 2N
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
          const neighborContentProjection = input.includeContent ?? true
            ? 'content'
            : 'NULL::text AS content';
          const neighbors = await pool.query<{
            id: string; type: string; content: string | null; metadata: Record<string, unknown>;
          }>(
            `SELECT id, type, ${neighborContentProjection}, metadata FROM entities
             WHERE id = ANY($1)
               AND status IS DISTINCT FROM 'archived'
               AND ($2::text[] IS NULL OR type = ANY($2))
               AND visibility = ANY($3)
               AND ${ownerSqlCondition('owner', '$4')}
               AND ${scopedMemoryVisibilitySql('metadata', '$5')}`,
            [
              Array.from(allNeighborIds),
              auth.allowedTypes,
              auth.allowedVisibility,
              input.owner ?? null,
              auth.clientId
            ]
          );

          const neighborMap = new Map(neighbors.rows.map((n) => [n.id, n]));
          const edgeSummaryRows: SearchEdgeSummaryRow[] = [];

          for (const result of results.results) {
            const edgeInfo = edgesByEntityId.get(result.entityId);
            if (!edgeInfo) continue;
            const related = edgeInfo
              .map((info) => {
                const entity = neighborMap.get(info.entityId);
                if (!entity) return null;
                return { entity, relation: info.relation, direction: info.direction };
              })
              .filter((r): r is NonNullable<typeof r> => r !== null);
            result.related = related;

            for (const entry of related) {
              edgeSummaryRows.push({
                result_entity_id: result.entityId,
                relation: entry.relation
              });
            }
          }

          const edgeSummaries = buildSearchEdgeSummaries(edgeSummaryRows);
          for (const result of results.results) {
            const summary = edgeSummaries.get(result.entityId);
            if (summary) {
              result.edges = summary;
            }
          }
        }
      }

      timings['edgeMs'] = Date.now() - edgeStartedAt;
      timings['totalMs'] = Date.now() - startedAt;
      options.logger?.debug(
        {
          event: 'search.completed',
          cacheStatus,
          strategy: results.strategy,
          resultCount: results.results.length,
          timings,
          ...(jev ? { jev } : {})
        },
        'search completed'
      );

      return { results: results.results };
    })(),
    (error) => toAppError(error, 'Failed to search entities')
  );
}
