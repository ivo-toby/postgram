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

// RRF's rank constant is deliberately kept in SQL below so that branch
// ranking, thresholding, deduplication and the final LIMIT all happen in
// Postgres. Only rows that survive get their entity and chunk content
// hydrated and shipped across the wire.
export const RRF_K = 60;
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
const MAX_KEYWORD_TERMS = 24;
// Bound the GIN hit set before the more expensive cover-density rank. This
// keeps common terms from ranking every matching chunk while leaving the
// vector candidate budget and fallback decision independent.
// Each probe is capped without an ORDER BY, so PostgreSQL may choose different
// members when more than 200 authorized chunks match. Membership is therefore
// intentionally bounded and unordered before the merged pool is ranked.
// If the full conjunction is absent and this cap overflows, independent probes
// can miss a chunk matching five of six terms; future intersection probes can
// address that only after evaluation justifies the extra work.
const KEYWORD_CANDIDATE_CAP = 200;

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

const EXACT_VECTOR_CANDIDATES_SQL = `
  SELECT
    e.id AS entity_id,
    c.id AS chunk_id,
    e.created_at,
    c.embedding <=> $1::vector AS distance
  FROM chunks c
  JOIN entities e ON e.id = c.entity_id
  WHERE ${hybridEntityFilterConditions('e')}
  ORDER BY (c.embedding <=> $1::vector) + 0
  LIMIT $9
`;

const HNSW_VECTOR_CANDIDATES_SQL = `
  SELECT
    e.id AS entity_id,
    c.id AS chunk_id,
    e.created_at,
    c.embedding <=> $1::vector AS distance
  FROM chunks c
  CROSS JOIN LATERAL (
    SELECT
      filtered.id,
      filtered.created_at
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
  vectorCandidateSql: string,
  includeContent: boolean
): string {
  const contentProjection = includeContent
    ? 'e.content'
    : 'NULL::text AS content';

  return `
    WITH keyword_terms AS MATERIALIZED (
      SELECT
        term,
        term_index,
        COUNT(*) OVER () AS term_count
      FROM unnest(regexp_split_to_array(trim($8::text), '\\s+'))
        WITH ORDINALITY AS words(term, term_index)
      WHERE term <> ''
    ),
    keyword_term_tokens AS MATERIALIZED (
      SELECT
        keyword_terms.term_index,
        keyword_terms.term,
        keyword_terms.term_count,
        tsvector_to_array(
          to_tsvector('simple', keyword_terms.term)
        ) AS lexemes
      FROM keyword_terms
    ),
    keyword_term_queries_raw AS MATERIALIZED (
      SELECT
        keyword_term_tokens.term_index,
        keyword_term_tokens.term,
        keyword_term_tokens.term_count,
        cardinality(
          keyword_term_tokens.lexemes
        )::integer AS lexeme_count,
        (
          SELECT string_agg(
            quote_literal(parsed.lexeme),
            ' & ' ORDER BY parsed.lexeme
          )
          FROM unnest(
            keyword_term_tokens.lexemes
          ) AS parsed(lexeme)
        )::tsquery AS query,
        keyword_term_tokens.lexemes
      FROM keyword_term_tokens
    ),
    keyword_term_queries_filtered AS MATERIALIZED (
      SELECT
        term_index,
        lexeme_count,
        query,
        term,
        term_count,
        lexemes
      FROM keyword_term_queries_raw
      WHERE lexeme_count > 0
        AND (term_count = 1
          OR to_tsvector('english', term) <> ''::tsvector
        )
    ),
    keyword_term_queries_distinct AS MATERIALIZED (
      SELECT DISTINCT ON (query::text)
        term_index,
        lexeme_count,
        query,
        term,
        term_count,
        lexemes
      FROM keyword_term_queries_filtered
      ORDER BY query::text, term_index
    ),
    keyword_term_queries AS MATERIALIZED (
      SELECT
        term_index,
        term,
        lexeme_count,
        query,
        lexemes,
        ROW_NUMBER() OVER (
          ORDER BY term_index
        )::integer AS retained_term_index
      FROM keyword_term_queries_distinct
      ORDER BY term_index
      LIMIT ${MAX_KEYWORD_TERMS}
    ),
    keyword_conjunctive_query AS MATERIALIZED (
      SELECT (
        SELECT string_agg(
          quote_literal(unique_lexemes.lexeme),
          ' & ' ORDER BY unique_lexemes.lexeme
        )
        FROM (
          SELECT DISTINCT parsed.lexeme
          FROM keyword_term_queries,
            unnest(keyword_term_queries.lexemes) AS parsed(lexeme)
        ) AS unique_lexemes
      )::tsquery AS query
    ),
    keyword_term_counts AS MATERIALIZED (
      SELECT
        COUNT(*)::integer AS retained_term_count,
        ((COUNT(*) + 1) / 2)::integer AS required_term_count
      FROM keyword_term_queries
    ),
    keyword_query_stats AS MATERIALIZED (
      SELECT
        keyword_term_counts.retained_term_count,
        keyword_term_counts.required_term_count,
        keyword_conjunctive_query.query AS conjunctive_query
      FROM keyword_term_counts
      CROSS JOIN keyword_conjunctive_query
    ),
    lexical_query AS MATERIALIZED (
      SELECT string_agg(
        '(' || query::text || ')',
        ' | ' ORDER BY retained_term_index
      )::tsquery AS query
      FROM keyword_term_queries
    ),
    vector_candidates AS MATERIALIZED (
      ${vectorCandidateSql}
    ),
    vector_below_threshold AS MATERIALIZED (
      SELECT chunk_id
      FROM vector_candidates
      WHERE 1 - distance < $15
    ),
    vector_below_threshold_content AS MATERIALIZED (
      SELECT
        vector_below_threshold.chunk_id,
        to_tsvector('simple', c.content) AS content_tsvector
      FROM vector_below_threshold
      JOIN chunks c ON c.id = vector_below_threshold.chunk_id
    ),
    vector_keyword_coverage AS MATERIALIZED (
      SELECT
        vector_below_threshold_content.chunk_id,
        keyword_query_stats.required_term_count,
        (
          SELECT COUNT(*)::integer
          FROM keyword_term_queries
          WHERE vector_below_threshold_content.content_tsvector
            @@ keyword_term_queries.query
        ) AS matched_term_count
      FROM vector_below_threshold_content
      CROSS JOIN keyword_query_stats
      WHERE keyword_query_stats.required_term_count > 0
    ),
    vector_keyword_matches AS MATERIALIZED (
      -- Above-floor vector candidates are already eligible; only below-floor
      -- candidates pay for term coverage. This does not create a keyword rank.
      SELECT
        vector_keyword_coverage.chunk_id,
        vector_keyword_coverage.matched_term_count
      FROM vector_keyword_coverage
      WHERE vector_keyword_coverage.matched_term_count
        >= vector_keyword_coverage.required_term_count
    ),
    vector_ranked AS MATERIALIZED (
      SELECT
        vector_candidates.*,
        1 - vector_candidates.distance AS similarity,
        (vector_keyword_matches.matched_term_count IS NOT NULL) AS keyword_match,
        ROW_NUMBER() OVER (
          ORDER BY vector_candidates.distance, vector_candidates.chunk_id
        )::integer AS vector_rank
      FROM vector_candidates
      LEFT JOIN vector_keyword_matches
        ON vector_keyword_matches.chunk_id = vector_candidates.chunk_id
    ),
    keyword_conjunctive_hits AS MATERIALIZED (
      SELECT
        0::integer AS probe_kind,
        NULL::integer AS term_index,
        0::integer AS probe_priority,
        NULL::integer AS rarity_hit_count,
        true AS conjunctive_match,
        keyword_query_stats.retained_term_count,
        keyword_query_stats.required_term_count,
        probe.entity_id,
        probe.chunk_id,
        probe.created_at
      FROM keyword_query_stats,
      LATERAL (
        SELECT
          e.id AS entity_id,
          c.id AS chunk_id,
          e.created_at
        FROM chunks c
        JOIN entities e ON e.id = c.entity_id
        WHERE keyword_query_stats.conjunctive_query IS NOT NULL
          AND to_tsvector('simple', c.content)
            @@ keyword_query_stats.conjunctive_query
          AND ${hybridEntityFilterConditions('e')}
        LIMIT $17
      ) AS probe
    ),
    keyword_conjunctive_stats AS MATERIALIZED (
      SELECT COUNT(*)::integer AS hit_count
      FROM keyword_conjunctive_hits
    ),
    keyword_or_probe_enabled AS MATERIALIZED (
      SELECT
        keyword_query_stats.retained_term_count,
        keyword_query_stats.required_term_count,
        lexical_query.query
      FROM keyword_query_stats
      CROSS JOIN keyword_conjunctive_stats
      CROSS JOIN lexical_query
      WHERE keyword_query_stats.retained_term_count > 1
        AND keyword_conjunctive_stats.hit_count < $17
        AND lexical_query.query IS NOT NULL
    ),
    keyword_or_hits AS MATERIALIZED (
      SELECT
        1::integer AS probe_kind,
        NULL::integer AS term_index,
        1::integer AS probe_priority,
        NULL::integer AS rarity_hit_count,
        EXISTS (
          SELECT 1
          FROM keyword_conjunctive_hits
          WHERE keyword_conjunctive_hits.chunk_id = probe.chunk_id
        ) AS conjunctive_match,
        keyword_or_probe_enabled.retained_term_count,
        keyword_or_probe_enabled.required_term_count,
        probe.entity_id,
        probe.chunk_id,
        probe.created_at
      FROM keyword_or_probe_enabled,
      LATERAL (
        SELECT
          e.id AS entity_id,
          c.id AS chunk_id,
          e.created_at
        FROM chunks c
        JOIN entities e ON e.id = c.entity_id
        WHERE to_tsvector('simple', c.content)
            @@ keyword_or_probe_enabled.query
          AND ${hybridEntityFilterConditions('e')}
        LIMIT ($17 + 1)
      ) AS probe
    ),
    keyword_or_stats AS MATERIALIZED (
      SELECT COUNT(*)::integer AS hit_count
      FROM keyword_or_hits
    ),
    keyword_probe_mode AS MATERIALIZED (
      SELECT
        keyword_query_stats.retained_term_count,
        keyword_query_stats.required_term_count,
        keyword_conjunctive_stats.hit_count AS conjunctive_hit_count,
        keyword_or_stats.hit_count AS or_hit_count
      FROM keyword_query_stats
      CROSS JOIN keyword_conjunctive_stats
      CROSS JOIN keyword_or_stats
    ),
    keyword_probe_enabled AS MATERIALIZED (
      SELECT
        keyword_probe_mode.retained_term_count,
        keyword_probe_mode.required_term_count
      FROM keyword_probe_mode
      WHERE keyword_probe_mode.retained_term_count > 1
        AND keyword_probe_mode.conjunctive_hit_count < $17
        AND keyword_probe_mode.or_hit_count > $17
    ),
    keyword_probe_hits AS MATERIALIZED (
      SELECT
        1::integer AS probe_kind,
        keyword_term_queries.retained_term_index AS term_index,
        CASE
          WHEN keyword_term_queries.lexeme_count > 1 THEN 0
          ELSE 1
        END AS probe_priority,
        COUNT(*) OVER (
          PARTITION BY keyword_term_queries.retained_term_index
        )::integer AS rarity_hit_count,
        false AS conjunctive_match,
        keyword_probe_enabled.retained_term_count,
        keyword_probe_enabled.required_term_count,
        probe.entity_id,
        probe.chunk_id,
        probe.created_at
      FROM keyword_term_queries
      CROSS JOIN keyword_probe_enabled,
      LATERAL (
        SELECT
          e.id AS entity_id,
          c.id AS chunk_id,
          e.created_at
        FROM chunks c
        JOIN entities e ON e.id = c.entity_id
        WHERE to_tsvector('simple', c.content) @@ keyword_term_queries.query
          AND ${hybridEntityFilterConditions('e')}
        LIMIT $17
      ) AS probe
    ),
    keyword_probe_sources AS MATERIALIZED (
      SELECT
        keyword_conjunctive_hits.probe_kind,
        keyword_conjunctive_hits.term_index,
        keyword_conjunctive_hits.probe_priority,
        keyword_conjunctive_hits.rarity_hit_count,
        keyword_conjunctive_hits.conjunctive_match,
        keyword_conjunctive_hits.retained_term_count,
        keyword_conjunctive_hits.required_term_count,
        keyword_conjunctive_hits.entity_id,
        keyword_conjunctive_hits.chunk_id,
        keyword_conjunctive_hits.created_at
      FROM keyword_conjunctive_hits
      CROSS JOIN keyword_probe_mode
      WHERE keyword_probe_mode.retained_term_count <= 1
        OR keyword_probe_mode.conjunctive_hit_count >= $17
        OR keyword_probe_mode.or_hit_count > $17

      UNION ALL

      SELECT
        keyword_or_hits.probe_kind,
        keyword_or_hits.term_index,
        keyword_or_hits.probe_priority,
        keyword_or_hits.rarity_hit_count,
        keyword_or_hits.conjunctive_match,
        keyword_or_hits.retained_term_count,
        keyword_or_hits.required_term_count,
        keyword_or_hits.entity_id,
        keyword_or_hits.chunk_id,
        keyword_or_hits.created_at
      FROM keyword_or_hits
      CROSS JOIN keyword_probe_mode
      WHERE keyword_probe_mode.retained_term_count > 1
        AND keyword_probe_mode.conjunctive_hit_count < $17
        AND keyword_probe_mode.or_hit_count <= $17

      UNION ALL

      SELECT
        keyword_probe_hits.probe_kind,
        keyword_probe_hits.term_index,
        keyword_probe_hits.probe_priority,
        keyword_probe_hits.rarity_hit_count,
        keyword_probe_hits.conjunctive_match,
        keyword_probe_hits.retained_term_count,
        keyword_probe_hits.required_term_count,
        keyword_probe_hits.entity_id,
        keyword_probe_hits.chunk_id,
        keyword_probe_hits.created_at
      FROM keyword_probe_hits
      -- The OR probe is capped at 201. An overflow keeps the independent
      -- rarity probes, while a complete OR pool skips this expensive branch.
    ),
    keyword_probe_deduplicated AS MATERIALIZED (
      SELECT DISTINCT ON (probes.chunk_id)
        probes.probe_kind,
        probes.term_index,
        probes.probe_priority,
        probes.rarity_hit_count,
        probes.conjunctive_match,
        probes.retained_term_count,
        probes.required_term_count,
        probes.entity_id,
        probes.chunk_id,
        probes.created_at
      FROM (
        SELECT *
        FROM keyword_probe_sources
      ) AS probes
      ORDER BY
        probes.chunk_id,
        probes.probe_kind,
        probes.rarity_hit_count ASC NULLS LAST,
        probes.probe_priority ASC NULLS LAST,
        probes.term_index ASC NULLS LAST
    ),
    keyword_probe_bounded AS MATERIALIZED (
      -- Rank only the bounded, de-duplicated GIN hit set; vector candidates
      -- keep their own cap. Rarer term probes are preferred so an exact
      -- identifier cannot be crowded out by a common standalone term.
      SELECT *
      FROM keyword_probe_deduplicated
      ORDER BY
        probe_kind,
        rarity_hit_count ASC NULLS LAST,
        probe_priority ASC NULLS LAST,
        term_index ASC NULLS LAST,
        chunk_id
      LIMIT $17
    ),
    keyword_matches_base AS MATERIALIZED (
      SELECT
        keyword_probe_bounded.entity_id,
        keyword_probe_bounded.chunk_id,
        keyword_probe_bounded.created_at,
        keyword_probe_bounded.probe_kind,
        keyword_probe_bounded.conjunctive_match,
        keyword_probe_bounded.required_term_count,
        keyword_probe_bounded.rarity_hit_count,
        keyword_probe_bounded.probe_priority,
        keyword_probe_bounded.term_index,
        1 - (c.embedding <=> $1::vector) AS similarity,
        to_tsvector('simple', c.content) AS content_tsvector,
        lexical_query.query
      FROM keyword_probe_bounded
      JOIN chunks c ON c.id = keyword_probe_bounded.chunk_id
      CROSS JOIN lexical_query
      WHERE lexical_query.query IS NOT NULL
    ),
    keyword_matches AS MATERIALIZED (
      SELECT
        keyword_matches_base.entity_id,
        keyword_matches_base.chunk_id,
        keyword_matches_base.created_at,
        keyword_matches_base.conjunctive_match,
        CASE
          -- A conjunctive hit is known to cover every retained term. A
          -- candidate above the similarity floor is already eligible, so
          -- only below-floor keyword candidates need content coverage.
          WHEN keyword_matches_base.conjunctive_match
            OR keyword_matches_base.similarity >= $15
          THEN keyword_matches_base.required_term_count
          ELSE (
            SELECT COUNT(*)::integer
            FROM keyword_term_queries
            WHERE keyword_matches_base.content_tsvector
              @@ keyword_term_queries.query
          )
        END AS matched_term_count,
        keyword_matches_base.required_term_count,
        keyword_matches_base.rarity_hit_count,
        keyword_matches_base.probe_priority,
        keyword_matches_base.term_index,
        keyword_matches_base.similarity,
        keyword_matches_base.content_tsvector,
        keyword_matches_base.query
      FROM keyword_matches_base
    ),
    keyword_candidates AS MATERIALIZED (
      SELECT
        keyword_matches.*,
        ts_rank_cd(content_tsvector, query, 34) AS lexical_rank
      FROM keyword_matches
      ORDER BY lexical_rank DESC, chunk_id
    ),
    keyword_ranked AS MATERIALIZED (
      SELECT
        keyword_candidates.*,
        (
          keyword_candidates.required_term_count > 0
          AND keyword_candidates.matched_term_count
            >= keyword_candidates.required_term_count
        ) AS keyword_match,
        ROW_NUMBER() OVER (
          ORDER BY lexical_rank DESC, chunk_id
        )::integer AS keyword_rank
      FROM keyword_candidates
    ),
    branch_candidates AS MATERIALIZED (
      SELECT
        entity_id,
        chunk_id,
        created_at,
        similarity,
        vector_rank,
        NULL::integer AS keyword_rank,
        keyword_match
      FROM vector_ranked
      UNION ALL
      SELECT
        entity_id,
        chunk_id,
        created_at,
        similarity,
        NULL::integer AS vector_rank,
        keyword_rank,
        keyword_match
      FROM keyword_ranked
    ),
    candidates AS MATERIALIZED (
      SELECT
        entity_id,
        chunk_id,
        created_at,
        MAX(similarity) AS similarity,
        MIN(vector_rank) AS vector_rank,
        MIN(keyword_rank) AS keyword_rank,
        BOOL_OR(keyword_match) AS keyword_match
      FROM branch_candidates
      GROUP BY entity_id, chunk_id, created_at
    ),
    eligible AS (
      SELECT
        candidates.*,
        (
          similarity >= $15
          OR keyword_match
        ) AS threshold_pass
      FROM candidates
    ),
    scored AS (
      SELECT
        eligible.*,
        (
          COALESCE(1.0 / (${RRF_K} + vector_rank), 0.0)
          + COALESCE(1.0 / (${RRF_K} + keyword_rank), 0.0)
        ) * (
          1 + $13::double precision * POWER(
            0.5,
            GREATEST(
              EXTRACT(EPOCH FROM ($14::timestamptz - created_at)),
              0
            ) / 86400.0 / ${RECENCY_HALF_LIFE_DAYS}.0
          )
        ) AS score
      FROM eligible
      WHERE threshold_pass
    ),
    deduplicated AS (
      SELECT
        scored.*,
        ROW_NUMBER() OVER (
          PARTITION BY entity_id
          ORDER BY
            score DESC,
            keyword_rank ASC NULLS LAST,
            vector_rank ASC NULLS LAST,
            chunk_id
        ) AS entity_rank
      FROM scored
    ),
    top_results AS MATERIALIZED (
      SELECT *
      FROM deduplicated
      WHERE entity_rank = 1
      ORDER BY
        score DESC,
        keyword_rank ASC NULLS LAST,
        vector_rank ASC NULLS LAST,
        entity_id
      LIMIT $16
    ),
    vector_stats AS (
      SELECT COUNT(*)::integer AS vector_candidate_count
      FROM vector_candidates
    )
    SELECT
      top_results.entity_id IS NOT NULL AS result_present,
      vector_stats.vector_candidate_count AS candidate_count,
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
    FROM vector_stats
    LEFT JOIN top_results ON true
    LEFT JOIN entities e ON e.id = top_results.entity_id
    LEFT JOIN chunks c ON c.id = top_results.chunk_id
    ORDER BY
      top_results.score DESC NULLS LAST,
      top_results.keyword_rank ASC NULLS LAST,
      top_results.vector_rank ASC NULLS LAST,
      top_results.entity_id
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
    ctx.limit,
    KEYWORD_CANDIDATE_CAP
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
    strategy === 'hnsw'
      ? HNSW_VECTOR_CANDIDATES_SQL
      : EXACT_VECTOR_CANDIDATES_SQL;
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
          timings
        },
        'search completed'
      );

      return { results: results.results };
    })(),
    (error) => toAppError(error, 'Failed to search entities')
  );
}
