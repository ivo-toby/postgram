import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { PaginatedResult, ServiceResult } from '../types/common.js';
import type {
  Entity,
  EntityStatus,
  EnrichmentStatus,
  Visibility
} from '../types/entities.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';
import { storeEntity, updateEntity } from './entity-service.js';

type EntityRow = {
  id: string;
  type: 'task';
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

type CreateTaskInput = {
  content: string;
  context?: string | undefined;
  status?: EntityStatus | undefined;
  dueDate?: string | undefined;
  tags?: string[] | undefined;
  visibility?: 'personal' | 'work' | 'shared' | undefined;
  metadata?: Record<string, unknown> | undefined;
};

type ListTasksInput = {
  status?: EntityStatus | undefined;
  context?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  includeArchived?: boolean | undefined;
};

type UpdateTaskInput = {
  id: string;
  version: number;
  content?: string | undefined;
  status?: EntityStatus | null | undefined;
  context?: string | undefined;
  dueDate?: string | undefined;
  tags?: string[] | undefined;
  visibility?: 'personal' | 'work' | 'shared' | undefined;
  metadata?: Record<string, unknown> | undefined;
};

type CompleteTaskInput = {
  id: string;
  version: number;
};

function mergeTaskMetadata(input: {
  context?: string | undefined;
  dueDate?: string | undefined;
  completedAt?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};

  if (input.context !== undefined) {
    metadata.context = input.context;
  }

  if (input.dueDate !== undefined) {
    metadata.due_date = input.dueDate;
  }

  if (input.completedAt !== undefined) {
    metadata.completed_at = input.completedAt;
  }

  return Object.keys({
    ...metadata,
    ...(input.metadata ?? {})
  }).length > 0
    ? {
        ...metadata,
        ...(input.metadata ?? {})
      }
    : undefined;
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

export function createTask(
  pool: Pool,
  auth: AuthContext,
  input: CreateTaskInput
) {
  return storeEntity(pool, auth, {
    type: 'task',
    content: input.content,
    status: input.status ?? 'inbox',
    visibility: input.visibility,
    tags: input.tags,
    metadata: mergeTaskMetadata({
      context: input.context,
      dueDate: input.dueDate,
      metadata: input.metadata
    })
  });
}

export function listTasks(
  pool: Pool,
  auth: AuthContext,
  input: ListTasksInput = {}
): ServiceResult<PaginatedResult<Entity>> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      if (auth.allowedTypes && !auth.allowedTypes.includes('task')) {
        return {
          items: [],
          total: 0,
          limit: input.limit ?? 50,
          offset: input.offset ?? 0
        } satisfies PaginatedResult<Entity>;
      }

      const limit = input.limit ?? 50;
      const offset = input.offset ?? 0;

      const result = await pool.query<EntityRow>(
        `
          SELECT
            *,
            COUNT(*) OVER()::text AS total_count
          FROM entities
          WHERE type = 'task'
            AND ($1::text IS NULL OR status = $1)
            AND ($2::boolean = true OR status IS DISTINCT FROM 'archived')
            AND ($3::text IS NULL OR metadata->>'context' = $3)
            AND visibility = ANY($4)
          ORDER BY created_at DESC
          LIMIT $5
          OFFSET $6
        `,
        [
          input.status ?? null,
          (input.includeArchived ?? false) || input.status === 'archived',
          input.context ?? null,
          auth.allowedVisibility,
          limit,
          offset
        ]
      );

      return {
        items: result.rows.map(mapEntity),
        total: result.rows[0]?.total_count
          ? Number(result.rows[0].total_count)
          : 0,
        limit,
        offset
      } satisfies PaginatedResult<Entity>;
    })(),
    (error) => toAppError(error, 'Failed to list tasks')
  );
}

export function updateTask(
  pool: Pool,
  auth: AuthContext,
  input: UpdateTaskInput
) {
  return updateEntity(pool, auth, {
    id: input.id,
    version: input.version,
    content: input.content,
    status: input.status,
    visibility: input.visibility,
    tags: input.tags,
    metadata: mergeTaskMetadata({
      context: input.context,
      dueDate: input.dueDate,
      metadata: input.metadata
    })
  });
}

export function completeTask(
  pool: Pool,
  auth: AuthContext,
  input: CompleteTaskInput
) {
  return ResultAsync.fromPromise(
    (async () => {
      const completed = await updateEntity(pool, auth, {
        id: input.id,
        version: input.version,
        status: 'done',
        metadata: mergeTaskMetadata({
          completedAt: new Date().toISOString()
        })
      }).match(
        (value) => value,
        (error) => {
          throw error;
        }
      );

      await appendAuditEntry(pool, {
        apiKeyId: auth.apiKeyId,
        operation: 'task_complete',
        entityId: completed.id,
        details: {
          type: 'task'
        }
      });

      return completed;
    })(),
    (error) => toAppError(error, 'Failed to complete task')
  );
}
