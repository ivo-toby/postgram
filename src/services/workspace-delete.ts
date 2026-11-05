// Workspace delete (spec 004 follow-up, rest.md "DELETE /api/workspaces/:id").
//
// Removes one operational `workspaces` row; its `agent_sessions` cascade. The
// linked feature task and every other `entities` row are never touched.
import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import type { WorkspaceView } from '../types/workspaces.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';
import {
  loadWorkspaceViews,
  type WorkspaceViewOptions
} from './workspace-query.js';

const FULL_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `DELETE /api/workspaces/:id`: delete scope required. Unknown or invisible
 * workspaces are NOT_FOUND. Returns the view of the removed workspace.
 */
export function deleteWorkspace(
  pool: Pool,
  auth: AuthContext,
  input: { id: string },
  options: WorkspaceViewOptions
): ServiceResult<WorkspaceView> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'delete');

      if (!FULL_UUID_REGEX.test(input.id)) {
        throw new AppError(ErrorCode.NOT_FOUND, 'workspace not found');
      }

      const views = await loadWorkspaceViews(
        pool,
        auth,
        { workspaceIds: [input.id], includeEnded: true },
        { now: new Date(), dormantAfterDays: options.dormantAfterDays }
      );
      const view = views[0];
      if (view === undefined) {
        throw new AppError(ErrorCode.NOT_FOUND, 'workspace not found');
      }

      await pool.query('DELETE FROM workspaces WHERE id = $1', [input.id]);
      await appendAuditEntry(pool, {
        apiKeyId: auth.apiKeyId,
        operation: 'workspace_delete',
        entityId: input.id,
        details: {
          path: view.path,
          machine: view.machine,
          feature_id: view.feature_id
        }
      });

      return view;
    })(),
    (error) =>
      error instanceof AppError
        ? error
        : new AppError(ErrorCode.INTERNAL, 'Failed to delete workspace')
  );
}
