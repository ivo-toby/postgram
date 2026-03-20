import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import type { AuthContext } from '../auth/types.js';
import type { PaginatedResult, ServiceResult } from '../types/common.js';
import type { Entity, EntityStatus } from '../types/entities.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';
import { listEntities, storeEntity, updateEntity } from './entity-service.js';

type CreateTaskInput = {
  content: string;
  context?: string | undefined;
  status?: EntityStatus | undefined;
  dueDate?: string | undefined;
  tags?: string[] | undefined;
  visibility?: 'personal' | 'work' | 'shared' | undefined;
};

type ListTasksInput = {
  status?: EntityStatus | undefined;
  context?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
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
};

type CompleteTaskInput = {
  id: string;
  version: number;
};

function mergeTaskMetadata(input: {
  context?: string | undefined;
  dueDate?: string | undefined;
  completedAt?: string | undefined;
}): Record<string, string> | undefined {
  const metadata: Record<string, string> = {};

  if (input.context !== undefined) {
    metadata.context = input.context;
  }

  if (input.dueDate !== undefined) {
    metadata.due_date = input.dueDate;
  }

  if (input.completedAt !== undefined) {
    metadata.completed_at = input.completedAt;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
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
      dueDate: input.dueDate
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
      const listed = await listEntities(pool, auth, {
        type: 'task',
        status: input.status,
        limit: 500,
        offset: 0
      });

      const base = listed.match(
        (value) => value,
        (error) => {
          throw error;
        }
      );

      const filtered = base.items.filter((item) => {
        if (input.context === undefined) {
          return true;
        }

        return item.metadata.context === input.context;
      });

      const offset = input.offset ?? 0;
      const limit = input.limit ?? 50;

      return {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
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
      dueDate: input.dueDate
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
