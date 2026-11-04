// Response types of GET /api/where (specs/004-workspace-session-tracking/contracts/rest.md)
// and the pure helpers of the Where page. The UI keeps its own copy of the types:
// it never imports from the server package or from cli/.

export type AgentKind = 'claude-code' | 'pi' | 'talon' | 'other';
export type SessionStatus = 'running' | 'idle' | 'ended' | 'interrupted';
export type Risk = 'dirty' | 'unpushed' | 'no_upstream' | 'interrupted' | 'missing';
export type FeatureStage =
  | 'building' | 'review' | 'functional_test'
  | 'ready_to_merge' | 'awaiting_release' | 'released';
export type PullRequestState = 'open' | 'merged' | 'closed';
export type WhereView = 'stage' | 'actions';

export type GitSnapshot = {
  dirty_count: number | null;
  unpushed_count: number | null;
  has_upstream: boolean | null;
};

export type SessionView = {
  id: string;
  agent_kind: AgentKind;
  agent_session_id: string | null;
  status: SessionStatus;
  dormant: boolean;
  cwd: string | null;
  transcript_path: string | null;
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
  end_reason: string | null;
};

export type ResumeSessionView = {
  id: string;
  agent_kind: AgentKind;
  agent_session_id: string;
  status: SessionStatus;
  cwd: string | null;
  transcript_path: string | null;
  last_activity_at: string;
};

export type WorkspaceView = {
  id: string;
  machine: string;
  connect_target: string;
  path: string;
  repo_remote: string | null;
  branch: string | null;
  feature_id: string | null;
  last_activity_at: string;
  git: GitSnapshot | null;
  git_state_at: string | null;
  missing_since: string | null;
  risks: Risk[];
  resume_session: ResumeSessionView | null;
  sessions: SessionView[];
};

export type FeaturePullRequest = { url: string; state: PullRequestState; updated_at: string };

export type WhereFeature = {
  id: string;
  title: string;
  stage: FeatureStage;
  stage_source: 'manual' | 'derived' | null;
  stage_set_at: string | null;
  task_status: string | null;
  pull_requests: FeaturePullRequest[];
  workspaces: WorkspaceView[];
};

export type WhereGroup = {
  key: string;
  label: string;
  features?: WhereFeature[];
  workspaces?: WorkspaceView[];
};

export type WhereResponse = {
  view: WhereView;
  generated_at: string;
  dormant_after_days: number;
  groups: WhereGroup[];
};

type ResumeTemplate = { withId: string | null; withoutId: string | null };

// The same templates as the CLI's defaults. The UI always uses the ssh form.
const RESUME_TEMPLATES: Record<AgentKind, ResumeTemplate> = {
  'claude-code': { withId: 'claude --resume {session_id}', withoutId: 'claude' },
  pi: { withId: 'pi --session {session_id}', withoutId: 'pi' },
  talon: { withId: null, withoutId: null },
  other: { withId: null, withoutId: null },
};

export function shq(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function formatAge(fromIso: string, now: Date): string {
  const elapsedMs = Math.max(0, now.getTime() - Date.parse(fromIso));
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours < 48) {
    return `${hours}h`;
  }
  return `${Math.floor(elapsedMs / 86_400_000)}d`;
}

export function resumeDirectory(workspace: WorkspaceView): string {
  const cwd = workspace.resume_session?.cwd ?? null;
  if (cwd !== null && (cwd === workspace.path || cwd.startsWith(`${workspace.path}/`))) {
    return cwd;
  }
  return workspace.path;
}

export function renderResume(workspace: WorkspaceView): string {
  const session = workspace.resume_session;
  const kind: AgentKind = session?.agent_kind ?? workspace.sessions[0]?.agent_kind ?? 'claude-code';
  const template = RESUME_TEMPLATES[kind];
  const command =
    session !== null && template.withId !== null
      ? template.withId.replaceAll('{session_id}', shq(session.agent_session_id))
      : template.withoutId;
  const local = `cd ${shq(resumeDirectory(workspace))}${command ? ` && ${command}` : ''}`;
  return `ssh -t ${workspace.connect_target} ${shq(local)}`;
}

export function pullRequestNumber(url: string): string | null {
  const match = /\/pull\/(\d+)$/u.exec(url);
  return match?.[1] ?? null;
}

export function groupCount(group: WhereGroup): number {
  return group.features?.length ?? group.workspaces?.length ?? 0;
}

export function isGroupEmpty(group: WhereGroup): boolean {
  return groupCount(group) === 0;
}
