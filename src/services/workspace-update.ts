// Workspace update (spec 004, rest.md "PATCH /api/workspaces/:id").
//
// `updateWorkspace` links or unlinks a workspace to a feature (a plain task
// gets the feature defaults on a deliberate link, D1) and/or marks it
// missing or found. Everything is validated and resolved before the first
// write. Only a changed link writes a `workspace_link` audit row (D6).
import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import type { WorkspaceView } from '../types/workspaces.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';
import { updateEntity } from './entity-service.js';
import { resolveFeatureId } from './feature-service.js';
import { featureDefaults } from './feature-rules.js';
import {
  loadWorkspaceViews,
  type WorkspaceViewOptions
} from './workspace-query.js';

const FULL_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DEFAULTS_ATTEMPTS = 2;

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

async function applyFeatureDefaults(
  pool: Pool,
  auth: AuthContext,
  featureId: string
): Promise<void> {
  let lastConflict: AppError | null = null;

  for (let attempt = 0; attempt < DEFAULTS_ATTEMPTS; attempt += 1) {
    const resolved = await resolveFeatureId(pool, auth, featureId);
    if (resolved.isErr()) {
      throw resolved.error;
    }

    const task = resolved.value;
    if (task.metadata.kind === 'feature') {
      return;
    }

    const updated = await updateEntity(pool, auth, {
      id: task.id,
      version: task.version,
      metadata: {
        ...task.metadata,
        ...featureDefaults(new Date().toISOString())
      }
    });

    if (updated.isErr()) {
      if (updated.error.code === ErrorCode.CONFLICT) {
        lastConflict = updated.error;
        continue;
      }
      throw updated.error;
    }

    return;
  }

  throw lastConflict ?? new AppError(ErrorCode.CONFLICT, 'Version conflict');
}

/**
 * `PATCH /api/workspaces/:id` (FR-040): write scope required. At least one of
 * `featureId` and `missing` is required. `featureId` is a full UUID, an 8-hex
 * short id or null (unlink, which needs `personal` visibility, D9). Unknown or
 * invisible workspaces are NOT_FOUND; a non-task feature id is VALIDATION.
 */
export function updateWorkspace(
  pool: Pool,
  auth: AuthContext,
  input: {
    id: string;
    featureId?: string | null | undefined;
    missing?: boolean | undefined
  },
  options: WorkspaceViewOptions
): ServiceResult<WorkspaceView> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'write');

      if (input.featureId === undefined && input.missing === undefined) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'featureId or missing is required'
        );
      }

      if (!FULL_UUID_REGEX.test(input.id)) {
        throw new AppError(ErrorCode.NOT_FOUND, 'workspace not found');
      }

      const views = await loadWorkspaceViews(
        pool,
        auth,
        { workspaceIds: [input.id] },
        { now: new Date(), dormantAfterDays: options.dormantAfterDays }
      );
      const view = views[0];
      if (view === undefined) {
        throw new AppError(ErrorCode.NOT_FOUND, 'workspace not found');
      }

      let nextFeatureId = view.feature_id;

      if (input.featureId === null) {
        if (!auth.allowedVisibility.includes('personal')) {
          throw new AppError(
            ErrorCode.FORBIDDEN,
            'unlinking a workspace makes it personal'
          );
        }
        nextFeatureId = null;
      } else if (input.featureId !== undefined) {
        const resolved = await resolveFeatureId(pool, auth, input.featureId);
        if (resolved.isErr()) {
          throw resolved.error;
        }
        nextFeatureId = resolved.value.id;
        if (resolved.value.metadata.kind !== 'feature') {
          await applyFeatureDefaults(pool, auth, resolved.value.id);
        }
      }

      if (nextFeatureId !== view.feature_id) {
        await pool.query(
          'UPDATE workspaces SET feature_id = $1, updated_at = now() WHERE id = $2',
          [nextFeatureId, input.id]
        );
        await appendAuditEntry(pool, {
          apiKeyId: auth.apiKeyId,
          operation: 'workspace_link',
          entityId: input.id,
          details: { from: view.feature_id, to: nextFeatureId }
        });
      }

      if (input.missing === true) {
        await pool.query(
          'UPDATE workspaces SET missing_since = COALESCE(missing_since, now()) WHERE id = $1',
          [input.id]
        );
      } else if (input.missing === false) {
        await pool.query(
          'UPDATE workspaces SET missing_since = NULL WHERE id = $1',
          [input.id]
        );
      }

      const updated = await loadWorkspaceViews(
        pool,
        auth,
        { workspaceIds: [input.id] },
        { now: new Date(), dormantAfterDays: options.dormantAfterDays }
      );
      const updatedView = updated[0];
      if (updatedView === undefined) {
        throw new AppError(ErrorCode.INTERNAL, 'workspace not found after update');
      }
      return updatedView;
    })(),
    (error) => toAppError(error, 'Failed to update workspace')
  );
}
