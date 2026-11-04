// Workspace report orchestration (spec 004, data-model.md "Report
// transaction"). One `reportWorkspace` call is one transaction: validation and
// scope are checked before a connection is taken, so a rejected report writes
// nothing. Every persistence step lives in `workspace-store` / `session-store`;
// this module only owns the order, the audit entries and the response shape.
import { ResultAsync } from 'neverthrow';
import type { Pool, PoolClient } from 'pg';

import { requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import type {
  AgentKind,
  AgentSessionRow,
  GitSnapshot,
  ReportResult,
  ReportWarning,
  SessionRef
} from '../types/workspaces.js';
import { appendAuditEntry } from '../util/audit.js';
import { AppError, ErrorCode } from '../util/errors.js';
import {
  applyHookSession,
  applyScanSessions,
  findTargetSession,
  interruptRebootedSessions
} from './session-store.js';
import type {
  ReportInput,
  ReportSession,
  ReportWorkspace
} from './workspace-report-schema.js';
import { parseReportInput } from './workspace-report-schema.js';
import {
  loadFeatureSummary,
  normalizeWorkspacePath,
  resolveFeatureLink,
  upsertMachine,
  upsertWorkspace
} from './workspace-store.js';
import { toWorkspaceView } from './workspace-view.js';

export type ReportWorkspaceOptions = {
  dormantAfterDays: number;
};

type PendingAudit = {
  operation: string;
  entityId: string | null;
  details: Record<string, unknown>;
};

type ScanEntry = {
  agentKind: AgentKind;
  agentSessionId: string | null;
  observedAt: Date;
  cwd: string | null;
  transcriptPath: string | null;
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

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The transaction is already gone; the original error is the one callers
    // need, so a failed rollback is swallowed here.
  }
}

/**
 * Map the report's git key onto the store's snapshot rule.
 *
 * rest.md: an **omitted** key keeps the stored snapshot, an object replaces it
 * and `null` clears it ("not a git repository") with `git_state_at = now()`.
 * The store keeps the snapshot for an omitted key and writes the values it is
 * given for a snapshot object, so an explicit clear is passed as a snapshot
 * whose fields are all unknown.
 */
function gitSnapshotForStore(
  git: ReportWorkspace['git']
): GitSnapshot | undefined {
  if (git === undefined) {
    return undefined;
  }

  if (git === null) {
    return { dirty_count: null, unpushed_count: null, has_upstream: null };
  }

  return {
    dirty_count: git.dirty_count,
    unpushed_count: git.unpushed_count,
    has_upstream: git.has_upstream
  };
}

/** Validation guarantees `observed_at` on every scan session; anything else is
 * rejected as VALIDATION rather than silently using the server clock. */
function scanEntryOf(session: ReportSession): ScanEntry {
  const raw = session.observed_at;
  const parsed = raw === undefined ? Number.NaN : Date.parse(raw);

  if (Number.isNaN(parsed)) {
    throw new AppError(ErrorCode.VALIDATION, 'invalid session observed_at', {
      field: 'sessions.observed_at'
    });
  }

  return {
    agentKind: session.agent_kind,
    agentSessionId: session.agent_session_id,
    observedAt: new Date(parsed),
    cwd: session.cwd,
    transcriptPath: session.transcript_path
  };
}

function maxObservedAt(entries: ScanEntry[]): Date | null {
  let latest: Date | null = null;

  for (const entry of entries) {
    if (latest === null || entry.observedAt.getTime() > latest.getTime()) {
      latest = entry.observedAt;
    }
  }

  return latest;
}

function pushInterruptAudits(
  auditRows: PendingAudit[],
  sessionIds: string[]
): void {
  for (const sessionId of sessionIds) {
    auditRows.push({
      operation: 'session_interrupt',
      entityId: null,
      details: { session_id: sessionId, reason: 'reboot' }
    });
  }
}

async function writeAuditRows(
  client: PoolClient,
  auth: AuthContext,
  auditRows: PendingAudit[]
): Promise<void> {
  for (const row of auditRows) {
    await appendAuditEntry(client, {
      apiKeyId: auth.apiKeyId,
      operation: row.operation,
      entityId: row.entityId,
      details: row.details
    });
  }
}

async function loadWorkspaceSessions(
  client: PoolClient,
  workspaceId: string
): Promise<AgentSessionRow[]> {
  const result = await client.query<AgentSessionRow>(
    `
      SELECT id, workspace_id, agent_kind, agent_session_id, status, boot_id,
             cwd, transcript_path, started_at, last_activity_at, ended_at,
             end_reason
        FROM agent_sessions
       WHERE workspace_id = $1
       ORDER BY last_activity_at DESC, id DESC
    `,
    [workspaceId]
  );

  return result.rows;
}

async function runReportTransaction(
  client: PoolClient,
  auth: AuthContext,
  input: ReportInput,
  options: ReportWorkspaceOptions
): Promise<ReportResult> {
  // Structural changes are collected while the steps run and written once, so
  // an activity-only report writes no audit row at all (data-model step 6).
  const auditRows: PendingAudit[] = [];

  // Step 1: the machine. `boot_id` is stored for hook reports only.
  const machineResult = await upsertMachine(client, {
    alias: input.machine.alias,
    hostname: input.machine.hostname,
    bootId: input.machine.boot_id,
    source: input.source
  });
  const machine = machineResult.machine;

  if (machineResult.created) {
    auditRows.push({
      operation: 'machine_create',
      entityId: null,
      details: { alias: machine.alias }
    });
  }

  const workspaceInput = input.workspace;
  const hookSession = input.source === 'hook' ? input.session : undefined;
  // Validation requires `event` on a hook session; the fallback only keeps the
  // types total.
  const hookEvent = hookSession?.event ?? 'activity';

  // Identify S before anything else moves, so the reboot rule can exclude it.
  let targetSessionId: string | null = null;
  if (workspaceInput !== undefined && hookSession !== undefined) {
    targetSessionId = await findTargetSession(client, {
      machineId: machine.id,
      path: normalizeWorkspacePath(workspaceInput.path),
      agentKind: hookSession.agent_kind,
      agentSessionId: hookSession.agent_session_id,
      event: hookEvent
    });
  }

  // Step 2: the reboot rule (hook reports with a reported boot id only).
  const interruptedIds =
    input.source === 'hook' && input.machine.boot_id !== null
      ? await interruptRebootedSessions(client, {
          machineId: machine.id,
          bootId: input.machine.boot_id,
          excludeSessionId: targetSessionId
        })
      : [];

  const scanEntries =
    input.source === 'scan' ? input.sessions.map(scanEntryOf) : [];

  // Without a workspace only steps 1 and 2 run (rest.md, `workspace` row).
  if (workspaceInput === undefined) {
    pushInterruptAudits(auditRows, interruptedIds);
    await writeAuditRows(client, auth, auditRows);

    return {
      workspace: null,
      feature: null,
      interrupted_sessions: interruptedIds.length,
      warnings: []
    };
  }

  // Step 3: the workspace.
  const workspaceResult = await upsertWorkspace(client, {
    machineId: machine.id,
    source: input.source,
    path: workspaceInput.path,
    repoRemote: workspaceInput.repo_remote,
    repoRoot: workspaceInput.repo_root,
    branch: workspaceInput.branch,
    git: gitSnapshotForStore(workspaceInput.git),
    observedAt: input.source === 'scan' ? maxObservedAt(scanEntries) : null
  });

  // Step 4: the feature link. A warning leaves the stored link untouched.
  const linkResult = await resolveFeatureLink(client, auth, {
    workspaceId: workspaceResult.workspace.id,
    featureId: input.feature_id
  });
  const workspace = linkResult.workspace;
  const warnings: ReportWarning[] =
    linkResult.warning === null ? [] : [linkResult.warning];

  if (workspaceResult.created) {
    auditRows.push({
      operation: 'workspace_create',
      entityId: workspace.id,
      details: {}
    });
  }

  if (linkResult.linkChanged) {
    auditRows.push({
      operation: 'workspace_link',
      entityId: workspace.id,
      details: { feature_id: workspace.feature_id }
    });
  }

  // Step 5: the session(s).
  let sessionRef: SessionRef | null = null;
  let sessionRefs: SessionRef[] = [];

  if (input.source === 'hook') {
    if (hookSession !== undefined) {
      const applied = await applyHookSession(client, {
        workspaceId: workspace.id,
        targetSessionId,
        agentKind: hookSession.agent_kind,
        agentSessionId: hookSession.agent_session_id,
        event: hookEvent,
        bootId: input.machine.boot_id,
        reason: hookSession.reason ?? null,
        cwd: hookSession.cwd,
        transcriptPath: hookSession.transcript_path
      });

      sessionRef = { id: applied.session.id, status: applied.session.status };

      if (applied.created) {
        auditRows.push({
          operation: 'session_create',
          entityId: workspace.id,
          details: { session_id: applied.session.id }
        });
      }

      if (applied.ended) {
        auditRows.push({
          operation: 'session_end',
          entityId: workspace.id,
          details: { session_id: applied.session.id }
        });
      }
    }
  } else {
    const applied = await applyScanSessions(client, {
      workspaceId: workspace.id,
      sessions: scanEntries
    });

    sessionRefs = applied.map((entry) => ({
      id: entry.session.id,
      status: entry.session.status
    }));

    for (const entry of applied) {
      if (entry.created) {
        auditRows.push({
          operation: 'session_create',
          entityId: workspace.id,
          details: { session_id: entry.session.id }
        });
      }
    }
  }

  // Step 6: audit, after the data steps so only real structural changes land.
  pushInterruptAudits(auditRows, interruptedIds);
  await writeAuditRows(client, auth, auditRows);

  const sessions = await loadWorkspaceSessions(client, workspace.id);
  const view = toWorkspaceView({
    workspace,
    machine,
    sessions,
    now: new Date(),
    dormantAfterDays: options.dormantAfterDays
  });
  const feature = await loadFeatureSummary(client, auth, workspace.feature_id);

  return {
    workspace: view,
    ...(sessionRef !== null ? { session: sessionRef } : {}),
    ...(input.source === 'scan' ? { sessions: sessionRefs } : {}),
    feature,
    interrupted_sessions: interruptedIds.length,
    warnings
  };
}

/**
 * `POST /api/workspaces/report` (FR-012a, FR-014, FR-017, FR-019).
 *
 * Validation and the `write` scope are checked before a connection is taken,
 * so a rejected report writes nothing at all. Everything else runs in one
 * transaction that is rolled back on any error.
 */
export function reportWorkspace(
  pool: Pool,
  auth: AuthContext,
  input: unknown,
  options: ReportWorkspaceOptions
): ServiceResult<ReportResult> {
  return ResultAsync.fromPromise(
    (async () => {
      const parsed = parseReportInput(input);
      if (parsed.isErr()) {
        throw parsed.error;
      }

      requireScope(auth, 'write');

      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const result = await runReportTransaction(
          client,
          auth,
          parsed.value,
          options
        );
        await client.query('COMMIT');

        return result;
      } catch (error) {
        await rollbackQuietly(client);
        throw error;
      } finally {
        client.release();
      }
    })(),
    (error) => toAppError(error, 'Failed to record workspace report')
  );
}
