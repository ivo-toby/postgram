# Slice brief: cli-t1

Status: draft

## Outcome and boundaries

Create two files.

`cli/src/tracking/types.ts`, exactly (formatting may differ):

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

`cli/src/tracking/config.ts` exporting exactly:

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

Rules:

1. `shq(s)` = `"'" + s.replaceAll("'", "'\\''") + "'"`.
2. `slug(title)` = `title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'feature'`. Example: `"Keyword rank fusion!"` → `"keyword-rank-fusion"`.
3. `defaultAlias(h)`: lowercase, cut at the first `.`, replace each character outside `[a-z0-9._-]` with `-`; an empty result is `'machine'`.
4. `parseTrackingConfig(raw, { homeDir, hostname })` is pure. `raw` is the parsed ~/.pgmrc (anything). Each key falls back to its default when absent or of the wrong type: `alias` = `machine.alias` (non-empty string) else `defaultAlias(hostname)`; `connectTarget` = `machine.connect_target` (non-empty string) else the alias; `scanRoots` = the string entries of `scan_roots`, each through expandHome, else `[]`; `worktreeRoot` = `worktree_root` string through expandHome, else null; `hereTimeoutMs` = `here_timeout_ms` when a finite number > 0, else 2000; `resume` = DEFAULT_RESUME merged per agent kind and per field with `resume[kind].with_id` / `without_id` when that value is a string or null (other kinds and values ignored). The result never shares objects with DEFAULT_RESUME.
5. `expandHome`: `'~'` → homeDir, `'~/x'` → `path.join(homeDir, 'x')`; anything else unchanged.
6. `loadTrackingConfig` reads `<homeDir>/.pgmrc` (default `os.homedir()`, hostname default `os.hostname()`); a missing or invalid JSON file gives `parseTrackingConfig({}, …)`.
7. `writeMachineConfig` reads the existing JSON object (missing file: `{}`; invalid JSON: throw UsageError), sets `machine.alias` (input, else existing, else defaultAlias(os.hostname())) and `machine.connect_target` (input, else existing, else the alias), keeps every other key and every other machine key, writes it back pretty-printed with a final newline and mode 0o600 (chmod after writing), and returns `previousAlias` (the old `machine.alias` string or null) plus the written alias and connect target.
8. `usageExit(command)` calls `command.exitOverride((error) => { process.exit(error.exitCode === 0 ? 0 : 2); })` and returns the command.

Write the slice test `cli/tests/unit/tracking-config.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/contract/cli-tracking.feature.test.ts`, `tests/contract/cli-scan.feature.test.ts`, `changes/004-cli-hooks/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/cli.md`, `changes/004-cli-hooks/proposal.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| shq on a value with quotes; slug on the contract example, on symbols only and on a long title | exact contract strings; fallback feature; at most 40 characters without a trailing dash | cfg-helpers | cli-t1 |
| defaultAlias on "Ivo-MacBook.local" and on "my box" | "ivo-macbook" and "my-box" | cfg-helpers | cli-t1 |
| parseTrackingConfig on {} and on a full object with ~ paths, a partial resume override and wrong-typed values | defaults; expanded paths; merged templates; wrong types ignored | cfg-pgmrc | cli-t1 |
| writeMachineConfig on a file with credentials; on a missing file | credentials kept, machine keys set, mode 600, previousAlias reported | cfg-pgmrc | cli-t1 |
| usageExit on a command parsed with an unknown option (stub process.exit) | exit called with 2 | usage-exit | cli-t1 |

The check `cli-t1` runs `node changes/004-cli-hooks/slice-check.mjs cli/src/tracking/types.ts cli/src/tracking/config.ts cli/tests/unit/tracking-config.test.ts`: Vitest on the slice test (from cli/), ESLint with zero allowed problems on the listed files, and tsc for cli/tsconfig.json. Call run_checks before you finish and fix every ESLint and tsc error it reports.

## Stop conditions

- Stop and report if a cited excerpt contradicts this brief.
- Stop if the work would need a change to a protected file, a file of an accepted slice, or a deletion.
- Report every file you created or changed.

## Slice test review contract

The JSON block must exactly match slice.json.testReview.

```json
{
  "schemaVersion": 1,
  "workflow": "slice-tests",
  "criteria": [
    {
      "id": "cli-t1-tests",
      "requirementIds": [
        "cfg-helpers",
        "cfg-pgmrc",
        "usage-exit"
      ],
      "question": "Do the tests pin the shq and slug vectors, the alias rule, every default and override of parseTrackingConfig, writeMachineConfig preserving other keys with mode 600, and usageExit mapping errors to 2?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/cli.md",
        "changes/004-cli-hooks/proposal.md"
      ],
      "testPaths": [
        "cli/tests/unit/tracking-config.test.ts"
      ]
    }
  ]
}
```

## Approved slice requirements

The JSON array must exactly match the requirement records referenced by
slice.json.testReview.

```json
[
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "cfg-helpers",
    "text": "shq is POSIX single-quote escaping, slug follows the contract expression with fallback feature, and the default machine alias is the lowercased hostname cut at the first dot with characters outside [a-z0-9._-] replaced by -."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "cfg-pgmrc",
    "text": "The tracking keys machine.alias, machine.connect_target, scan_roots, worktree_root, here_timeout_ms and resume are always read from ~/.pgmrc with the contract defaults, ~ expanded, resume merged per agent kind and field, and pgm machine set rewrites only the machine keys keeping the file mode 600."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "usage-exit",
    "text": "Usage errors and commander parse errors of the new commands exit 2 with a message on stderr; runtime errors exit 1 through the existing failure handler and its JSON envelope in --json mode."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
