# Slice brief: cli-t10

Status: draft

## Outcome and boundaries

Create `cli/src/tracking/scan-discovery.ts` exporting:

```ts
import type { GitRunner } from './local.js';
export type ScannedWorktree = { path: string; branch: string | null };
export type ScannedSession = { agent_kind: 'claude-code' | 'pi'; agent_session_id: string; cwd: string | null; transcript_path: string; observed_at: string };
export async function findRepositories(roots: readonly string[], depth: number): Promise<string[]>;
export async function listWorktrees(repo: string, run?: GitRunner): Promise<ScannedWorktree[]>;
export async function discoverWorktrees(roots: readonly string[], depth: number, run?: GitRunner): Promise<ScannedWorktree[]>;
export function claudeEncode(value: string): string;      // value.replace(/[^a-zA-Z0-9]/g, '-')
export async function findClaudeSessions(worktrees: readonly string[], claudeDir: string): Promise<{ sessions: Map<string, ScannedSession[]>; notes: string[] }>;
export async function findPiSessions(worktrees: readonly string[], piDir: string): Promise<Map<string, ScannedSession[]>>;
```

Rules:

1. `findRepositories`: for each root (realpath; skip a missing root), a directory is a repository when it contains an entry named `.git` (file or directory); record it and do not descend into it. Otherwise descend into subdirectories except `node_modules` and names starting with `.`, while the level below the root is ≤ depth (the root itself is level 0). Return realpaths, unique, sorted.
2. `listWorktrees`: `git worktree list --porcelain` in repo (timeoutMs 5000): blocks separated by blank lines with `worktree <path>` and `branch refs/heads/<name>` (missing → null, `detached`); skip blocks with `bare` and paths that do not exist; realpath each. A failing git call gives `[]`.
3. `discoverWorktrees`: listWorktrees of every repository, deduplicated by path, sorted by path.
4. `findClaudeSessions(worktrees, claudeDir)`: candidate directories under `<claudeDir>/projects` are those named exactly `claudeEncode(w)` or starting with `claudeEncode(w) + '-'`. A worktree with `claudeEncode(w).length > 200` is skipped with the note `skipped <w>: encoded path too long`. Each directory goes only to the worktree with the longest matching encoded prefix. Each `*.jsonl` file in it is a session: id = file stem, observed_at = mtime ISO, transcript_path = the file. cwd: the first of the first 200 lines that parses as an object with a string `cwd`; when found, drop the session unless cwd equals the worktree or starts with `worktree + '/'`; when absent, cwd is null and the session stays.
5. `findPiSessions(worktrees, piDir)`: directory `<piDir>/sessions/--<w without leading '/', '/' → '-'>--/`; each `*.jsonl`: the first line parsed as an object; id = its `id` string (skip the file without one), cwd = its `cwd` string or null, observed_at = mtime ISO, transcript_path = the file.
6. Maps hold only worktrees with at least one session. Sessions are sorted by agent_session_id.

Write the slice test `cli/tests/unit/tracking-scan-discovery.test.ts` (direct imports are fine). Build directory fixtures in a temporary directory; for listWorktrees use a real git repository with a second worktree when git is runnable, else a fake runner. You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/contract/cli-tracking.feature.test.ts`, `tests/contract/cli-scan.feature.test.ts`, `changes/004-cli-hooks/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/cli.md`, `specs/004-workspace-session-tracking/research.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| Roots with a repo, a nested repo inside it, node_modules and a dot-directory, depth 1 and 3 | only the outer repos within the depth | scan-discovery | cli-t10 |
| A repo with a second worktree reached from both the repo and the root walk | one entry per worktree with branch | scan-discovery | cli-t10 |
| Claude dirs for /r/alpha, /r/alpha-sub and /r/alpha.worktrees/x with worktrees alpha and alpha.worktrees/x | alpha gets alpha and alpha-sub, x gets its own | scan-sessions | cli-t10 |
| Transcript cwd inside, outside, absent; encoded length over 200 | kept; dropped; kept with cwd null; note | scan-sessions | cli-t10 |
| pi session file with header id and cwd; without id | session with header id; skipped | scan-sessions | cli-t10 |

The check `cli-t10` runs `node changes/004-cli-hooks/slice-check.mjs cli/src/tracking/scan-discovery.ts cli/tests/unit/tracking-scan-discovery.test.ts`: Vitest on the slice test (from cli/), ESLint with zero allowed problems on the listed files, and tsc for cli/tsconfig.json. Call run_checks before you finish and fix every ESLint and tsc error it reports.

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
      "id": "cli-t10-tests",
      "requirementIds": [
        "scan-discovery",
        "scan-sessions"
      ],
      "question": "Do the tests cover depth, stop-at-repository and skipped directories, worktree dedupe, the longest-prefix assignment including the .worktrees overlap, the cwd check and the long-path note, and pi header parsing?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/cli.md",
        "specs/004-workspace-session-tracking/research.md"
      ],
      "testPaths": [
        "cli/tests/unit/tracking-scan-discovery.test.ts"
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
    "id": "scan-discovery",
    "text": "pgm scan finds repositories under the roots up to the depth without descending into a repository, node_modules or dot-directories, and lists their worktrees deduplicated by realpath."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "scan-sessions",
    "text": "Claude sessions come from the encoded worktree project directory and its dash-suffixed subdirectory variants, each directory going to the worktree with the longest matching encoded prefix, dropping a session whose transcript cwd lies outside the worktree; pi sessions come from the pi session directory with id and cwd from the header line."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
