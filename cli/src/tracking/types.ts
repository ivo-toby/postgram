// cli/src/tracking/types.ts: declarations only, mirroring contracts/rest.md.
export type AgentKind = 'claude-code' | 'pi' | 'talon' | 'other';
export const AGENT_KINDS: readonly AgentKind[] = [
  'claude-code',
  'pi',
  'talon',
  'other'
];
export type SessionStatus = 'running' | 'idle' | 'ended' | 'interrupted';
export type SessionEvent = 'start' | 'activity' | 'stop' | 'end';
export type FeatureStage =
  | 'building'
  | 'review'
  | 'functional_test'
  | 'ready_to_merge'
  | 'awaiting_release'
  | 'released';
export const FEATURE_STAGES: readonly FeatureStage[] = [
  'building',
  'review',
  'functional_test',
  'ready_to_merge',
  'awaiting_release',
  'released'
];
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
  risks: string[];
  resume_session: ResumeSessionView | null;
  sessions: SessionView[];
};
export type PullRequestView = {
  url: string;
  state: 'open' | 'merged' | 'closed';
  updated_at: string;
};
export type WhereFeature = {
  id: string;
  title: string;
  stage: FeatureStage;
  stage_source: 'manual' | 'derived' | null;
  stage_set_at: string | null;
  task_status: string | null;
  pull_requests: PullRequestView[];
  workspaces: WorkspaceView[];
};
export type WhereGroup =
  | { key: string; label: string; features: WhereFeature[] }
  | { key: 'unassigned'; label: 'Unassigned'; workspaces: WorkspaceView[] };
export type WhereResponse = {
  view: 'stage' | 'actions';
  generated_at: string;
  dormant_after_days: number;
  groups: WhereGroup[];
};
export type MachineView = {
  alias: string;
  hostname: string;
  connect_target: string | null;
  last_seen_at: string;
};
export type ReportGit = {
  dirty_count: number;
  unpushed_count: number;
  has_upstream: boolean;
};
export type ReportWorkspace = {
  path: string;
  repo_remote?: string | null;
  repo_root?: string | null;
  branch?: string | null;
  git?: ReportGit | null;
};
export type ReportSession = {
  agent_kind: AgentKind;
  agent_session_id: string | null;
  event?: SessionEvent;
  reason?: string;
  cwd: string | null;
  transcript_path: string | null;
  observed_at?: string;
};
export type ReportBody = {
  source: 'hook' | 'scan';
  machine: { alias: string; hostname: string; boot_id: string | null };
  workspace?: ReportWorkspace;
  feature_id?: string;
  session?: ReportSession;
  sessions?: ReportSession[];
};
export type ReportResponse = {
  workspace: WorkspaceView | null;
  session?: { id: string; status: SessionStatus };
  sessions?: Array<{ id: string; status: SessionStatus }>;
  feature: { id: string; title: string; stage: string | null } | null;
  interrupted_sessions: number;
  warnings: string[];
};
export type LookupResponse = {
  workspace: WorkspaceView | null;
  feature:
    | {
        id: string;
        title: string;
        stage: string | null;
        pull_requests: PullRequestView[];
      }
    | null;
};
