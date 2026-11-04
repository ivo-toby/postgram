# Slice brief: feature-f2

Status: draft

## Outcome and boundaries

Make `createTask` and `updateTask` in `src/services/task-service.ts` normalize feature metadata with `normalizeFeatureMetadata` from `./feature-rules.js`. Their signatures and return types stay the same.

- `createTask`: compute the metadata as today (`mergeTaskMetadata(...) ?? {}`). When its `kind` is `'feature'`, normalize it with `previous: null` and `now = new Date().toISOString()`. On `err`, return `errAsync(error)` without writing. Otherwise pass the result to `storeEntity`. Non-feature metadata is passed exactly as today (including `undefined` when empty).
- `updateTask`: when `input.metadata`, `context` and `dueDate` are all undefined, behave exactly as today. Otherwise read the row first (`SELECT type, visibility, metadata FROM entities WHERE id = $1`, typed). When the row is missing, is not a task, or the caller lacks access (`auth.allowedTypes` set and without 'task', or the visibility not in `auth.allowedVisibility`), skip normalization and call `updateEntity` as today so it returns its own error (decision D7: validation never reveals existence). Otherwise build `next = { ...row.metadata, ...merged }`, normalize with `previous: row.metadata`, return `err` VALIDATION without writing, or call `updateEntity` with the normalized metadata.
- Wrap the read in `ResultAsync.fromPromise` and chain with `andThen`, so both functions still return a `ServiceResult<Entity>`.
- `listTasks` and `completeTask` are unchanged.

Write the slice test `tests/integration/task-feature-metadata.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/feature-service.feature.test.ts`, `changes/004-feature-core/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `src/services/task-service.ts`, `specs/004-workspace-session-tracking/data-model.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| createTask with metadata {kind:"feature"} | stored with stage building, stage_source manual, stage_set_at, pull_requests [] | feature-defaults | feature-f2 |
| createTask without kind feature | metadata stored exactly as before | feature-defaults | feature-f2 |
| createTask/updateTask with stage shipping | err VALIDATION; no row written / version unchanged | feature-validate | feature-f2 |
| updateTask stage review→building on a derived feature | stage_source manual, stage_set_at changed | feature-manual-update | feature-f2 |
| updateTask on a work task with a personal-only key and invalid stage | the updateEntity access error (FORBIDDEN), not VALIDATION | feature-validate | feature-f2 |

The check `feature-f2` runs `node changes/004-feature-core/slice-check.mjs src/services/task-service.ts tests/integration/task-feature-metadata.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Run it with run_checks before you finish and fix every ESLint and tsc error it reports. Integration tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

## Stop conditions

- Stop and report if a cited excerpt contradicts this brief.
- Stop if the work would need a change to a protected file or a deletion.
- Report every file you created or changed.

## Slice test review contract

The JSON block must exactly match slice.json.testReview.

```json
{
  "schemaVersion": 1,
  "workflow": "slice-tests",
  "criteria": [
    {
      "id": "feature-f2-tests",
      "requirementIds": [
        "feature-defaults",
        "feature-validate",
        "feature-manual-update"
      ],
      "question": "Do the tests prove defaults on create and update, unchanged non-feature tasks, rejection without writes, the manual-stage rule and that an invisible task never gets a VALIDATION answer?",
      "interfaces": [
        "src/services/task-service.ts",
        "specs/004-workspace-session-tracking/data-model.md"
      ],
      "testPaths": [
        "tests/integration/task-feature-metadata.test.ts"
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
    "id": "feature-defaults",
    "text": "When the resulting metadata of createTask or updateTask has kind feature, absent keys get the defaults stage building, stage_source manual, stage_set_at now and pull_requests []; tasks without kind feature are unchanged."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "feature-validate",
    "text": "A present but invalid stage or stage_source, or malformed pull_requests (not an array of canonical GitHub PR URLs with state open, merged or closed and a string updated_at), is rejected with VALIDATION and nothing is written; values are never coerced."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "feature-manual-update",
    "text": "A stage changed through updateTask sets stage_source manual and stage_set_at now; updateTask never derives a stage."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
