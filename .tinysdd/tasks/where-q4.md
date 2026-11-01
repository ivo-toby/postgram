# Slice brief: where-q4

Status: draft

## Outcome and boundaries

Create `src/services/workspace-update.ts` exporting exactly:

```ts
export function updateWorkspace(
  pool: Pool,
  auth: AuthContext,
  input: { id: string; featureId?: string | null | undefined; missing?: boolean | undefined },
  options: WorkspaceViewOptions
): ServiceResult<WorkspaceView>;
```

Validate and resolve everything before the first write:

1. `requireScope(auth, 'write')`. Neither `featureId` nor `missing` defined: VALIDATION.
2. `input.id` that is not a UUID, or a workspace that `loadWorkspaceViews(pool, auth, { workspaceIds: [id] }, ...)` does not return: NOT_FOUND.
3. `featureId === null` (unlink) when `allowedVisibility` lacks `'personal'`: FORBIDDEN (D9).
4. `featureId` a string: `resolveFeatureId`; return its error unchanged.

Then write:

5. When the resolved task's `metadata.kind !== 'feature'`, apply the feature defaults: `updateEntity(pool, auth, { id, version, metadata: { ...metadata, ...featureDefaults(nowIso) } })`. On CONFLICT resolve again and retry once; a second CONFLICT is returned. A task that is already a feature is not written.
6. When the link changes, `UPDATE workspaces SET feature_id = $1, updated_at = now() WHERE id = $2` and append `workspace_link` with `entityId` the workspace id and details `{ from, to }` (old and new feature id or null). An unchanged link writes nothing.
7. `missing: true`: `missing_since = COALESCE(missing_since, now())`; `missing: false`: `missing_since = NULL`. No audit row.
8. Return the workspace loaded again with `loadWorkspaceViews`.

Write the slice test `tests/integration/workspace-update.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/where-service.feature.test.ts`, `tests/contract/workspace-api.feature.test.ts`, `tests/contract/workspace-mcp.feature.test.ts`, `changes/004-where-api/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `changes/004-where-api/proposal.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| Link an unlinked workspace to a plain task by short id | feature_id set; the task gets kind feature, stage building, stage_source manual, stage_set_at, pull_requests []; one workspace_link {from: null, to} | workspace-link, workspace-audit | where-q4 |
| Link to a task that is already a feature; link again to the same feature | no entity write (version unchanged); no second audit row | workspace-link, workspace-audit | where-q4 |
| Unlink; unlink by a caller without personal | feature_id null with workspace_link {from, to: null}; FORBIDDEN and the link is unchanged | workspace-link, workspace-visibility | where-q4 |
| missing true twice, then false | missing_since set once and kept, risks contain missing; then null; no audit rows | workspace-missing, workspace-audit | where-q4 |
| No fields; non-UUID id; unknown workspace; invisible workspace; unknown feature; memory entity id; read-only key | VALIDATION, NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, VALIDATION, FORBIDDEN; nothing written | workspace-link | where-q4 |

The check `where-q4` runs `node changes/004-where-api/slice-check.mjs src/services/workspace-update.ts tests/integration/workspace-update.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Call run_checks before you finish and fix every ESLint and tsc error it reports. Integration and contract tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "where-q4-tests",
      "requirementIds": [
        "workspace-link",
        "workspace-missing",
        "workspace-audit",
        "workspace-visibility"
      ],
      "question": "Do the tests cover linking by both id forms with defaults on a plain task only, unlink with and without personal, the missing flag both ways and its idempotence, audit only on a changed link, and every rejection with a check that nothing was written?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "changes/004-where-api/proposal.md"
      ],
      "testPaths": [
        "tests/integration/workspace-update.test.ts"
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
    "id": "workspace-link",
    "text": "updateWorkspace requires write scope and at least one of featureId and missing; featureId (UUID or 8-hex) links the workspace, applies the feature defaults to a plain task, and null unlinks; an unknown or invisible workspace or feature is NOT_FOUND, a non-task feature id is VALIDATION, and nothing is written on any rejection."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "workspace-missing",
    "text": "missing true sets missing_since to now only when it is null; missing false clears it."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "workspace-audit",
    "text": "A link change writes workspace_link with from and to; an unchanged link, missing and connect-target changes write no audit row."
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
