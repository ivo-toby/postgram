# Slice brief: cli-t7

Status: draft

## Outcome and boundaries

Create `cli/src/tracking/where.ts` exporting:

```ts
import type { Command } from 'commander';
import type { TrackingClient } from './api.js';
import type { ResumeTemplates } from './config.js';
import type { WhereResponse, WorkspaceView } from './types.js';
export function collectWorkspaces(response: WhereResponse): WorkspaceView[];
export async function syncMissing(
  workspaces: readonly WorkspaceView[],
  deps: { localAlias: string; exists: (path: string) => boolean; patch: (id: string, missing: boolean) => Promise<unknown> }
): Promise<{ changed: boolean; failedIds: Set<string> }>;
export type RenderInput = { localAlias: string; templates: ResumeTemplates; now: Date; exists: (path: string) => boolean; failedIds: ReadonlySet<string> };
export function augmentWhere(response: WhereResponse, input: RenderInput): unknown; // the --json body
export function renderWhere(response: WhereResponse, input: RenderInput): string[];
export type WhereOptions = { actions: boolean; machine?: string; repo?: string; all: boolean; includeEnded: boolean };
export async function runWhere(options: WhereOptions, deps: { client: TrackingClient; json: boolean } & Omit<RenderInput, 'failedIds'>): Promise<unknown>;
export function registerWhereCommand(program: Command): void;
```

Rules:

1. `syncMissing`: for each workspace with `machine === localAlias`: path missing and `missing_since === null` → `patch(id, true)`; path present and `missing_since !== null` → `patch(id, false)`. A successful patch sets changed. A rejected patch adds the id to failedIds (only for missing paths) and continues.
2. A workspace in failedIds gets `'missing'` appended to its risks when not present (rendering only, no mutation of the input).
3. `augmentWhere`: a deep copy where every workspace gains `resume` (renderResume with transcriptGone from isTranscriptGone) and `transcript_gone` (boolean).
4. `renderWhere`: per group with at least one feature (or workspace for unassigned): header `== <label> (<n>) ==`. Feature line: `<8-hex> <title>  [<stage>]` followed by ` PR:<state>` per pull request. Per workspace three lines: (1) `  <machine>  <branch ?? '-'>` plus `  <risks>` when there are risks, each risk as `dirty:<git.dirty_count>`, `unpushed:<git.unpushed_count>`, `no_upstream`, `interrupted` or `missing`, joined by one space; (2) `  <path>  git <formatAge(git_state_at) or ?>  <sessions>`, sessions as `<agent_kind>/<status> <formatAge(last_activity_at)>` plus ` dormant` when dormant and ` transcript gone` for the resume session of a transcript-gone workspace, joined by `, `, or `no sessions`; (3) `  resume: <command>`. Lines 1 and 2 longer than 60 characters are cut to 59 characters plus `…`. No blank lines.
5. `runWhere`: query `{ view: actions ? 'actions' : 'stage', machine?, repo?, includeReleased: all, includeDone: all, includeEnded }`; fetch, syncMissing over collectWorkspaces with `patch = (id, missing) => client.patchWorkspace(id, { missing })`, fetch again when changed, then return augmentWhere (json) or renderWhere lines.
6. `registerWhereCommand`: `where` with `--actions`, `--machine <alias>`, `--repo <remote>`, `--all`, `--include-ended`, usageExit, action via runTrackingCommand with localAlias = config.alias, templates = config.resume, now = new Date(), exists = existsSync.

Write the slice test `cli/tests/unit/tracking-where.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/contract/cli-tracking.feature.test.ts`, `tests/contract/cli-scan.feature.test.ts`, `changes/004-cli-hooks/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/cli.md`, `specs/004-workspace-session-tracking/contracts/rest.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| syncMissing: local gone unmarked; local present marked; remote gone; patch rejects | patch true; patch false; nothing; failedIds and continue | where-disk-check | cli-t7 |
| runWhere with a stub client when a patch changed something | where fetched twice, refreshed data rendered | where-disk-check | cli-t7 |
| renderWhere on a stage response with empty groups, a feature with a PR, risks, two sessions, dormant, long path | exact lines, empty groups skipped, 60-column cut | where-layout | cli-t7 |
| augmentWhere with a gone transcript and a remote workspace | resume and transcript_gone on every workspace, input unchanged | where-json | cli-t7 |
| runWhere flags --actions --all --include-ended --machine --repo | the query passed to client.where | where-json | cli-t7 |

The check `cli-t7` runs `node changes/004-cli-hooks/slice-check.mjs cli/src/tracking/where.ts cli/tests/unit/tracking-where.test.ts`: Vitest on the slice test (from cli/), ESLint with zero allowed problems on the listed files, and tsc for cli/tsconfig.json. Call run_checks before you finish and fix every ESLint and tsc error it reports.

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
      "id": "cli-t7-tests",
      "requirementIds": [
        "where-disk-check",
        "where-layout",
        "where-json"
      ],
      "question": "Do the tests cover each disk-check case including a failed patch and the refetch, the exact human lines (headers, feature line, three workspace lines, cut, skipped groups), the json augmentation and the flag mapping?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/cli.md",
        "specs/004-workspace-session-tracking/contracts/rest.md"
      ],
      "testPaths": [
        "cli/tests/unit/tracking-where.test.ts"
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
    "id": "where-disk-check",
    "text": "Before rendering, pgm where marks a local workspace whose path is gone as missing and clears missing for one whose path exists again, renders the refreshed data, and on a failed PATCH keeps going with missing added locally."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "where-layout",
    "text": "The human where layout prints group headers with counts and skips empty groups, a feature line with short id, title, stage and PR states, and three lines per workspace with risks, path, git age, sessions and the resume command, cutting the first two lines to 60 columns."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "where-json",
    "text": "pgm where --json prints the server response with resume and transcript_gone added to every workspace; --actions, --machine, --repo, --all and --include-ended map to the query parameters."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
