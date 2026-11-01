// Workspace listing (spec 004, rest.md "GET /api/workspaces").
//
// `loadWorkspaceViews` is the shared query used by every workspace view: one
// query for the workspaces (with visibility, FR-040) and one for their
// sessions, then a `toWorkspaceView` per workspace. `listWorkspaces` adds the
// read scope check, repo normalization and feature id resolution.
import { ResultAsync } from 'neverthrow';
import type { Pool, PoolClient } from 'pg';

import { requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import type {
  AgentSessionRow,
  MachineRow,
  WorkspaceRow,
  WorkspaceView
} from '../types/workspaces.js';
import { AppError, ErrorCode } from '../util/errors.js';
import { normalizeRemote } from '../util/git-remote.js';
import { resolveFeatureId } from './feature-service.js';
import { toWorkspaceView } from './workspace-view.js';

export type WorkspaceViewOptions = { dormantAfterDays: number };

export type WorkspaceQuery = {
  machine?: string | undefined;
  repo?: string | undefined;
  featureId?: string | undefined;
  unassigned?: boolean | undefined;
  workspaceIds?: readonly string[] | undefined;
  includeEnded?: boolean | undefined;
};

type WorkspaceListRow = WorkspaceRow & {
  machine_alias: string;
  machine_hostname: string;
  machine_connect_target: string | null;
  machine_boot_id: string | null;
  machine_last_seen_at: Date;
  machine_created_at: Date;
  machine_updated_at: Date;
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

async function loadWorkspaceRows(
  db: Pool | PoolClient,
  auth: AuthContext,
  query: WorkspaceQuery
): Promise<WorkspaceListRow[]> {
  const params: unknown[] = [auth.allowedVisibility, taskTypeAllowed(auth)];

  // FR-040: an unlinked workspace is personal; a linked one follows its
  // feature (type task, visibility in allowedVisibility).
  const clauses = [
    "((w.feature_id IS NULL AND 'personal' = ANY($1::text[])) OR " +
      "(e.type = 'task' AND e.visibility = ANY($1::text[]) AND $2::boolean))"
  ];

  let next = 3;
  if (query.machine !== undefined) {
    clauses.push(`m.alias = $${next}`);
    params.push(query.machine);
    next += 1;
  }
  if (query.repo !== undefined) {
    clauses.push(`w.repo_remote = $${next}`);
    params.push(query.repo);
    next += 1;
  }
  if (query.featureId !== undefined) {
    clauses.push(`w.feature_id = $${next}::uuid`);
    params.push(query.featureId);
    next += 1;
  }
  if (query.unassigned === true) {
    clauses.push('w.feature_id IS NULL');
  }
  if (query.workspaceIds !== undefined) {
    clauses.push(`w.id = ANY($${next}::uuid[])`);
    params.push(query.workspaceIds);
    next += 1;
  }

  const result = await db.query<WorkspaceListRow>(
    `
      SELECT w.id, w.machine_id, w.path, w.repo_remote, w.repo_root,
             w.branch, w.git_dirty_count, w.git_unpushed_count,
             w.git_has_upstream, w.git_state_at, w.feature_id,
             w.missing_since, w.last_activity_at, w.created_at,
             w.updated_at,
             m.alias AS machine_alias, m.hostname AS machine_hostname,
             m.connect_target AS machine_connect_target,
             m.boot_id AS machine_boot_id,
             m.last_seen_at AS machine_last_seen_at,
             m.created_at AS machine_created_at,
             m.updated_at AS machine_updated_at
        FROM workspaces w
        JOIN machines m ON m.id = w.machine_id
        LEFT JOIN entities e ON e.id = w.feature_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY w.last_activity_at DESC, w.id ASC
    `,
    params
  );

  return result.rows;
}

async function loadSessionsByWorkspace(
  db: Pool | PoolClient,
  workspaceIds: readonly string[]
): Promise<Map<string, AgentSessionRow[]>> {
  const result = await db.query<AgentSessionRow>(
    `
      SELECT id, workspace_id, agent_kind, agent_session_id, status, boot_id,
             cwd, transcript_path, started_at, last_activity_at, ended_at,
             end_reason
        FROM agent_sessions
       WHERE workspace_id = ANY($1::uuid[])
       ORDER BY workspace_id, last_activity_at DESC, id DESC
    `,
    [workspaceIds]
  );

  const byWorkspace = new Map<string, AgentSessionRow[]>();
  for (const session of result.rows) {
    const list = byWorkspace.get(session.workspace_id) ?? [];
    list.push(session);
    byWorkspace.set(session.workspace_id, list);
  }

  return byWorkspace;
}

/**
 * Load and project the workspaces matching `query`. No scope check here:
 * callers check it. `now` is passed in so tests control dormancy.
 */
export async function loadWorkspaceViews(
  db: Pool | PoolClient,
  auth: AuthContext,
  query: WorkspaceQuery,
  options: { now: Date; dormantAfterDays: number }
): Promise<WorkspaceView[]> {
  const rows = await loadWorkspaceRows(db, auth, query);
  if (rows.length === 0) {
    return [];
  }

  const sessionsByWorkspace = await loadSessionsByWorkspace(
    db,
    rows.map((row) => row.id)
  );

  return rows.map((row) => {
    const workspace: WorkspaceRow = {
      id: row.id,
      machine_id: row.machine_id,
      path: row.path,
      repo_remote: row.repo_remote,
      repo_root: row.repo_root,
      branch: row.branch,
      git_dirty_count: row.git_dirty_count,
      git_unpushed_count: row.git_unpushed_count,
      git_has_upstream: row.git_has_upstream,
      git_state_at: row.git_state_at,
      feature_id: row.feature_id,
      missing_since: row.missing_since,
      last_activity_at: row.last_activity_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
    const machine: MachineRow = {
      id: row.machine_id,
      alias: row.machine_alias,
      hostname: row.machine_hostname,
      connect_target: row.machine_connect_target,
      boot_id: row.machine_boot_id,
      last_seen_at: row.machine_last_seen_at,
      created_at: row.machine_created_at,
      updated_at: row.machine_updated_at
    };

    return toWorkspaceView({
      workspace,
      machine,
      sessions: sessionsByWorkspace.get(row.id) ?? [],
      now: options.now,
      dormantAfterDays: options.dormantAfterDays,
      ...(query.includeEnded !== undefined
        ? { includeEnded: query.includeEnded }
        : {})
    });
  });
}

/**
 * `GET /api/workspaces` (FR-040): read scope required. `repo` accepts any
 * remote form (normalized), `featureId` a full UUID or 8-hex short id.
 * Workspaces are sorted by `last_activity_at` descending.
 */
export function listWorkspaces(
  pool: Pool,
  auth: AuthContext,
  input: {
    machine?: string | undefined;
    repo?: string | undefined;
    featureId?: string | undefined;
    unassigned?: boolean | undefined;
    includeEnded?: boolean | undefined;
  },
  options: WorkspaceViewOptions
): ServiceResult<WorkspaceView[]> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      if (input.featureId !== undefined && input.unassigned === true) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'featureId and unassigned are mutually exclusive'
        );
      }

      const feature =
        input.featureId !== undefined
          ? await resolveFeatureId(pool, auth, input.featureId)
          : null;
      if (feature !== null && feature.isErr()) {
        throw feature.error;
      }

      return loadWorkspaceViews(
        pool,
        auth,
        {
          ...(input.machine !== undefined ? { machine: input.machine } : {}),
          ...(input.repo !== undefined
            ? { repo: normalizeRemote(input.repo) }
            : {}),
          ...(feature !== null ? { featureId: feature.value.id } : {}),
          ...(input.unassigned !== undefined
            ? { unassigned: input.unassigned }
            : {}),
          ...(input.includeEnded !== undefined
            ? { includeEnded: input.includeEnded }
            : {})
        },
        { now: new Date(), dormantAfterDays: options.dormantAfterDays }
      );
    })(),
    (error) => toAppError(error, 'Failed to list workspaces')
  );
}
