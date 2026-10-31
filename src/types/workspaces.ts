export type AgentKind = 'claude-code' | 'pi' | 'talon' | 'other';
export type SessionStatus = 'running' | 'idle' | 'ended' | 'interrupted';
export type SessionEvent = 'start' | 'activity' | 'stop' | 'end';
export type ReportSource = 'hook' | 'scan';
export type Risk =
  | 'dirty'
  | 'unpushed'
  | 'no_upstream'
  | 'interrupted'
  | 'missing';
export type ReportWarning = 'feature_not_found' | 'feature_not_task';

export type MachineRow = {
  id: string;
  alias: string;
  hostname: string;
  connect_target: string | null;
  boot_id: string | null;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
};

export type WorkspaceRow = {
  id: string;
  machine_id: string;
  path: string;
  repo_remote: string | null;
  repo_root: string | null;
  branch: string | null;
  git_dirty_count: number | null;
  git_unpushed_count: number | null;
  git_has_upstream: boolean | null;
  git_state_at: Date | null;
  feature_id: string | null;
  missing_since: Date | null;
  last_activity_at: Date;
  created_at: Date;
  updated_at: Date;
};

export type AgentSessionRow = {
  id: string;
  workspace_id: string;
  agent_kind: AgentKind;
  agent_session_id: string | null;
  status: SessionStatus;
  boot_id: string | null;
  cwd: string | null;
  transcript_path: string | null;
  started_at: Date;
  last_activity_at: Date;
  ended_at: Date | null;
  end_reason: string | null;
};

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

export type ReportFeature = { id: string; title: string; stage: string | null };

export type SessionRef = { id: string; status: SessionStatus };

export type ReportResult = {
  workspace: WorkspaceView | null;
  session?: SessionRef;
  sessions?: SessionRef[];
  feature: ReportFeature | null;
  interrupted_sessions: number;
  warnings: ReportWarning[];
};
