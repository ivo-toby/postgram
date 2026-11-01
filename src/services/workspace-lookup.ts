// Workspace lookup (spec 004, FR-039 / rest.md "GET /api/workspaces/lookup").
//
// Answers "which feature is this workspace linked to" by machine and path.
// The path may be inside a registered workspace (a subdirectory); the match
// is the longest visible workspace path ending at a slash boundary. No match
// and an unknown machine are normal empty answers, never errors.
import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import type { FeaturePullRequest, FeatureStage } from '../types/features.js';
import type { WorkspaceView } from '../types/workspaces.js';
import { AppError, ErrorCode } from '../util/errors.js';
import { toWhereFeature, type FeatureTaskRow } from './where-rules.js';
import {
  loadWorkspaceViews,
  type WorkspaceViewOptions
} from './workspace-query.js';
import { normalizeWorkspacePath } from './workspace-store.js';

export type LookupFeature = {
  id: string;
  title: string;
  stage: FeatureStage;
  pull_requests: FeaturePullRequest[];
};

export type LookupResult = {
  workspace: WorkspaceView | null;
  feature: LookupFeature | null;
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

export function lookupWorkspace(
  pool: Pool,
  auth: AuthContext,
  input: { machine: string; path: string },
  options: WorkspaceViewOptions
): ServiceResult<LookupResult> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      if (input.machine.trim() === '') {
        throw new AppError(ErrorCode.VALIDATION, 'machine must not be empty');
      }
      if (!input.path.startsWith('/')) {
        throw new AppError(ErrorCode.VALIDATION, 'path must be absolute');
      }

      const path = normalizeWorkspacePath(input.path);

      const candidates = await pool.query<{ id: string }>(
        `
          SELECT w.id
          FROM workspaces w
          JOIN machines m ON m.id = w.machine_id
          WHERE m.alias = $1
            AND (w.path = $2 OR starts_with($2, w.path || '/') OR w.path = '/')
        `,
        [input.machine, path]
      );
      const ids = candidates.rows.map((row) => row.id);
      if (ids.length === 0) {
        return { workspace: null, feature: null };
      }

      // FR-040: loadWorkspaceViews drops the workspaces the caller cannot
      // see, so the longest match below is the longest *visible* match (D8).
      const views = await loadWorkspaceViews(
        pool,
        auth,
        { workspaceIds: ids },
        { now: new Date(), dormantAfterDays: options.dormantAfterDays }
      );
      if (views.length === 0) {
        return { workspace: null, feature: null };
      }

      const chosen = views.reduce((best, view) =>
        view.path.length > best.path.length ? view : best
      );

      if (chosen.feature_id === null) {
        return { workspace: chosen, feature: null };
      }

      const entity = await pool.query<FeatureTaskRow>(
        'SELECT id, content, status, metadata FROM entities WHERE id = $1',
        [chosen.feature_id]
      );
      const row = entity.rows[0];
      if (!row) {
        return { workspace: chosen, feature: null };
      }

      const summary = toWhereFeature(row);
      return {
        workspace: chosen,
        feature: {
          id: summary.id,
          title: summary.title,
          stage: summary.stage,
          pull_requests: summary.pull_requests
        }
      };
    })(),
    (error) => toAppError(error, 'Failed to look up workspace')
  );
}
