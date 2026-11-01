# Slice brief: where-q6

Status: draft

## Outcome and boundaries

Create `src/services/where-service.ts` exporting exactly:

```ts
export type WhereResult = { view: WhereView; generated_at: string; dormant_after_days: number; groups: WhereGroup[] };

export function getWhere(
  pool: Pool,
  auth: AuthContext,
  input: {
    view?: string | undefined;
    machine?: string | undefined;
    repo?: string | undefined;
    includeReleased?: boolean | undefined;
    includeDone?: boolean | undefined;
    includeEnded?: boolean | undefined;
  },
  options: WorkspaceViewOptions
): ServiceResult<WhereResult>;
```

1. `requireScope(auth, 'read')`. `view` defaults to `'stage'`; a value that fails `isWhereView` is VALIDATION. Read `now` once.
2. Workspaces: `loadWorkspaceViews(pool, auth, { machine, repo: normalized with normalizeRemote, includeEnded }, { now, dormantAfterDays })`.
3. Features: when tasks are allowed (`allowedTypes` null or containing 'task'), read `id, content, status, metadata` of entities with `type = 'task'`, `visibility = ANY(allowedVisibility)`, and `metadata->>'kind' = 'feature' OR id = ANY(<feature ids of the loaded workspaces>)`; map them with `toWhereFeature`. Otherwise no features.
4. `groups = buildWhereGroups({ view, features, workspaces, includeReleased, includeDone, filtered: machine !== undefined || repo !== undefined })` (flags default to false).
5. Return `{ view, generated_at: now.toISOString(), dormant_after_days: options.dormantAfterDays, groups }`.

Write the slice test `tests/integration/where-service.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/where-service.feature.test.ts`, `tests/contract/workspace-api.feature.test.ts`, `tests/contract/workspace-mcp.feature.test.ts`, `changes/004-where-api/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `specs/004-workspace-session-tracking/spec.md`, `changes/004-where-api/proposal.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| Features in building and review, a plain linked task, an unlinked workspace | stage view groups with the features and workspaces in place; the plain task in building | where-groups, where-plain-task | where-q6 |
| Released and done features with workspaces; includeReleased; includeDone | hidden by default with their workspaces; shown with the flags | where-inclusion | where-q6 |
| view actions; view kanban; key without read scope | actions groups; VALIDATION; FORBIDDEN | where-groups | where-q6 |
| machine filter and repo filter in another remote form | only matching workspaces; features without one dropped | where-inclusion | where-q6 |
| Caller without personal; caller with allowedTypes [memory] | no unlinked workspaces; no features and no linked workspaces | workspace-visibility | where-q6 |
| Any call | view, generated_at ISO, dormant_after_days from options | where-groups | where-q6 |

The check `where-q6` runs `node changes/004-where-api/slice-check.mjs src/services/where-service.ts tests/integration/where-service.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Call run_checks before you finish and fix every ESLint and tsc error it reports. Integration and contract tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "where-q6-tests",
      "requirementIds": [
        "where-groups",
        "where-inclusion",
        "where-plain-task",
        "workspace-visibility"
      ],
      "question": "Do the tests cover both views end to end, the plain linked task, released and done hiding with their flags, both filters, both visibility branches, the rejections and the top-level fields?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "specs/004-workspace-session-tracking/spec.md",
        "changes/004-where-api/proposal.md"
      ],
      "testPaths": [
        "tests/integration/where-service.test.ts"
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
    "id": "where-plain-task",
    "text": "A linked task without a valid metadata.stage is shown as stage building with stage_source and stage_set_at null; the title is the first content line, trimmed and cut at 80 characters."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "workspace-visibility",
    "text": "A linked workspace is visible only when its feature is a task whose visibility is in allowedVisibility and the task type is allowed; an unlinked workspace is visible only when personal is in allowedVisibility; invisible workspaces are never returned and are NOT_FOUND by id."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
