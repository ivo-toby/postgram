# Slice brief: cli-t4

Status: draft

## Outcome and boundaries

Create `cli/src/tracking/local.ts` exporting exactly:

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

`resolveLocalWorkspace(cwd, { budgetMs = 800, run = runGit })`:

1. Each git call gets `timeoutMs = Math.max(1, Math.min(500, budgetMs - elapsed))`, with elapsed measured from the start of the call.
2. `rev-parse --show-toplevel`: timed out → `{ kind: 'timeout' }`. Failed (not a repo) → `{ kind: 'ok', path: realpath(cwd), repoRoot: null, workspace: { path: realpath(cwd), git: null } }`.
3. Otherwise `path = realpath(toplevel)` and run these in parallel:
   - `rev-parse --path-format=absolute --git-common-dir` → `repo_root = path.dirname(stdout)`.
   - `symbolic-ref --short -q HEAD` → `branch`; a failure that did not time out is `null` (detached).
   - `remote get-url origin` → `repo_remote` as reported (the server normalizes, D3); a failure that did not time out is `null`.
   - `status --porcelain=v1 --untracked-files=normal` → `dirty_count` = the number of non-empty lines.
   - `rev-list --count @{upstream}..HEAD`: ok → `has_upstream: true` and `unpushed_count`. Failed (not timed out) → `has_upstream: false`, then `rev-list --count HEAD --not --remotes` → `unpushed_count`.
4. A timed-out value is omitted: no `repo_root`, `branch` or `repo_remote` key. When any count is unknown (timed out or failed), omit the `git` key. `repoRoot` in the result is the repo_root value or null.

`readBootId`: on linux read `/proc/sys/kernel/random/boot_id` and trim. On darwin run `sysctl -n kern.boottime`, take the `{ sec = …, usec = … }` part (regex `/\{[^}]*\}/`) and return its sha256 hex (node:crypto). Any failure, a missing match or another platform → null. The defaults use fs.promises.readFile and execFile.

Marker: `writeMarker` creates `<worktree>/.postgram/`, writes `feature.json` as `{ "feature_id": id, "created_at": now.toISOString() }` and `.gitignore` containing `*\n`. `readMarker` returns `feature_id` when the file parses to an object whose feature_id is a UUID string, else null (missing file included).

Write the slice test `cli/tests/unit/tracking-local.test.ts` (direct imports are fine). Use real temporary git repositories (run git with GIT_CONFIG_GLOBAL=/dev/null and an author name and email in env), plus a fake GitRunner for the timeout cases. If git is not runnable in your sandbox, cover git through the fake runner only and say so. You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/contract/cli-tracking.feature.test.ts`, `tests/contract/cli-scan.feature.test.ts`, `changes/004-cli-hooks/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/research.md`, `specs/004-workspace-session-tracking/contracts/cli.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| A repo with origin, one uncommitted file, no upstream; a subdirectory as cwd | path is the realpath root; branch; remote; dirty 1; has_upstream false with unpushed count | git-state | cli-t4 |
| A plain directory; a detached HEAD; no origin | git null outside git; branch null; repo_remote null | git-state | cli-t4 |
| Fake runner: toplevel times out; a count times out; branch times out | kind timeout; git key omitted; branch key omitted | git-budget | cli-t4 |
| readBootId on linux, darwin output, a failure and win32 | trimmed file; sha256 hex; null; null | boot-id | cli-t4 |
| writeMarker then readMarker; invalid JSON; removeMarker twice | id and .gitignore *; null; no error | marker-file | cli-t4 |

The check `cli-t4` runs `node changes/004-cli-hooks/slice-check.mjs cli/src/tracking/local.ts cli/tests/unit/tracking-local.test.ts`: Vitest on the slice test (from cli/), ESLint with zero allowed problems on the listed files, and tsc for cli/tsconfig.json. Call run_checks before you finish and fix every ESLint and tsc error it reports.

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
      "id": "cli-t4-tests",
      "requirementIds": [
        "git-state",
        "git-budget",
        "boot-id",
        "marker-file"
      ],
      "question": "Do the tests cover each git value, the not-git and detached cases, every budget rule through a fake runner, the three boot id paths, and marker write, read, invalid read and remove?",
      "interfaces": [
        "specs/004-workspace-session-tracking/research.md",
        "specs/004-workspace-session-tracking/contracts/cli.md"
      ],
      "testPaths": [
        "cli/tests/unit/tracking-local.test.ts"
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
    "id": "git-state",
    "text": "Git state comes from the research R7 commands with GIT_OPTIONAL_LOCKS=0: realpath of the worktree root, the main repo root, branch (null when detached), origin remote (null without origin), dirty count and unpushed count with has_upstream, and the workspace path is realpath(cwd) outside git."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "git-budget",
    "text": "Git resolution has a total budget: an unresolved worktree root means no report, an unresolved count omits the git key, and an unresolved remote, root or branch omits that key rather than sending null."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "boot-id",
    "text": "The boot id is the trimmed Linux boot_id file, else the sha256 hex of the sec/usec part of macOS kern.boottime, else null."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "marker-file",
    "text": "The marker .postgram/feature.json holds feature_id and created_at next to .postgram/.gitignore containing *, can be read (invalid content reads as none) and removed."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
