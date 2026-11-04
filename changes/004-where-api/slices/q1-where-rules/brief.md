# Slice brief: where-q1

Status: draft

## Outcome and boundaries

Create `src/services/where-rules.ts`, pure helpers for the where views. No database and no clock reads. It exports exactly (formatting may differ):

```ts
import type { EntityStatus } from '../types/entities.js';
import type { FeaturePullRequest, FeatureStage, StageSource } from '../types/features.js';
import type { WorkspaceView } from '../types/workspaces.js';

export type WhereView = 'stage' | 'actions';
export type FeatureTaskRow = { id: string; content: string | null; status: EntityStatus | null; metadata: Record<string, unknown> | null };
export type WhereFeatureSummary = {
  id: string; title: string; stage: FeatureStage; stage_source: StageSource | null;
  stage_set_at: string | null; task_status: EntityStatus | null; pull_requests: FeaturePullRequest[];
};
export type WhereFeature = WhereFeatureSummary & { workspaces: WorkspaceView[] };
export type WhereFeatureGroup = { key: string; label: string; features: WhereFeature[] };
export type WhereUnassignedGroup = { key: 'unassigned'; label: 'Unassigned'; workspaces: WorkspaceView[] };
export type WhereGroup = WhereFeatureGroup | WhereUnassignedGroup;

export function isWhereView(value: unknown): value is WhereView;
export function featureTitle(content: string | null): string;
export function toWhereFeature(row: FeatureTaskRow): WhereFeatureSummary;
export function buildWhereGroups(input: {
  view: WhereView;
  features: readonly WhereFeatureSummary[];
  workspaces: readonly WorkspaceView[];
  includeReleased: boolean;
  includeDone: boolean;
  filtered: boolean;
}): WhereGroup[];
```

Rules:

1. `isWhereView`: true only for `'stage'` and `'actions'`.
2. `featureTitle`: `(content ?? '').split('\n')[0].trim().slice(0, 80)`, no ellipsis.
3. `toWhereFeature`: `title` from `featureTitle`, `task_status` is `row.status`. When `metadata.stage` passes `isFeatureStage`: `stage` is that value, `stage_source` is `metadata.stage_source` when it is `'manual'` or `'derived'` (else null), `stage_set_at` is `metadata.stage_set_at` when it is a string (else null). Otherwise (plain task, missing or invalid stage): `stage: 'building'`, `stage_source: null`, `stage_set_at: null`. `pull_requests` keeps only array entries that are objects with a string `url`, a state passing `isPullRequestState` and a string `updated_at` (copy just those three keys); anything else gives `[]`.
4. `buildWhereGroups`:
   - Groups, always all present in this order, even when empty. Stage view: building "Building", review "Review", functional_test "Functional test", ready_to_merge "Ready to merge", awaiting_release "Awaiting release", released "Released" (only when `includeReleased`), unassigned "Unassigned". Actions view: review "Review" (stage review), test "Test" (functional_test), merge "Merge" (ready_to_merge), release "Release" (awaiting_release), in_progress "In progress" (building), unassigned "Unassigned". The actions view never has a released group, even with `includeReleased`.
   - A feature is hidden when its `task_status` is `'done'` or `'archived'` and `includeDone` is false, or when its stage is `'released'` and it is not (stage view with `includeReleased`).
   - Each shown feature gets `workspaces`: the input workspaces whose `feature_id` equals its id, sorted by `last_activity_at` DESC then `id` ASC. When `filtered` is true, a feature without workspaces is dropped; otherwise it is listed with `workspaces: []`.
   - The unassigned group holds the workspaces with `feature_id === null`, same sort. A workspace linked to a hidden feature, or to a feature that is not in `features`, appears nowhere.
   - Features inside a group: newest workspace `last_activity_at` DESC (features without workspaces last), then `stage_set_at` DESC (null last; compare with Date.parse), then `id` ASC.
   - Never mutate the inputs.

Write the slice test `tests/unit/where-rules.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/where-service.feature.test.ts`, `tests/contract/workspace-api.feature.test.ts`, `tests/contract/workspace-mcp.feature.test.ts`, `changes/004-where-api/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `changes/004-where-api/proposal.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| Two features in building and review with workspaces, one unlinked workspace | stage view keys and labels in order without released; features in their groups; unassigned holds the unlinked workspace | where-groups | where-q1 |
| includeReleased in the stage view; same flag in the actions view | released group between awaiting_release and unassigned; actions view never has it and never shows released features | where-groups, where-inclusion | where-q1 |
| Feature with task_status done or archived, with a workspace | hidden with its workspace unless includeDone; the workspace is not in unassigned | where-inclusion | where-q1 |
| filtered true with a feature without workspaces; filtered false | dropped when filtered; listed with workspaces [] when not | where-inclusion | where-q1 |
| Three features with different newest workspace times, one without workspaces, ties on time | ordered by newest workspace DESC, no-workspace last, then stage_set_at DESC, then id ASC | where-order | where-q1 |
| toWhereFeature on a plain task, an invalid stage, a valid feature with junk pull_requests entries | building with null stage_source and stage_set_at; valid metadata copied; only valid PR entries kept; title first line cut at 80 | where-plain-task | where-q1 |

The check `where-q1` runs `node changes/004-where-api/slice-check.mjs src/services/where-rules.ts tests/unit/where-rules.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Call run_checks before you finish and fix every ESLint and tsc error it reports. Integration and contract tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "where-q1-tests",
      "requirementIds": [
        "where-groups",
        "where-inclusion",
        "where-order",
        "where-plain-task"
      ],
      "question": "Do the tests cover both views' group keys, labels and order (with and without includeReleased), the done/archived and released hiding including their workspaces, the filtered drop, all three ordering keys, and toWhereFeature for plain, invalid and valid metadata?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "changes/004-where-api/proposal.md"
      ],
      "testPaths": [
        "tests/unit/where-rules.test.ts"
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
    "id": "where-groups",
    "text": "getWhere requires read scope, accepts view stage (default) or actions (else VALIDATION), and returns view, generated_at, dormant_after_days and every group of the view in contract order with its label, even when empty; released appears only in the stage view with includeReleased."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "where-inclusion",
    "text": "Features whose task status is done or archived are hidden unless includeDone, released features are hidden unless includeReleased in the stage view and always in the actions view, and the workspaces of hidden features never fall into unassigned; with a machine or repo filter only matching workspaces are kept and features without one are dropped; without a filter features without workspaces are listed with workspaces []."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "where-order",
    "text": "Features are ordered by their newest workspace last_activity_at descending (features without workspaces last), then stage_set_at descending, then id ascending; workspaces by last_activity_at descending."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "where-plain-task",
    "text": "A linked task without a valid metadata.stage is shown as stage building with stage_source and stage_set_at null; the title is the first content line, trimmed and cut at 80 characters."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
