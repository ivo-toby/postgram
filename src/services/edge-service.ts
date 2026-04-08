import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import {
  checkTypeAccess,
  checkVisibilityAccess,
  requireScope
} from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import type {
  EntityStatus,
  EntityType,
  Visibility
} from '../types/entities.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';
import {
  matchesOwnerFilter,
  ownerSqlCondition
} from './owner-filter.js';

export type Edge = {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  confidence: number;
  source: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type EdgeRow = {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  confidence: number;
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
};

type EntityAccessRow = {
  id: string;
  type: EntityType;
  visibility: Visibility;
  owner: string | null;
  status: EntityStatus | null;
};

type CreateEdgeInput = {
  sourceId: string;
  targetId: string;
  relation: string;
  confidence?: number | undefined;
  source?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

function mapEdge(row: EdgeRow): Edge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relation: row.relation,
    confidence: row.confidence,
    source: row.source,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString()
  };
}

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

function validateConfidence(confidence?: number): number {
  const resolved = confidence ?? 1.0;

  if (!Number.isFinite(resolved) || resolved < 0 || resolved > 1) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Confidence must be between 0 and 1'
    );
  }

  return resolved;
}

function validateDirection(
  direction: 'source' | 'target' | 'both' | undefined
): 'source' | 'target' | 'both' {
  const resolved = direction ?? 'both';
  if (!['source', 'target', 'both'].includes(resolved)) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Direction must be source, target, or both'
    );
  }

  return resolved;
}

function validateDepth(depth: number | undefined): number {
  const resolved = depth ?? 1;

  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 3) {
    throw new AppError(
      ErrorCode.VALIDATION,
      'Depth must be an integer between 1 and 3'
    );
  }

  return resolved;
}

async function enforceEntityAccess(
  pool: Pool,
  auth: AuthContext,
  entityIds: string[],
  scope: 'read' | 'write' | 'delete',
  owner?: string
): Promise<Map<string, EntityAccessRow>> {
  requireScope(auth, scope);

  const uniqueIds = [...new Set(entityIds)];
  const rows = await pool.query<EntityAccessRow>(
    `
      SELECT id, type, visibility, owner, status
      FROM entities
      WHERE id = ANY($1)
    `,
    [uniqueIds]
  );

  const entityMap = new Map(rows.rows.map((row) => [row.id, row]));

  for (const entityId of uniqueIds) {
    const entity = entityMap.get(entityId);
    if (!entity || entity.status === 'archived') {
      throw new AppError(ErrorCode.NOT_FOUND, 'Entity not found');
    }

    checkTypeAccess(auth, entity.type);
    checkVisibilityAccess(auth, entity.visibility);
    if (!matchesOwnerFilter(entity.owner, owner)) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Entity not found');
    }
  }

  return entityMap;
}

export function createEdge(
  pool: Pool,
  auth: AuthContext,
  input: CreateEdgeInput
): ServiceResult<Edge> {
  return ResultAsync.fromPromise(
    (async () => {
      if (input.sourceId === input.targetId) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'Self-edges are not supported'
        );
      }

      await enforceEntityAccess(
        pool,
        auth,
        [input.sourceId, input.targetId],
        'write'
      );

      const confidence = validateConfidence(input.confidence);

      const result = await pool.query<EdgeRow>(
        `
          INSERT INTO edges (source_id, target_id, relation, confidence, source, metadata)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (source_id, target_id, relation)
          DO UPDATE SET confidence = $4, metadata = $6, source = $5
          RETURNING *
        `,
        [
          input.sourceId,
          input.targetId,
          input.relation,
          confidence,
          input.source ?? 'manual',
          input.metadata ?? {}
        ]
      );

      const row = result.rows[0];
      if (!row) {
        throw new AppError(ErrorCode.INTERNAL, 'Failed to create edge');
      }

      await appendAuditEntry(pool, {
        apiKeyId: auth.apiKeyId,
        operation: 'edge.create',
        entityId: input.sourceId,
        details: { targetId: input.targetId, relation: input.relation }
      });

      return mapEdge(row);
    })(),
    (error) => toAppError(error, 'Failed to create edge')
  );
}

export function deleteEdge(
  pool: Pool,
  auth: AuthContext,
  edgeId: string
): ServiceResult<{ id: string; deleted: true }> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'delete');

      const edge = await pool.query<EdgeRow>(
        'SELECT * FROM edges WHERE id = $1',
        [edgeId]
      );
      const existing = edge.rows[0];
      if (!existing) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Edge not found');
      }

      await enforceEntityAccess(
        pool,
        auth,
        [existing.source_id, existing.target_id],
        'delete'
      );

      await pool.query('DELETE FROM edges WHERE id = $1', [edgeId]);

      await appendAuditEntry(pool, {
        apiKeyId: auth.apiKeyId,
        operation: 'edge.delete',
        details: { edgeId }
      });

      return { id: edgeId, deleted: true as const };
    })(),
    (error) => toAppError(error, 'Failed to delete edge')
  );
}

export function listEdges(
  pool: Pool,
  auth: AuthContext,
  entityId: string,
  options: {
    relation?: string | undefined;
    direction?: 'source' | 'target' | 'both' | undefined;
    owner?: string | undefined;
  } = {}
): ServiceResult<Edge[]> {
  return ResultAsync.fromPromise(
    (async () => {
      await enforceEntityAccess(pool, auth, [entityId], 'read', options.owner);

      const direction = validateDirection(options.direction);
      const conditions: string[] = [];
      const params: unknown[] = [entityId];

      if (direction === 'source') {
        conditions.push('edges.source_id = $1');
      } else if (direction === 'target') {
        conditions.push('edges.target_id = $1');
      } else {
        conditions.push('(edges.source_id = $1 OR edges.target_id = $1)');
      }

      let whereClause = conditions[0]!;
      if (options.relation) {
        params.push(options.relation);
        whereClause = `${whereClause} AND edges.relation = $${params.length}`;
      }

      const result = await pool.query<EdgeRow>(
        `
          SELECT edges.*
          FROM edges
          JOIN entities src ON src.id = edges.source_id
          JOIN entities tgt ON tgt.id = edges.target_id
          WHERE ${whereClause}
            AND src.status IS DISTINCT FROM 'archived'
            AND tgt.status IS DISTINCT FROM 'archived'
            AND ($${params.length + 1}::text[] IS NULL OR src.type = ANY($${params.length + 1}))
            AND ($${params.length + 1}::text[] IS NULL OR tgt.type = ANY($${params.length + 1}))
            AND src.visibility = ANY($${params.length + 2})
            AND tgt.visibility = ANY($${params.length + 2})
            AND ${ownerSqlCondition('src.owner', `$${params.length + 3}`)}
            AND ${ownerSqlCondition('tgt.owner', `$${params.length + 3}`)}
          ORDER BY edges.created_at DESC
        `,
        [...params, auth.allowedTypes, auth.allowedVisibility, options.owner ?? null]
      );

      return result.rows.map(mapEdge);
    })(),
    (error) => toAppError(error, 'Failed to list edges')
  );
}

export type ExpandResult = {
  entities: Array<{
    id: string;
    type: string;
    content: string | null;
    metadata: Record<string, unknown>;
  }>;
  edges: Edge[];
};

export function expandGraph(
  pool: Pool,
  auth: AuthContext,
  entityId: string,
  options: {
    depth?: number | undefined;
    relationTypes?: string[] | undefined;
    owner?: string | undefined;
  } = {}
): ServiceResult<ExpandResult> {
  return ResultAsync.fromPromise(
    (async () => {
      await enforceEntityAccess(pool, auth, [entityId], 'read', options.owner);

      const depth = validateDepth(options.depth);
      const relationFilter = options.relationTypes?.length
        ? options.relationTypes
        : null;

      const nodesResult = await pool.query<{ id: string }>(
        `
          WITH RECURSIVE reachable AS (
            SELECT $1::uuid AS id, 0 AS depth

            UNION

            SELECT
              CASE WHEN e.source_id = r.id THEN tgt.id ELSE src.id END AS id,
              r.depth + 1
            FROM edges e
            JOIN reachable r ON (e.source_id = r.id OR e.target_id = r.id)
            JOIN entities src ON src.id = e.source_id
            JOIN entities tgt ON tgt.id = e.target_id
            WHERE r.depth < $2
              AND ($3::text[] IS NULL OR e.relation = ANY($3))
              AND src.status IS DISTINCT FROM 'archived'
              AND tgt.status IS DISTINCT FROM 'archived'
              AND ($4::text[] IS NULL OR src.type = ANY($4))
              AND ($4::text[] IS NULL OR tgt.type = ANY($4))
              AND src.visibility = ANY($5)
              AND tgt.visibility = ANY($5)
              AND ${ownerSqlCondition('src.owner', '$6')}
              AND ${ownerSqlCondition('tgt.owner', '$6')}
          )
          SELECT DISTINCT id FROM reachable
        `,
        [
          entityId,
          depth,
          relationFilter,
          auth.allowedTypes,
          auth.allowedVisibility,
          options.owner ?? null
        ]
      );

      const reachableIds = nodesResult.rows.map((row) => row.id);

      const edgeRows = await pool.query<EdgeRow>(
        `
          SELECT *
          FROM edges
          WHERE source_id = ANY($1)
            AND target_id = ANY($1)
            AND ($2::text[] IS NULL OR relation = ANY($2))
        `,
        [reachableIds, relationFilter]
      );

      const entityRows = await pool.query<{
        id: string;
        type: string;
        content: string | null;
        metadata: Record<string, unknown>;
      }>(
        `
          SELECT id, type, content, metadata
          FROM entities
          WHERE id = ANY($1)
            AND status IS DISTINCT FROM 'archived'
            AND ($2::text[] IS NULL OR type = ANY($2))
            AND visibility = ANY($3)
            AND ${ownerSqlCondition('owner', '$4')}
        `,
        [reachableIds, auth.allowedTypes, auth.allowedVisibility, options.owner ?? null]
      );

      return {
        entities: entityRows.rows,
        edges: edgeRows.rows.map(mapEdge)
      };
    })(),
    (error) => toAppError(error, 'Failed to expand graph')
  );
}
