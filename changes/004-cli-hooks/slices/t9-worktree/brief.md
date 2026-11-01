# Slice brief: cli-t9

Status: draft

## Outcome and boundaries

Create `cli/src/tracking/worktree.ts` exporting:

```ts
import type { Command } from 'commander';
import type { TrackingClient } from './api.js';
import type { TrackingConfig } from './config.js';
import type { GitRunner, LocalWorkspace } from './local.js';
export type TaskSummary = { id: string; title: string; isFeature: boolean };
export function taskTitle(content: string | null): string;  // (content ?? '').split('\n')[0].trim().slice(0, 80)
export function matchFeature(arg: string, tasks: readonly TaskSummary[]): TaskSummary[];
export async function listTaskSummaries(listTasks: (input: { limit: number; offset: number }) => Promise<{ items: Array<{ id: string; content: string | null; metadata: Record<string, unknown> }>; total: number }>): Promise<TaskSummary[]>;
export type WorktreeDeps = {
  client: TrackingClient; config: TrackingConfig; cwd: string; hostname: string;
  listTasks: Parameters<typeof listTaskSummaries>[0];
  run: GitRunner; exists: (path: string) => boolean; confirm: (question: string) => Promise<boolean>;
  bootId: () => Promise<string | null>; resolveWorkspace: (cwd: string) => Promise<LocalWorkspace>;
  writeMarker: (worktree: string, featureId: string) => Promise<void>; warn: (line: string) => void;
};
export async function runWorktreeNew(feature: string, options: { base?: string; path?: string; create: boolean }, deps: WorktreeDeps): Promise<string[]>;
export function registerWorktreeCommand(program: Command): void;
```

Rules:

1. `listTaskSummaries` pages with limit 100 (offset 0, 100, …) until offset ≥ total; isFeature = `metadata.kind === 'feature'`. Archived tasks are excluded by the endpoint default.
2. `matchFeature`: full UUID → tasks with that id; `^[0-9a-f]{8}$` → tasks whose id starts with it; otherwise feature tasks whose title equals arg case-insensitively (trimmed).
3. `runWorktreeNew` order: (a) `rev-parse --show-toplevel` in cwd fails → AppError VALIDATION 'not in a git repository' (exit 1). Repo root = dirname of `rev-parse --path-format=absolute --git-common-dir`. (b) Match: more than one → AppError CONFLICT listing `<8-hex> <title>` on stderr; none → unless `create` or `confirm('Create feature "<arg>"?')`, AppError NOT_FOUND. A new feature's title is arg. (c) For an existing feature: short = first 8 of id, branch `feat/<short>-<slug(title)>`, path = options.path (resolved against cwd) ?? `<worktreeRoot ?? repoRoot + '.worktrees'>/<short>-<slug>`. When exists(path) or `rev-parse --verify --quiet refs/heads/<branch>` succeeds → UsageError (exit 2) with nothing created. For a new feature the id is only known after creation, so these checks run right after step (d) with the new id (a clash is then a UsageError too). (d) Create the feature when new (`client.createFeature({ content: arg })`). (e) base = options.base, else `origin/HEAD` when `rev-parse --verify --quiet refs/remotes/origin/HEAD` succeeds, else `HEAD`; `worktree add -b <branch> <path> <base>` (failure → AppError INTERNAL with git output). (f) writeMarker(path, id). (g) resolveWorkspace(path); report `{ source: 'hook', machine, workspace, feature_id: id }`; a report failure or git timeout only warns. (h) Return `[path]`.
4. Git calls use `deps.run` with cwd = the current cwd and timeoutMs 10000.
5. `registerWorktreeCommand`: `worktree new <feature>` with `--base`, `--path`, `--create`, usageExit, runTrackingCommand; the human result is the path only; in json mode return `{ path }`.

Write the slice test `cli/tests/unit/tracking-worktree.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/contract/cli-tracking.feature.test.ts`, `tests/contract/cli-scan.feature.test.ts`, `changes/004-cli-hooks/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/cli.md`, `changes/004-cli-hooks/proposal.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| matchFeature by UUID, short id, title case-insensitive, non-feature title | one match each; plain tasks not matched by title | worktree-resolve | cli-t9 |
| listTaskSummaries over three pages | every task, offsets 0/100/200 | worktree-resolve | cli-t9 |
| Two title matches; no match without create and confirm false | CONFLICT; NOT_FOUND and nothing created | worktree-resolve | cli-t9 |
| Existing feature in a real temp repo | branch feat/<short>-<slug>, path under <repo>.worktrees, marker, report with feature_id, output only the path | worktree-create | cli-t9 |
| Path already exists; branch already exists | UsageError, no feature created, no worktree | worktree-create | cli-t9 |
| --create with a new title; report fails | feature created then worktree; warning and path still returned | worktree-create | cli-t9 |

The check `cli-t9` runs `node changes/004-cli-hooks/slice-check.mjs cli/src/tracking/worktree.ts cli/tests/unit/tracking-worktree.test.ts`: Vitest on the slice test (from cli/), ESLint with zero allowed problems on the listed files, and tsc for cli/tsconfig.json. Call run_checks before you finish and fix every ESLint and tsc error it reports.

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
      "id": "cli-t9-tests",
      "requirementIds": [
        "worktree-resolve",
        "worktree-create"
      ],
      "question": "Do the tests cover the three resolution forms, paging, ambiguity and no-match refusals, the side-effect order with refusal before any change, the created worktree with branch, path and marker, --create and a failing report?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/cli.md",
        "changes/004-cli-hooks/proposal.md"
      ],
      "testPaths": [
        "cli/tests/unit/tracking-worktree.test.ts"
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
    "id": "worktree-resolve",
    "text": "pgm worktree new resolves the feature by full UUID, then 8-hex short id, then case-insensitive exact title among non-archived feature tasks; several matches exit 1 listing them; no match needs --create or a y answer, else exit 1."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "worktree-create",
    "text": "pgm worktree new refuses an existing path or branch with exit 2 before any side effect, then creates the feature when needed, adds the worktree on feat/<short>-<slug> from the base, writes the marker, reports the workspace linked and prints only the absolute path; a report failure only warns."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
