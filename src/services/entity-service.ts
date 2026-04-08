import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { checkTypeAccess, checkVisibilityAccess, requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { PaginatedResult, ServiceResult } from '../types/common.js';
import type {
  Entity,
  EntityStatus,
  EntityType,
  EnrichmentStatus,
  Visibility
} from '../types/entities.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';
import {
  matchesOwnerFilter,
  normalizeOwner,
  ownerSqlCondition
} from './owner-filter.js';

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
  total_count?: string;
};

type StoreEntityInput = {
  type: EntityType;
  content?: string | null | undefined;
  visibility?: Visibility | undefined;
  owner?: string | null | undefined;
  status?: EntityStatus | null | undefined;
  tags?: string[] | undefined;
  source?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
};

type UpdateEntityInput = {
  id: string;
  version: number;
  content?: string | null | undefined;
  visibility?: Visibility | undefined;
  status?: EntityStatus | null | undefined;
  tags?: string[] | undefined;
  source?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
};

type ListEntitiesInput = {
  type?: EntityType | undefined;
  status?: EntityStatus | undefined;
  visibility?: Visibility | undefined;
  owner?: string | undefined;
  tags?: string[] | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
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

function hasContent(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.trim().length > 0;
}

async function fetchEntityRow(
  pool: Pool,
  id: string
): Promise<EntityRow | null> {
  const result = await pool.query<EntityRow>(
    'SELECT * FROM entities WHERE id = $1 LIMIT 1',
    [id]
  );

  return result.rows[0] ?? null;
}

function assertEntityAccess(
  auth: AuthContext,
  entity: Entity,
  scope: 'read' | 'write' | 'delete'
): void {
  requireScope(auth, scope);
  checkTypeAccess(auth, entity.type);
  checkVisibilityAccess(auth, entity.visibility);
}

export function storeEntity(
  pool: Pool,
  auth: AuthContext,
  input: StoreEntityInput
): ServiceResult<Entity> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'write');
      checkTypeAccess(auth, input.type);
      checkVisibilityAccess(auth, input.visibility ?? 'shared');

      const result = await pool.query<EntityRow>(
        `
          INSERT INTO entities (
            type,
            content,
            visibility,
            owner,
            status,
            enrichment_status,
            tags,
            source,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `,
        [
          input.type,
          input.content ?? null,
          input.visibility ?? 'shared',
          normalizeOwner(input.owner),
          input.status ?? null,
          hasContent(input.content) ? 'pending' : null,
          input.tags ?? [],
          input.source ?? null,
          input.metadata ?? {}
        ]
      );

      const row = result.rows[0];
      if (!row) {
        throw new AppError(ErrorCode.INTERNAL, 'Failed to store entity');
      }

      const entity = mapEntity(row);
      await appendAuditEntry(pool, {
        apiKeyId: auth.apiKeyId,
        operation: 'store',
        entityId: entity.id,
        details: {
          type: entity.type
        }
      });

      return entity;
    })(),
    (error) => toAppError(error, 'Failed to store entity')
  );
}

export function recallEntity(
  pool: Pool,
  auth: AuthContext,
  id: string,
  options: {
    owner?: string | undefined;
  } = {}
): ServiceResult<Entity> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const row = await fetchEntityRow(pool, id);
      if (!row) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Entity not found');
      }

      const entity = mapEntity(row);
      checkTypeAccess(auth, entity.type);
      checkVisibilityAccess(auth, entity.visibility);
      if (!matchesOwnerFilter(entity.owner, options.owner)) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Entity not found');
      }
      return entity;
    })(),
    (error) => toAppError(error, 'Failed to recall entity')
  );
}

export function updateEntity(
  pool: Pool,
  auth: AuthContext,
  input: UpdateEntityInput
): ServiceResult<Entity> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'write');

      const existingRow = await fetchEntityRow(pool, input.id);
      if (!existingRow) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Entity not found');
      }

      const existing = mapEntity(existingRow);
      checkTypeAccess(auth, existing.type);
      checkVisibilityAccess(auth, existing.visibility);

      const nextVisibility = input.visibility ?? existing.visibility;
      checkVisibilityAccess(auth, nextVisibility);

      if (existing.version !== input.version) {
        throw new AppError(ErrorCode.CONFLICT, 'Version conflict', {
          current: existing
        });
      }

      const nextContent =
        input.content === undefined ? existing.content : input.content;
      const contentChanged =
        input.content !== undefined && input.content !== existing.content;
      const nextMetadata = input.metadata
        ? {
            ...existing.metadata,
            ...input.metadata
          }
        : existing.metadata;

      const client = await pool.connect();
      let updatedRow: EntityRow | undefined;

      try {
        await client.query('BEGIN');
        const result = await client.query<EntityRow>(
          `
            UPDATE entities
            SET
              content = $2,
              visibility = $3,
              status = $4,
              enrichment_status = $5,
              tags = $6,
              source = $7,
              metadata = $8,
              version = version + 1,
              enrichment_attempts = CASE WHEN $10 THEN 0 ELSE enrichment_attempts END
            WHERE id = $1
              AND version = $9
            RETURNING *
          `,
          [
            input.id,
            nextContent ?? null,
            nextVisibility,
            input.status === undefined ? existing.status : input.status,
            hasContent(nextContent)
              ? contentChanged
                ? 'pending'
                : existing.enrichmentStatus
              : null,
            input.tags ?? existing.tags,
            input.source === undefined ? existing.source : input.source,
            nextMetadata,
            input.version,
            contentChanged
          ]
        );

        updatedRow = result.rows[0];
        if (!updatedRow) {
          await client.query('ROLLBACK');
          const currentRow = await fetchEntityRow(pool, input.id);
          throw new AppError(ErrorCode.CONFLICT, 'Version conflict', {
            current: currentRow ? mapEntity(currentRow) : existing
          });
        }

        if (contentChanged) {
          await client.query('DELETE FROM chunks WHERE entity_id = $1', [
            input.id
          ]);
        }

        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore rollback errors so the original failure is preserved.
        }
        throw error;
      } finally {
        client.release();
      }

      if (!updatedRow) {
        throw new AppError(ErrorCode.INTERNAL, 'Failed to update entity');
      }

      const updatedEntity = mapEntity(updatedRow);
      await appendAuditEntry(pool, {
        apiKeyId: auth.apiKeyId,
        operation: 'update',
        entityId: updatedEntity.id,
        details: {
          type: updatedEntity.type
        }
      });

      return updatedEntity;
    })(),
    (error) => toAppError(error, 'Failed to update entity')
  );
}

export function softDeleteEntity(
  pool: Pool,
  auth: AuthContext,
  id: string
): ServiceResult<{ id: string; deleted: true }> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'delete');

      const existingRow = await fetchEntityRow(pool, id);
      if (!existingRow) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Entity not found');
      }

      const existing = mapEntity(existingRow);

      assertEntityAccess(auth, existing, 'delete');

      const result = await pool.query(
        `
          UPDATE entities
          SET status = 'archived'
          WHERE id = $1
        `,
        [id]
      );

      if (result.rowCount !== 1) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Entity not found');
      }

      await appendAuditEntry(pool, {
        apiKeyId: auth.apiKeyId,
        operation: 'delete',
        entityId: id,
        details: {
          type: existing.type
        }
      });

      return {
        id,
        deleted: true as const
      };
    })(),
    (error) => toAppError(error, 'Failed to delete entity')
  );
}

export function listEntities(
  pool: Pool,
  auth: AuthContext,
  input: ListEntitiesInput = {}
): ServiceResult<PaginatedResult<Entity>> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const limit = input.limit ?? 50;
      const offset = input.offset ?? 0;

      const result = await pool.query<EntityRow>(
        `
          SELECT
            *,
            COUNT(*) OVER()::text AS total_count
          FROM entities
          WHERE ($1::text IS NULL OR type = $1)
            AND ($2::text IS NULL OR status = $2)
            AND ($3::text IS NULL OR visibility = $3)
            AND ${ownerSqlCondition('owner', '$4')}
            AND ($5::text[] IS NULL OR tags @> $5)
            AND ($6::text[] IS NULL OR type = ANY($6))
            AND visibility = ANY($7)
          ORDER BY created_at DESC
          LIMIT $8
          OFFSET $9
        `,
        [
          input.type ?? null,
          input.status ?? null,
          input.visibility ?? null,
          input.owner ?? null,
          input.tags?.length ? input.tags : null,
          auth.allowedTypes,
          auth.allowedVisibility,
          limit,
          offset
        ]
      );

      const items = result.rows.map(mapEntity);
      const total = result.rows[0]?.total_count
        ? Number(result.rows[0].total_count)
        : 0;

      return {
        items,
        total,
        limit,
        offset
      };
    })(),
    (error) => toAppError(error, 'Failed to list entities')
  );
}
