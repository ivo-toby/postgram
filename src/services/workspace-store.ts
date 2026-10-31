import type { PoolClient } from 'pg';

import type { AuthContext } from '../auth/types.js';
import type { EntityType, Visibility } from '../types/entities.js';
import type {
  GitSnapshot,
  MachineRow,
  ReportFeature,
  ReportSource,
  ReportWarning,
  WorkspaceRow
} from '../types/workspaces.js';
import { AppError, ErrorCode } from '../util/errors.js';

/**
 * SQL helpers for the workspace report transaction (spec 004, data-model
 * steps 1, 3 and 4). Every helper takes a `PoolClient` and runs only its own
 * statements: the caller owns BEGIN/COMMIT. All timestamps are server `now()`.
 */

const TITLE_MAX_LENGTH = 80;

type MachineUpsertRow = MachineRow & { inserted: boolean };
type WorkspaceUpsertRow = WorkspaceRow & { inserted: boolean };

type FeatureCandidateRow = {
  id: string;
  type: EntityType;
  visibility: Visibility;
};

type FeatureSummaryRow = {
  id: string;
  type: EntityType;
  content: string | null;
  visibility: Visibility;
  metadata: Record<string, unknown> | null;
};

export type UpsertMachineInput = {
  alias: string;
  hostname: string;
  bootId: string | null;
  source: ReportSource;
};

export type UpsertMachineResult = {
  machine: MachineRow;
  created: boolean;
};

export type UpsertWorkspaceInput = {
  machineId: string;
  source: ReportSource;
  path: string;
  repoRemote?: string | null | undefined;
  repoRoot?: string | null | undefined;
  branch?: string | null | undefined;
  git?: GitSnapshot | null | undefined;
  observedAt?: Date | null | undefined;
};

export type UpsertWorkspaceResult = {
  workspace: WorkspaceRow;
  created: boolean;
};

export type ResolveFeatureLinkInput = {
  workspaceId: string;
  featureId?: string | undefined;
};

export type ResolveFeatureLinkResult = {
  workspace: WorkspaceRow;
  linkChanged: boolean;
  warning: ReportWarning | null;
};

/** Workspaces store absolute paths with no trailing slash (data-model). */
export function normalizeWorkspacePath(path: string): string {
  const stripped = path.trim().replace(/\/+$/u, '');
  return stripped.length > 0 ? stripped : '/';
}

function isVisibleByType(auth: AuthContext): boolean {
  return auth.allowedTypes === null || auth.allowedTypes.includes('task');
}

export async function upsertMachine(
  client: PoolClient,
  input: UpsertMachineInput
): Promise<UpsertMachineResult> {
  const result = await client.query<MachineUpsertRow>(
    `
      INSERT INTO machines (
        alias,
        hostname,
        boot_id,
        last_seen_at,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        CASE WHEN $4::text = 'hook' THEN $3::text ELSE NULL END,
        now(),
        now(),
        now()
      )
      ON CONFLICT (alias) DO UPDATE SET
        hostname = EXCLUDED.hostname,
        boot_id = CASE
          WHEN $4::text = 'hook' AND $3::text IS NOT NULL THEN $3::text
          ELSE machines.boot_id
        END,
        last_seen_at = now(),
        updated_at = now()
      RETURNING *, (xmax = 0) AS inserted
    `,
    [input.alias, input.hostname, input.bootId, input.source]
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(ErrorCode.INTERNAL, 'machine upsert failed');
  }

  const { inserted, ...machine } = row;

  return { machine, created: inserted };
}

export async function upsertWorkspace(
  client: PoolClient,
  input: UpsertWorkspaceInput
): Promise<UpsertWorkspaceResult> {
  const gitPresent = input.git !== undefined;
  const dirtyCount = input.git?.dirty_count ?? null;
  const unpushedCount = input.git?.unpushed_count ?? null;
  const hasUpstream = input.git?.has_upstream ?? null;
  const observedAt = input.observedAt ?? null;

  const result = await client.query<WorkspaceUpsertRow>(
    `
      INSERT INTO workspaces (
        machine_id,
        path,
        repo_remote,
        repo_root,
        branch,
        git_dirty_count,
        git_unpushed_count,
        git_has_upstream,
        git_state_at,
        missing_since,
        last_activity_at,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3::text,
        $4::text,
        $5::text,
        $6::int,
        $7::int,
        $8::boolean,
        CASE WHEN $9::boolean THEN now() ELSE NULL END,
        NULL,
        CASE
          WHEN $10::text = 'hook' THEN now()
          ELSE COALESCE($11::timestamptz, now())
        END,
        now(),
        now()
      )
      ON CONFLICT (machine_id, path) DO UPDATE SET
        repo_remote = CASE
          WHEN $12::boolean THEN $3::text
          ELSE workspaces.repo_remote
        END,
        repo_root = CASE
          WHEN $13::boolean THEN $4::text
          ELSE workspaces.repo_root
        END,
        branch = CASE
          WHEN $14::boolean THEN $5::text
          ELSE workspaces.branch
        END,
        git_dirty_count = CASE
          WHEN $9::boolean THEN $6::int
          ELSE workspaces.git_dirty_count
        END,
        git_unpushed_count = CASE
          WHEN $9::boolean THEN $7::int
          ELSE workspaces.git_unpushed_count
        END,
        git_has_upstream = CASE
          WHEN $9::boolean THEN $8::boolean
          ELSE workspaces.git_has_upstream
        END,
        git_state_at = CASE
          WHEN $9::boolean THEN now()
          ELSE workspaces.git_state_at
        END,
        missing_since = NULL,
        last_activity_at = CASE
          WHEN $10::text = 'hook' THEN now()
          ELSE GREATEST(workspaces.last_activity_at, $11::timestamptz)
        END,
        updated_at = now()
      RETURNING *, (xmax = 0) AS inserted
    `,
    [
      input.machineId,
      normalizeWorkspacePath(input.path),
      input.repoRemote ?? null,
      input.repoRoot ?? null,
      input.branch ?? null,
      dirtyCount,
      unpushedCount,
      hasUpstream,
      gitPresent,
      input.source,
      observedAt,
      input.repoRemote !== undefined,
      input.repoRoot !== undefined,
      input.branch !== undefined
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(ErrorCode.INTERNAL, 'workspace upsert failed');
  }

  const { inserted, ...workspace } = row;

  return { workspace, created: inserted };
}

export async function resolveFeatureLink(
  client: PoolClient,
  auth: AuthContext,
  input: ResolveFeatureLinkInput
): Promise<ResolveFeatureLinkResult> {
  const currentResult = await client.query<WorkspaceRow>(
    'SELECT * FROM workspaces WHERE id = $1 LIMIT 1',
    [input.workspaceId]
  );

  const current = currentResult.rows[0];
  if (!current) {
    throw new AppError(ErrorCode.INTERNAL, 'workspace not found');
  }

  if (input.featureId === undefined) {
    return { workspace: current, linkChanged: false, warning: null };
  }

  const candidateResult = await client.query<FeatureCandidateRow>(
    'SELECT id, type, visibility FROM entities WHERE id = $1 LIMIT 1',
    [input.featureId]
  );

  const candidate = candidateResult.rows[0];

  if (
    !candidate ||
    !auth.allowedVisibility.includes(candidate.visibility) ||
    !isVisibleByType(auth)
  ) {
    return {
      workspace: current,
      linkChanged: false,
      warning: 'feature_not_found'
    };
  }

  if (candidate.type !== 'task') {
    return {
      workspace: current,
      linkChanged: false,
      warning: 'feature_not_task'
    };
  }

  if (current.feature_id === input.featureId) {
    return { workspace: current, linkChanged: false, warning: null };
  }

  const updatedResult = await client.query<WorkspaceRow>(
    `
      UPDATE workspaces
      SET feature_id = $1, updated_at = now()
      WHERE id = $2
      RETURNING *
    `,
    [input.featureId, input.workspaceId]
  );

  const updated = updatedResult.rows[0];
  if (!updated) {
    throw new AppError(ErrorCode.INTERNAL, 'workspace feature link failed');
  }

  return { workspace: updated, linkChanged: true, warning: null };
}

export async function loadFeatureSummary(
  client: PoolClient,
  auth: AuthContext,
  featureId: string | null
): Promise<ReportFeature | null> {
  if (!featureId) {
    return null;
  }

  const result = await client.query<FeatureSummaryRow>(
    `
      SELECT id, type, content, visibility, metadata
      FROM entities
      WHERE id = $1
      LIMIT 1
    `,
    [featureId]
  );

  const row = result.rows[0];
  if (
    !row ||
    row.type !== 'task' ||
    !auth.allowedVisibility.includes(row.visibility) ||
    !isVisibleByType(auth)
  ) {
    return null;
  }

  return {
    id: row.id,
    title: featureTitle(row.content),
    stage: featureStage(row.metadata)
  };
}

function featureTitle(content: string | null): string {
  const firstLine = (content ?? '').split('\n')[0] ?? '';
  return firstLine.trim().slice(0, TITLE_MAX_LENGTH);
}

function featureStage(metadata: Record<string, unknown> | null): string | null {
  const stage: unknown = metadata?.stage;
  return typeof stage === 'string' ? stage : null;
}
