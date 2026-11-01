// `pgm where` core (spec 004, FR-026..FR-031): load the visible workspaces and
// feature tasks, then group them with `buildWhereGroups`.
import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import { AppError, ErrorCode } from '../util/errors.js';
import { normalizeRemote } from '../util/git-remote.js';
import {
  buildWhereGroups,
  isWhereView,
  toWhereFeature,
  type FeatureTaskRow,
  type WhereFeatureSummary,
  type WhereGroup,
  type WhereView
} from './where-rules.js';
import {
  loadWorkspaceViews,
  type WorkspaceViewOptions
} from './workspace-query.js';

export type WhereResult = {
  view: WhereView;
  generated_at: string;
  dormant_after_days: number;
  groups: WhereGroup[];
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

function taskTypeAllowed(auth: AuthContext): boolean {
  return auth.allowedTypes === null || auth.allowedTypes.includes('task');
}

async function loadFeatureTasks(
  pool: Pool,
  auth: AuthContext,
  workspaceFeatureIds: readonly string[]
): Promise<WhereFeatureSummary[]> {
  const result = await pool.query<FeatureTaskRow>(
    `
      SELECT id, content, status, metadata
        FROM entities
       WHERE type = 'task'
         AND visibility = ANY($1::text[])
         AND (metadata->>'kind' = 'feature' OR id = ANY($2::uuid[]))
    `,
    [auth.allowedVisibility, workspaceFeatureIds]
  );

  return result.rows.map(toWhereFeature);
}

/**
 * `GET /api/where` (FR-026..FR-031): read scope required. `view` is `stage`
 * (default) or `actions`. Workspaces are loaded with FR-040 visibility;
 * features are the allowed feature tasks plus the tasks linked by loaded
 * workspaces (decision D2: a linked task without a valid stage is building).
 */
export function getWhere(
  pool: Pool,
  auth: AuthContext,
  input: {
    view?: string | undefined;
    machine?: string | undefined;
    repo?: string | undefined;
    includeReleased?: boolean | undefined;
    includeDone?: boolean | undefined;
    includeEnded?: boolean | undefined;
  },
  options: WorkspaceViewOptions
): ServiceResult<WhereResult> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      let view: WhereView = 'stage';
      if (input.view !== undefined) {
        if (!isWhereView(input.view)) {
          throw new AppError(ErrorCode.VALIDATION, 'view must be stage or actions', {
            field: 'view'
          });
        }
        view = input.view;
      }

      const now = new Date();

      const workspaces = await loadWorkspaceViews(
        pool,
        auth,
        {
          ...(input.machine !== undefined ? { machine: input.machine } : {}),
          ...(input.repo !== undefined
            ? { repo: normalizeRemote(input.repo) }
            : {}),
          ...(input.includeEnded !== undefined
            ? { includeEnded: input.includeEnded }
            : {})
        },
        { now, dormantAfterDays: options.dormantAfterDays }
      );

      const features = taskTypeAllowed(auth)
        ? await loadFeatureTasks(
            pool,
            auth,
            [
              ...new Set(
                workspaces
                  .map((workspace) => workspace.feature_id)
                  .filter((id): id is string => id !== null)
              )
            ]
          )
        : [];

      const groups = buildWhereGroups({
        view,
        features,
        workspaces,
        includeReleased: input.includeReleased === true,
        includeDone: input.includeDone === true,
        filtered: input.machine !== undefined || input.repo !== undefined
      });

      return {
        view,
        generated_at: now.toISOString(),
        dormant_after_days: options.dormantAfterDays,
        groups
      };
    })(),
    (error) => toAppError(error, 'Failed to load where view')
  );
}
