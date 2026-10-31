/**
 * Pure projection helpers that turn workspace, machine and agent-session rows
 * into the workspace object returned by the report endpoints.
 *
 * These functions never read the database and never read the clock: `now` and
 * the dormancy threshold are always passed in by the caller.
 *
 * See specs/004-workspace-session-tracking/contracts/rest.md ("Workspace object").
 */

import type {
  AgentSessionRow,
  MachineRow,
  ResumeSessionView,
  Risk,
  SessionView,
  WorkspaceRow,
  WorkspaceView,
} from '../types/workspaces.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A session is dormant when it is still live (`running` or `idle`) and has been
 * silent for longer than `dormantAfterDays`. Dormancy is never a risk.
 */
export function isDormant(
  session: AgentSessionRow,
  now: Date,
  dormantAfterDays: number,
): boolean {
  if (session.status !== 'running' && session.status !== 'idle') {
    return false;
  }
  return (
    session.last_activity_at.getTime() <
    now.getTime() - dormantAfterDays * MS_PER_DAY
  );
}

/**
 * The session the user should resume: the most recently active session that has
 * a non-null `agent_session_id`, in any status. `null` when no session has an
 * id. Resuming a session is not affected by whether it has ended.
 */
export function selectResumeSession(
  sessions: AgentSessionRow[],
): AgentSessionRow | null {
  let best: AgentSessionRow | null = null;
  for (const session of sessions) {
    if (session.agent_session_id === null) continue;
    if (best === null || session.last_activity_at > best.last_activity_at) {
      best = session;
    }
  }
  return best;
}

/**
 * Sessions to show: with `includeEnded` all of them, otherwise every non-ended
 * session plus the single most recently active session even when it has ended.
 * Always sorted by `last_activity_at` descending.
 */
export function selectVisibleSessions(
  sessions: AgentSessionRow[],
  includeEnded: boolean,
): AgentSessionRow[] {
  const visible = includeEnded
    ? [...sessions]
    : sessions.filter((session) => session.status !== 'ended');
  if (!includeEnded && sessions.length > 0) {
    const newest = mostRecent(sessions);
    if (newest !== null && !visible.some((s) => s.id === newest.id)) {
      visible.push(newest);
    }
  }
  return sortDesc(visible);
}

/**
 * The workspace's most recently active session of any status, whether or not it
 * has an `agent_session_id`.
 */
function mostRecent(
  sessions: AgentSessionRow[],
): AgentSessionRow | null {
  let best: AgentSessionRow | null = null;
  for (const session of sessions) {
    if (best === null || session.last_activity_at > best.last_activity_at) {
      best = session;
    }
  }
  return best;
}

function sortDesc(sessions: AgentSessionRow[]): AgentSessionRow[] {
  return sessions.sort(
    (a, b) => b.last_activity_at.getTime() - a.last_activity_at.getTime(),
  );
}

/**
 * Risks in contract order: dirty, unpushed, no_upstream, interrupted, missing.
 * A null git field raises no git risk and dormancy is never a risk.
 */
export function computeRisks(
  workspace: WorkspaceRow,
  sessions: AgentSessionRow[],
): Risk[] {
  const risks: Risk[] = [];
  if (workspace.git_dirty_count !== null && workspace.git_dirty_count > 0) {
    risks.push('dirty');
  }
  if (
    workspace.git_unpushed_count !== null &&
    workspace.git_unpushed_count > 0
  ) {
    risks.push('unpushed');
  }
  if (workspace.git_has_upstream === false && workspace.branch !== null) {
    risks.push('no_upstream');
  }
  if (mostRecent(sessions)?.status === 'interrupted') {
    risks.push('interrupted');
  }
  if (workspace.missing_since !== null) {
    risks.push('missing');
  }
  return risks;
}

function toSessionView(
  session: AgentSessionRow,
  now: Date,
  dormantAfterDays: number,
): SessionView {
  return {
    id: session.id,
    agent_kind: session.agent_kind,
    agent_session_id: session.agent_session_id,
    status: session.status,
    dormant: isDormant(session, now, dormantAfterDays),
    cwd: session.cwd,
    transcript_path: session.transcript_path,
    started_at: session.started_at.toISOString(),
    last_activity_at: session.last_activity_at.toISOString(),
    ended_at: session.ended_at?.toISOString() ?? null,
    end_reason: session.end_reason,
  };
}

function toResumeSessionView(
  session: AgentSessionRow | null,
): ResumeSessionView | null {
  if (session === null || session.agent_session_id === null) return null;
  return {
    id: session.id,
    agent_kind: session.agent_kind,
    agent_session_id: session.agent_session_id,
    status: session.status,
    cwd: session.cwd,
    transcript_path: session.transcript_path,
    last_activity_at: session.last_activity_at.toISOString(),
  };
}

export function toWorkspaceView(input: {
  workspace: WorkspaceRow;
  machine: MachineRow;
  sessions: AgentSessionRow[];
  now: Date;
  dormantAfterDays: number;
  includeEnded?: boolean;
}): WorkspaceView {
  const { workspace, machine, sessions, now, dormantAfterDays } = input;
  const includeEnded = input.includeEnded ?? false;
  const git =
    workspace.git_dirty_count === null &&
    workspace.git_unpushed_count === null &&
    workspace.git_has_upstream === null
      ? null
      : {
          dirty_count: workspace.git_dirty_count,
          unpushed_count: workspace.git_unpushed_count,
          has_upstream: workspace.git_has_upstream,
        };

  return {
    id: workspace.id,
    machine: machine.alias,
    connect_target: machine.connect_target ?? machine.alias,
    path: workspace.path,
    repo_remote: workspace.repo_remote,
    branch: workspace.branch,
    feature_id: workspace.feature_id,
    last_activity_at: workspace.last_activity_at.toISOString(),
    git,
    git_state_at: workspace.git_state_at?.toISOString() ?? null,
    missing_since: workspace.missing_since?.toISOString() ?? null,
    risks: computeRisks(workspace, sessions),
    resume_session: toResumeSessionView(selectResumeSession(sessions)),
    sessions: selectVisibleSessions(sessions, includeEnded).map((session) =>
      toSessionView(session, now, dormantAfterDays),
    ),
  };
}
