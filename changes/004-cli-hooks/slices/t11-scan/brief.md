# Slice brief: cli-t11

Status: draft

## Outcome and boundaries

Create `cli/src/tracking/scan.ts` exporting:

```ts
import type { Command } from 'commander';
import type { TrackingClient } from './api.js';
import type { TrackingConfig } from './config.js';
export type Proposal = { kind: 'marker' | 'short-id' | 'search'; featureId: string; title: string };
export const BRANCH_SHORT_ID: RegExp; // /(?:^|\/)([0-9a-f]{8})(?:-|$)/
export type ScanDeps = {
  client: TrackingClient; config: TrackingConfig; hostname: string; env: NodeJS.ProcessEnv; homeDir: string;
  tasks: () => Promise<Array<{ id: string; title: string }>>;            // non-archived tasks
  search: (query: string) => Promise<Array<{ id: string; title: string }>>; // top 3 task hits
  ask: (question: string) => Promise<string>;                             // one answer line, '' on end of input
  discover: typeof import('./scan-discovery.js').discoverWorktrees;
  claudeSessions: typeof import('./scan-discovery.js').findClaudeSessions;
  piSessions: typeof import('./scan-discovery.js').findPiSessions;
  resolveWorkspace: (path: string) => Promise<import('./local.js').LocalWorkspace>;
  readMarker: (worktree: string) => Promise<string | null>;
  writeMarker: (worktree: string, featureId: string) => Promise<void>;
  exists: (path: string) => boolean;
  info: (line: string) => void;  // stderr
};
export async function runScan(options: { root: string[]; depth?: string; yesExact: boolean; dryRun: boolean }, deps: ScanDeps): Promise<string[]>;
export function registerScanCommand(program: Command): void;
```

Rules:

1. Roots: options.root entries resolved with path.resolve, else config.scanRoots; none → UsageError with a hint to pass --root or set scan_roots. Depth: positive integer string, default 3, else UsageError.
2. Known: `client.listWorkspaces({ machine: alias })`; worktrees whose path is in that list produce the output line `known <path>` and are not prompted. Unless dryRun, run syncMissing over the fetched workspaces with patch `(id, missing) => client.patchWorkspace(id, { missing })`.
3. Sessions: `claudeSessions(paths, env.CLAUDE_CONFIG_DIR ?? <home>/.claude)` and `piSessions(paths, env.PI_CODING_AGENT_DIR ?? <home>/.pi/agent)`; notes go to info.
4. Proposals per unknown worktree, in order: marker (readMarker; title from tasks, else ''), then the branch short id (BRANCH_SHORT_ID group 1) when exactly one task id starts with it, then — only when not yesExact — up to 3 search hits for `slug(branch without a leading 'feat/')` (search failure: no hits).
5. yesExact: accept a marker or short-id proposal (the first), skip the others (line `skipped <path>`). Otherwise ask on stderr: list the proposals numbered, then `[a]ccept, [1-3] pick, [n]ew feature, [s]kip`; `a` takes the first proposal, a digit that hit, `n` creates a feature titled from the branch slug with '-' → ' ' (or the directory name without a branch), anything else (including '') skips.
6. Recording (not in dryRun): resolveWorkspace(path) (timeout: skip with a line); report `{ source: 'scan', machine: { alias, hostname, boot_id: null }, workspace, feature_id, sessions }` where sessions are the Claude and pi sessions of that path as `{ agent_kind, agent_session_id, cwd, transcript_path, observed_at }`; then writeMarker unless the marker already holds that id. Line `recorded <path> → <8-hex>`. In dryRun the line is `would record <path> → <8-hex>` and nothing is sent or written.
7. registerScanCommand: `scan` with `--root <dir>` (repeatable, collected into an array), `--depth <n>`, `--yes-exact`, `--dry-run`, usageExit and runTrackingCommand. Real deps: tasks from pgm.listTasks pages (limit 100) mapped to id and first-line title; search via `pgm.searchEntities({ query, type: 'task', limit: 3 })`; ask via readline on stderr; the discovery functions; resolveLocalWorkspace; readMarker; writeMarker with new Date(); existsSync.

Write the slice test `cli/tests/unit/tracking-scan.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/contract/cli-tracking.feature.test.ts`, `tests/contract/cli-scan.feature.test.ts`, `changes/004-cli-hooks/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/cli.md`, `specs/004-workspace-session-tracking/contracts/rest.md`, `changes/004-cli-hooks/proposal.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| No roots; bad depth | UsageError | scan-record | cli-t11 |
| A marker worktree, a short-id branch worktree and a plain one with yesExact | two recorded with feature_id, sessions and marker; plain skipped without search | scan-proposals, scan-record | cli-t11 |
| Interactive answers a, 2, n and s | first proposal; second hit; new feature from the branch; skip | scan-proposals | cli-t11 |
| dryRun | no report, no marker, no PATCH, would-record lines | scan-record | cli-t11 |
| A worktree already registered; a registered workspace whose path is gone | known line, not prompted; PATCH missing | scan-known | cli-t11 |

The check `cli-t11` runs `node changes/004-cli-hooks/slice-check.mjs cli/src/tracking/scan.ts cli/tests/unit/tracking-scan.test.ts`: Vitest on the slice test (from cli/), ESLint with zero allowed problems on the listed files, and tsc for cli/tsconfig.json. Call run_checks before you finish and fix every ESLint and tsc error it reports.

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
      "id": "cli-t11-tests",
      "requirementIds": [
        "scan-proposals",
        "scan-record",
        "scan-known"
      ],
      "question": "Do the tests cover root and depth validation, the proposal order, yesExact accepting only exact proposals without searching, each interactive answer, the recorded scan report with sessions and the marker, dry-run sending nothing, and known workspaces with the disk check?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/cli.md",
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "changes/004-cli-hooks/proposal.md"
      ],
      "testPaths": [
        "cli/tests/unit/tracking-scan.test.ts"
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
    "id": "scan-proposals",
    "text": "Scan proposals are the marker, then a unique short id in the branch, then the top three task search hits; --yes-exact accepts marker and short-id proposals and skips the rest without searching; the interactive prompt offers accept, pick, new and skip."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "scan-record",
    "text": "An accepted worktree is sent as one scan report with feature_id and its sessions and gets the marker; --dry-run sends and writes nothing; no roots exit 2."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "scan-known",
    "text": "Workspaces already registered on this machine are listed as known and not prompted, and the disk check of pgm where is applied to them."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
