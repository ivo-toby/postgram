import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import type {
  Entity,
  EntityType,
  EntityStatus,
  EnrichmentStatus,
  Visibility
} from '../types/entities.js';
import type { RepositorySetting } from '../types/features.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';
import { normalizeRemote } from '../util/git-remote.js';
import { storeEntity } from './entity-service.js';
import { featureDefaults } from './feature-rules.js';

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

const FULL_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHORT_ID_REGEX = /^[0-9a-f]{8}$/;

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

function candidateTitle(content: string | null): string {
  return (content ?? '').split('\n')[0]?.trim().slice(0, 80) ?? '';
}

export function resolveFeatureId(
  pool: Pool,
  auth: AuthContext,
  id: string
): ServiceResult<Entity> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const isFullUuid = FULL_UUID_REGEX.test(id);
      const isShortId = SHORT_ID_REGEX.test(id);
      if (!isFullUuid && !isShortId) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'feature id must be a full UUID or an 8-hex short id'
        );
      }

      if (isFullUuid) {
        const result = await pool.query<EntityRow>(
          'SELECT * FROM entities WHERE id = $1',
          [id]
        );
        const row = result.rows[0];
        if (
          !row ||
          !auth.allowedVisibility.includes(row.visibility) ||
          (auth.allowedTypes !== null && !auth.allowedTypes.includes(row.type))
        ) {
          throw new AppError(ErrorCode.NOT_FOUND, 'feature not found');
        }
        if (row.type !== 'task') {
          throw new AppError(
            ErrorCode.VALIDATION,
            'feature id refers to a non-task entity'
          );
        }
        return mapEntity(row);
      }

      if (auth.allowedTypes !== null && !auth.allowedTypes.includes('task')) {
        throw new AppError(ErrorCode.NOT_FOUND, 'feature not found');
      }

      const result = await pool.query<EntityRow>(
        `
          SELECT *
          FROM entities
          WHERE type = 'task'
            AND status IS DISTINCT FROM 'archived'
            AND id::text LIKE $1 || '%'
            AND visibility = ANY($2)
          ORDER BY id
        `,
        [id, auth.allowedVisibility]
      );

      if (result.rows.length === 0) {
        throw new AppError(ErrorCode.NOT_FOUND, 'feature not found');
      }

      if (result.rows.length > 1) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `short id '${id}' matches multiple tasks`,
          {
            candidates: result.rows.map((row) => ({
              id: row.id,
              title: candidateTitle(row.content)
            }))
          }
        );
      }

      const row = result.rows[0];
      if (!row) {
        throw new AppError(ErrorCode.NOT_FOUND, 'feature not found');
      }
      return mapEntity(row);
    })(),
    (error) => toAppError(error, 'Failed to resolve feature id')
  );
}

export function createFeature(
  pool: Pool,
  auth: AuthContext,
  input: {
    content: string;
    tags?: string[] | undefined;
    visibility?: Visibility | undefined;
  }
): ServiceResult<Entity> {
  return ResultAsync.fromPromise(
    (async () => {
      if (typeof input.content !== 'string' || input.content.trim() === '') {
        throw new AppError(ErrorCode.VALIDATION, 'content must not be empty');
      }

      return await storeEntity(pool, auth, {
        type: 'task',
        content: input.content,
        status: 'inbox',
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.visibility !== undefined
          ? { visibility: input.visibility }
          : {}),
        metadata: featureDefaults(new Date().toISOString())
      }).match(
        (value) => value,
        (error) => {
          throw error;
        }
      );
    })(),
    (error) => toAppError(error, 'Failed to create feature')
  );
}

export function setRepositoryReleaseOnMerge(
  pool: Pool,
  auth: AuthContext,
  input: { remote: string; releaseOnMerge: boolean }
): ServiceResult<RepositorySetting> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'write');

      const remote = normalizeRemote(input.remote);
      if (remote === '') {
        throw new AppError(ErrorCode.VALIDATION, 'remote must not be empty');
      }

      const result = await pool.query<{
        remote: string;
        release_on_merge: boolean;
        previous_release_on_merge: boolean | null;
      }>(
        `
          WITH previous AS (
            SELECT release_on_merge
            FROM repositories
            WHERE remote = $1
          ),
          upserted AS (
            INSERT INTO repositories (remote, release_on_merge, updated_at)
            VALUES ($1, $2, now())
            ON CONFLICT (remote)
            DO UPDATE SET release_on_merge = EXCLUDED.release_on_merge,
                          updated_at = EXCLUDED.updated_at
            RETURNING remote, release_on_merge
          )
          SELECT
            upserted.remote,
            upserted.release_on_merge,
            (SELECT release_on_merge FROM previous) AS previous_release_on_merge
          FROM upserted
        `,
        [remote, input.releaseOnMerge]
      );

      const row = result.rows[0];
      if (!row) {
        throw new AppError(
          ErrorCode.INTERNAL,
          'Failed to set repository release_on_merge'
        );
      }

      const setting: RepositorySetting = {
        remote: row.remote,
        release_on_merge: row.release_on_merge
      };

      if (
        row.previous_release_on_merge === null ||
        row.previous_release_on_merge !== row.release_on_merge
      ) {
        await appendAuditEntry(pool, {
          apiKeyId: auth.apiKeyId,
          operation: 'repository_update',
          entityId: null,
          details: {
            remote: setting.remote,
            release_on_merge: setting.release_on_merge
          }
        });
      }

      return setting;
    })(),
    (error) => toAppError(error, 'Failed to set repository release_on_merge')
  );
}
