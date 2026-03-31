import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { checkTypeAccess, checkVisibilityAccess, requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';

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
  if (error instanceof AppError) return error;
  if (error instanceof Error)
    return new AppError(ErrorCode.INTERNAL, fallbackMessage, { cause: error.message });
  return new AppError(ErrorCode.INTERNAL, fallbackMessage);
}

export function createEdge(
  pool: Pool, auth: AuthContext, input: CreateEdgeInput
): ServiceResult<Edge> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'write');

      // Fetch both entities with type and visibility for auth checks
      const entityRows = await pool.query<{ id: string; type: string; visibility: string }>(
        'SELECT id, type, visibility FROM entities WHERE id = ANY($1) AND status IS DISTINCT FROM \'archived\'',
        [input.sourceId === input.targetId ? [input.sourceId] : [input.sourceId, input.targetId]]
      );
      const expectedCount = input.sourceId === input.targetId ? 1 : 2;
      if (entityRows.rows.length < expectedCount) {
        throw new AppError(ErrorCode.NOT_FOUND, 'One or both entities not found');
      }
      for (const entity of entityRows.rows) {
        checkTypeAccess(auth, entity.type as never);
        checkVisibilityAccess(auth, entity.visibility as never);
      }

      const result = await pool.query<EdgeRow>(
        `
          INSERT INTO edges (source_id, target_id, relation, confidence, source, metadata)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (source_id, target_id, relation)
          DO UPDATE SET confidence = $4, metadata = $6, source = $5
          RETURNING *
        `,
        [
          input.sourceId, input.targetId, input.relation,
          input.confidence ?? 1.0, input.source ?? 'manual',
          input.metadata ?? {}
        ]
      );

      const row = result.rows[0];
      if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create edge');

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
  pool: Pool, auth: AuthContext, edgeId: string
): ServiceResult<{ id: string; deleted: true }> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'delete');

      const edge = await pool.query<EdgeRow>(
        'SELECT * FROM edges WHERE id = $1',
        [edgeId]
      );
      if (!edge.rows[0]) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Edge not found');
      }
      const endpoints = await pool.query<{ type: string; visibility: string }>(
        'SELECT type, visibility FROM entities WHERE id = ANY($1)',
        [[edge.rows[0].source_id, edge.rows[0].target_id]]
      );
      for (const entity of endpoints.rows) {
        checkTypeAccess(auth, entity.type as never);
        checkVisibilityAccess(auth, entity.visibility as never);
      }
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
  pool: Pool, auth: AuthContext, entityId: string,
  options: { relation?: string | undefined; direction?: 'source' | 'target' | 'both' | undefined } = {}
): ServiceResult<Edge[]> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const direction = options.direction ?? 'both';
      const conditions: string[] = [];
      const params: unknown[] = [entityId];

      if (direction === 'source') {
        conditions.push('source_id = $1');
      } else if (direction === 'target') {
        conditions.push('target_id = $1');
      } else {
        conditions.push('(source_id = $1 OR target_id = $1)');
      }

      let whereClause = conditions[0]!;
      if (options.relation) {
        params.push(options.relation);
        whereClause = `${whereClause} AND relation = $${params.length}`;
      }

      const result = await pool.query<EdgeRow>(
        `SELECT edges.* FROM edges
         JOIN entities src ON src.id = edges.source_id
         JOIN entities tgt ON tgt.id = edges.target_id
         WHERE ${whereClause}
           AND src.status IS DISTINCT FROM 'archived'
           AND tgt.status IS DISTINCT FROM 'archived'
           AND ($${params.length + 1}::text[] IS NULL OR src.type = ANY($${params.length + 1}))
           AND ($${params.length + 1}::text[] IS NULL OR tgt.type = ANY($${params.length + 1}))
           AND src.visibility = ANY($${params.length + 2})
           AND tgt.visibility = ANY($${params.length + 2})
         ORDER BY edges.created_at DESC`,
        [...params, auth.allowedTypes, auth.allowedVisibility]
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
  pool: Pool, auth: AuthContext,
  entityId: string,
  options: { depth?: number | undefined; relationTypes?: string[] | undefined } = {}
): ServiceResult<ExpandResult> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const depth = Math.min(options.depth ?? 1, 3);
      const relationFilter = options.relationTypes?.length
        ? options.relationTypes
        : null;

      const edgeRows = await pool.query<EdgeRow>(
        `
          WITH RECURSIVE graph AS (
            SELECT e.*, 1 AS depth
            FROM edges e
            WHERE (e.source_id = $1 OR e.target_id = $1)
              AND ($3::text[] IS NULL OR e.relation = ANY($3))

            UNION

            SELECT e.*, g.depth + 1
            FROM edges e
            JOIN graph g ON (
              e.source_id = g.target_id OR e.source_id = g.source_id
              OR e.target_id = g.source_id OR e.target_id = g.target_id
            )
            WHERE g.depth < $2
              AND ($3::text[] IS NULL OR e.relation = ANY($3))
              AND e.id != g.id
          )
          SELECT DISTINCT ON (id) id, source_id, target_id, relation, confidence, source, metadata, created_at
          FROM graph
        `,
        [entityId, depth, relationFilter]
      );

      const entityIds = new Set<string>([entityId]);
      for (const row of edgeRows.rows) {
        entityIds.add(row.source_id);
        entityIds.add(row.target_id);
      }

      const entityRows = await pool.query<{
        id: string; type: string; content: string | null; metadata: Record<string, unknown>;
      }>(
        `SELECT id, type, content, metadata FROM entities
         WHERE id = ANY($1)
           AND status IS DISTINCT FROM 'archived'
           AND ($2::text[] IS NULL OR type = ANY($2))
           AND visibility = ANY($3)`,
        [Array.from(entityIds), auth.allowedTypes, auth.allowedVisibility]
      );

      return {
        entities: entityRows.rows,
        edges: edgeRows.rows.map(mapEdge)
      };
    })(),
    (error) => toAppError(error, 'Failed to expand graph')
  );
}
