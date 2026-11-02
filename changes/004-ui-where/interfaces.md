# Interfaces: change 004-ui-where

These are the exports the slices agree on. A slice may not change an interface
that an accepted slice already provides.

## ui/src/lib/where.ts (slice ui-u1)

```ts
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

export function shq(value: string): string;
export function formatAge(fromIso: string, now: Date): string;
export function resumeDirectory(workspace: WorkspaceView): string;
export function renderResume(workspace: WorkspaceView): string;
export function pullRequestNumber(url: string): string | null;
export function groupCount(group: WhereGroup): number;
export function isGroupEmpty(group: WhereGroup): boolean;
```

## ui/src/lib/api.ts (slice ui-u2, added method)

```ts
getWhere(params: { view: WhereView; include_released?: boolean; include_done?: boolean }): Promise<WhereResponse>;
```

## ui/src/hooks/useWhere.ts (slice ui-u2)

```ts
export type UseWhereResult = {
  data: WhereResponse | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
};

export function useWhere(
  api: ApiClient,
  params: { view: WhereView; includeReleasedAndDone: boolean }
): UseWhereResult;
```

## ui/src/components/WherePage.tsx (slice ui-u3)

```ts
export default function WherePage(props: { api: ApiClient }): JSX.Element;
```

## ui/src/components/TopBar.tsx (slice ui-w1, changed)

```ts
export type Page = 'search' | 'graph' | 'projector' | 'tasks' | 'where' | 'admin';
```
