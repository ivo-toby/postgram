# Slice brief: where-q2

Status: draft

## Outcome and boundaries

Create `src/services/workspace-query.ts`. It exports exactly (formatting may differ):

```ts
import type { Pool, PoolClient } from 'pg';

export type WorkspaceViewOptions = { dormantAfterDays: number };
export type WorkspaceQuery = {
  machine?: string | undefined;        // exact machine alias
  repo?: string | undefined;           // already normalized remote, exact match on repo_remote
  featureId?: string | undefined;      // full UUID, exact match on feature_id
  unassigned?: boolean | undefined;    // true: feature_id IS NULL
  workspaceIds?: readonly string[] | undefined;
  includeEnded?: boolean | undefined;
};

export async function loadWorkspaceViews(
  db: Pool | PoolClient,
  auth: AuthContext,
  query: WorkspaceQuery,
  options: { now: Date; dormantAfterDays: number }
): Promise<WorkspaceView[]>;

export function listWorkspaces(
  pool: Pool,
  auth: AuthContext,
  input: {
    machine?: string | undefined;
    repo?: string | undefined;          // any remote form
    featureId?: string | undefined;     // UUID or 8-hex short id
    unassigned?: boolean | undefined;
    includeEnded?: boolean | undefined;
  },
  options: WorkspaceViewOptions
): ServiceResult<WorkspaceView[]>;
```

`loadWorkspaceViews` (no scope check; callers check it):

1. One query: `workspaces w JOIN machines m ON m.id = w.machine_id LEFT JOIN entities e ON e.id = w.feature_id`, selecting the workspace and machine columns (alias them so the row types are clear). Visibility (FR-040): `(w.feature_id IS NULL AND 'personal' = ANY($allowed)) OR (e.type = 'task' AND e.visibility = ANY($allowed) AND <task type allowed>)`, where task type allowed means `auth.allowedTypes === null || auth.allowedTypes.includes('task')` (decide it in TypeScript and pass a boolean parameter). Apply each defined filter of `query` with a parameter. Order by `w.last_activity_at DESC, w.id ASC`.
2. One query for the sessions of all returned workspaces: `WHERE workspace_id = ANY($1::uuid[])`, same columns as loadWorkspaceSessions in workspace-service.ts. Skip it when there are no workspaces.
3. Map each workspace with `toWorkspaceView({ workspace, machine, sessions, now, dormantAfterDays, includeEnded })` (`includeEnded` defaults to false). Build the MachineRow and WorkspaceRow objects exactly as typed in src/types/workspaces.ts.

`listWorkspaces`: `requireScope(auth, 'read')` first. `repo` is normalized with `normalizeRemote`. `featureId` is resolved with `resolveFeatureId` and its errors are returned unchanged; the filter uses the resolved entity id. `featureId` together with `unassigned: true` is VALIDATION. `now` is `new Date()`, read once.

Write the slice test `tests/integration/workspace-query.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/where-service.feature.test.ts`, `tests/contract/workspace-api.feature.test.ts`, `tests/contract/workspace-mcp.feature.test.ts`, `changes/004-where-api/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `specs/004-workspace-session-tracking/spec.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| Linked workspace (work feature), unlinked workspace, caller with and without personal; caller with allowedTypes [memory] | linked visible only when the feature visibility is allowed and tasks are allowed; unlinked only with personal | workspace-visibility | where-q2 |
| Filters machine, repo in another remote form, featureId as short id, unassigned | each returns only matching workspaces, sorted by last_activity_at DESC | workspace-list | where-q2 |
| featureId unknown, ambiguous, or combined with unassigned; key without read scope | NOT_FOUND, CONFLICT, VALIDATION, FORBIDDEN | workspace-list | where-q2 |
| Workspace with an old ended session, a running one and a newest ended one | default sessions are the non-ended ones plus the newest ended one; includeEnded returns all, newest first | session-window | where-q2 |
| Machine with connect_target null | workspace object connect_target equals the alias | workspace-visibility | where-q2 |

The check `where-q2` runs `node changes/004-where-api/slice-check.mjs src/services/workspace-query.ts tests/integration/workspace-query.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Call run_checks before you finish and fix every ESLint and tsc error it reports. Integration and contract tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "where-q2-tests",
      "requirementIds": [
        "workspace-visibility",
        "workspace-list",
        "session-window"
      ],
      "question": "Do the tests cover both visibility branches (linked and unlinked, including allowedTypes), every filter and its normalization or resolution, the error cases, the sort order and both session windows?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "specs/004-workspace-session-tracking/spec.md"
      ],
      "testPaths": [
        "tests/integration/workspace-query.test.ts"
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
    "id": "workspace-visibility",
    "text": "A linked workspace is visible only when its feature is a task whose visibility is in allowedVisibility and the task type is allowed; an unlinked workspace is visible only when personal is in allowedVisibility; invisible workspaces are never returned and are NOT_FOUND by id."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "workspace-list",
    "text": "listWorkspaces requires read scope, filters by exact machine alias, normalized repo remote, feature id (UUID or 8-hex short id) and unassigned, and sorts by last_activity_at descending."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "session-window",
    "text": "Workspace sessions hold the non-ended sessions plus the single most recently active session, or all sessions with includeEnded, sorted by last_activity_at descending."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
