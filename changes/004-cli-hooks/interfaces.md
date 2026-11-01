# Interfaces of the accepted slices

Exact exports that later slices import. Formatting in the real files may differ.

## cli/src/tracking/types.ts (slice cli-t1)

```ts
// cli/src/tracking/types.ts: declarations only, mirroring contracts/rest.md.
export type AgentKind = 'claude-code' | 'pi' | 'talon' | 'other';
export const AGENT_KINDS: readonly AgentKind[] = ['claude-code', 'pi', 'talon', 'other'];
export type SessionStatus = 'running' | 'idle' | 'ended' | 'interrupted';
export type SessionEvent = 'start' | 'activity' | 'stop' | 'end';
export type FeatureStage = 'building' | 'review' | 'functional_test' | 'ready_to_merge' | 'awaiting_release' | 'released';
export const FEATURE_STAGES: readonly FeatureStage[] = ['building', 'review', 'functional_test', 'ready_to_merge', 'awaiting_release', 'released'];
export type GitSnapshot = { dirty_count: number | null; unpushed_count: number | null; has_upstream: boolean | null };
export type SessionView = {
  id: string; agent_kind: AgentKind; agent_session_id: string | null; status: SessionStatus; dormant: boolean;
  cwd: string | null; transcript_path: string | null; started_at: string; last_activity_at: string;
  ended_at: string | null; end_reason: string | null;
};
export type ResumeSessionView = {
  id: string; agent_kind: AgentKind; agent_session_id: string; status: SessionStatus;
  cwd: string | null; transcript_path: string | null; last_activity_at: string;
};
export type WorkspaceView = {
  id: string; machine: string; connect_target: string; path: string; repo_remote: string | null; branch: string | null;
  feature_id: string | null; last_activity_at: string; git: GitSnapshot | null; git_state_at: string | null;
  missing_since: string | null; risks: string[]; resume_session: ResumeSessionView | null; sessions: SessionView[];
};
export type PullRequestView = { url: string; state: 'open' | 'merged' | 'closed'; updated_at: string };
export type WhereFeature = {
  id: string; title: string; stage: FeatureStage; stage_source: 'manual' | 'derived' | null; stage_set_at: string | null;
  task_status: string | null; pull_requests: PullRequestView[]; workspaces: WorkspaceView[];
};
export type WhereGroup =
  | { key: string; label: string; features: WhereFeature[] }
  | { key: 'unassigned'; label: 'Unassigned'; workspaces: WorkspaceView[] };
export type WhereResponse = { view: 'stage' | 'actions'; generated_at: string; dormant_after_days: number; groups: WhereGroup[] };
export type MachineView = { alias: string; hostname: string; connect_target: string | null; last_seen_at: string };
export type ReportGit = { dirty_count: number; unpushed_count: number; has_upstream: boolean };
export type ReportWorkspace = {
  path: string; repo_remote?: string | null; repo_root?: string | null; branch?: string | null; git?: ReportGit | null;
};
export type ReportSession = {
  agent_kind: AgentKind; agent_session_id: string | null; event?: SessionEvent; reason?: string;
  cwd: string | null; transcript_path: string | null; observed_at?: string;
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
  feature: { id: string; title: string; stage: string | null; pull_requests: PullRequestView[] } | null;
};
```

## cli/src/tracking/config.ts (slice cli-t1)

```ts
// cli/src/tracking/config.ts
import type { AgentKind } from './types.js';
export type ResumeTemplate = { with_id: string | null; without_id: string | null };
export type ResumeTemplates = Record<AgentKind, ResumeTemplate>;
export const DEFAULT_RESUME: ResumeTemplates; // claude-code {with_id:'claude --resume {session_id}', without_id:'claude'}, pi {'pi --session {session_id}', 'pi'}, talon and other {null, null}
export type TrackingConfig = {
  alias: string; connectTarget: string; scanRoots: string[]; worktreeRoot: string | null;
  hereTimeoutMs: number; resume: ResumeTemplates;
};
export class UsageError extends Error {} // name 'UsageError'; thrown for exit-2 situations
export function shq(value: string): string;
export function slug(title: string): string;
export function defaultAlias(hostname: string): string;
export function expandHome(value: string, homeDir: string): string; // '~' or '~/x' only
export function parseTrackingConfig(raw: unknown, input: { homeDir: string; hostname: string }): TrackingConfig;
export async function loadTrackingConfig(input?: { homeDir?: string; hostname?: string }): Promise<TrackingConfig>;
export async function writeMachineConfig(input: { alias?: string; connectTarget?: string; homeDir?: string }): Promise<{ previousAlias: string | null; alias: string; connectTarget: string }>;
export function usageExit(command: Command): Command; // command.exitOverride: exit code 0 stays 0, anything else exits 2
```

## cli/src/tracking/resume.ts (slice cli-t2)

```ts
// cli/src/tracking/resume.ts
import type { ResumeTemplates } from './config.js';
import type { WorkspaceView } from './types.js';
export function resumeDirectory(workspace: WorkspaceView): string;
export function isTranscriptGone(workspace: WorkspaceView, localAlias: string, exists: (file: string) => boolean): boolean;
export function renderResume(workspace: WorkspaceView, input: { localAlias: string; templates: ResumeTemplates; transcriptGone: boolean }): string;
export function formatAge(fromIso: string, now: Date): string;
```

## cli/src/tracking/api.ts (slice cli-t3). The pgm client from createPgmClient (cli/src/client.ts) also has listTasks({ limit, offset, include_archived }) returning { items: StoredEntity[]; total; limit; offset } and searchEntities({ query, type, limit }) returning { results: Array<{ entity }> }.

```ts
// cli/src/tracking/api.ts
import type { Command } from 'commander';
import { createPgmClient } from '../client.js';
import type { TrackingConfig } from './config.js';
import type { FeatureStage, LookupResponse, MachineView, ReportBody, ReportResponse, WhereResponse, WorkspaceView } from './types.js';
import type { StoredEntityResponse } from '../client.js';
export type TrackingClient = {
  report(body: ReportBody, options?: { timeoutMs?: number }): Promise<ReportResponse>;          // POST /api/workspaces/report
  patchWorkspace(id: string, body: { feature_id?: string | null; missing?: boolean }): Promise<{ workspace: WorkspaceView }>; // PATCH /api/workspaces/:id
  putMachine(alias: string, connectTarget: string | null): Promise<{ machine: MachineView }>;    // PUT /api/machines/:alias {connect_target}
  listMachines(): Promise<{ machines: MachineView[] }>;                                         // GET /api/machines
  putRepository(remote: string, releaseOnMerge: boolean): Promise<{ repository: { remote: string; release_on_merge: boolean } }>; // PUT /api/repositories
  createFeature(input: { content: string; tags?: string[]; visibility?: string }): Promise<StoredEntityResponse>; // POST /api/features
  setStage(id: string, stage: FeatureStage): Promise<StoredEntityResponse & { previous_stage: string | null }>; // POST /api/features/:id/stage
  addPullRequest(id: string, input: { url: string; state?: 'open' | 'merged' | 'closed' }): Promise<StoredEntityResponse & { stage_changed: boolean; from: string; to: string }>; // POST /api/features/:id/pull-requests
  lookup(machine: string, path: string): Promise<LookupResponse>;                               // GET /api/workspaces/lookup?machine=&path=
  listWorkspaces(query: { machine?: string; repo?: string; featureId?: string; unassigned?: boolean; includeEnded?: boolean }): Promise<{ workspaces: WorkspaceView[] }>; // GET /api/workspaces (feature_id, unassigned=true, include_ended=true)
  where(query: { view?: 'stage' | 'actions'; machine?: string; repo?: string; includeReleased?: boolean; includeDone?: boolean; includeEnded?: boolean }): Promise<WhereResponse>; // GET /api/where (include_released/include_done/include_ended=true)
};
export function createTrackingClient(options: { apiUrl: string; apiKey: string }): TrackingClient;
export type TrackingContext = {
  json: boolean;
  config: TrackingConfig;
  client: TrackingClient;
  pgm: ReturnType<typeof createPgmClient>;
  homeDir: string;
};
// Runs a command body: loads TrackingConfig and the credentials (resolvePgmConfig), builds both clients,
// awaits the handler and prints its result (undefined: nothing; string[]: printHuman, or printJson in json mode;
// anything else: printJson). UsageError: message to stderr, process.exitCode = 2. Any other error: handleCliFailure(error, json).
export async function runTrackingCommand(command: Command, handler: (context: TrackingContext) => Promise<unknown>): Promise<void>;
```

## cli/src/tracking/local.ts (slice cli-t4). resolveLocalWorkspace returns the ReportWorkspace to send (path is the realpath of the git worktree root, or of cwd outside git with git: null) and repoRoot (the main repository root, null outside git or when unknown).

```ts
// cli/src/tracking/local.ts
import type { ReportWorkspace } from './types.js';
export type GitResult = { ok: true; stdout: string } | { ok: false; timedOut: boolean };
export type GitRunner = (args: string[], options: { cwd: string; timeoutMs: number }) => Promise<GitResult>;
export const runGit: GitRunner; // execFile('git', args, { cwd, timeout: timeoutMs, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }); stdout trimmed of the final newline only
export type LocalWorkspace =
  | { kind: 'ok'; path: string; repoRoot: string | null; workspace: ReportWorkspace }
  | { kind: 'timeout' };
export async function resolveLocalWorkspace(cwd: string, options?: { budgetMs?: number; run?: GitRunner }): Promise<LocalWorkspace>; // budgetMs default 800
export async function readBootId(options?: { platform?: NodeJS.Platform; readFile?: (file: string) => Promise<string>; exec?: (cmd: string, args: string[]) => Promise<string> }): Promise<string | null>;
export const MARKER_DIR = '.postgram';
export async function readMarker(worktree: string): Promise<string | null>; // feature_id or null
export async function writeMarker(worktree: string, featureId: string, now?: Date): Promise<void>;
export async function removeMarker(worktree: string): Promise<void>; // removes feature.json only; no error when absent
```

## cli/src/tracking/where.ts (slice cli-t7), the exports other slices use

```ts
export function collectWorkspaces(response: WhereResponse): WorkspaceView[];
export async function syncMissing(workspaces: readonly WorkspaceView[], deps: { localAlias: string; exists: (path: string) => boolean; patch: (id: string, missing: boolean) => Promise<unknown> }): Promise<{ changed: boolean; failedIds: Set<string> }>;
```

## cli/src/tracking/scan-discovery.ts (slice cli-t10), the exports other slices use

```ts
export type ScannedWorktree = { path: string; branch: string | null };
export type ScannedSession = { agent_kind: 'claude-code' | 'pi'; agent_session_id: string; cwd: string | null; transcript_path: string; observed_at: string };
export async function discoverWorktrees(roots: readonly string[], depth: number, run?: GitRunner): Promise<ScannedWorktree[]>;
export async function findClaudeSessions(worktrees: readonly string[], claudeDir: string): Promise<{ sessions: Map<string, ScannedSession[]>; notes: string[] }>;
export async function findPiSessions(worktrees: readonly string[], piDir: string): Promise<Map<string, ScannedSession[]>>;
```

