# Slice brief: feature-f4

Status: draft

## Outcome and boundaries

Add to `src/services/feature-service.ts`:

```ts
export function setFeatureStage(pool: Pool, auth: AuthContext, input: { id: string; stage: string }): ServiceResult<SetStageResult>;
```

Order: `requireScope(auth, 'write')` (FORBIDDEN), then `isFeatureStage(input.stage)` (VALIDATION), then `resolveFeatureId` (either id form). Nothing is written on any failure.

Let `m` be the task metadata and `now = new Date().toISOString()`. The task is a feature when `m.kind === 'feature'` and `isFeatureStage(m.stage)`; then `previous_stage = m.stage`, otherwise `previous_stage = null` and the base is `{ ...m, ...featureDefaults(now) }` (keep the other keys of `m`). Write `{ ...base, stage, stage_source: 'manual', stage_set_at: now }` with `updateEntity(pool, auth, { id, version, metadata })` (never content or status).

Put the read-compute-write in one private helper that you can reuse later: on a `CONFLICT` from `updateEntity`, re-resolve the task and recompute once; a second CONFLICT is returned as CONFLICT. After a successful write, when `previous_stage !== stage`, append audit `feature_stage` with `entityId` the task id and details `{ from: previous_stage, to: stage, source: 'manual' }`. Return `{ entity, previous_stage }`.

Write the slice test `tests/integration/feature-stage.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/feature-service.feature.test.ts`, `changes/004-feature-core/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `specs/004-workspace-session-tracking/data-model.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| plain task, stage functional_test by short id | feature with stage functional_test, manual, previous_stage null, other metadata keys kept | stage-set | feature-f4 |
| functional_test → building | allowed; previous_stage functional_test | stage-set | feature-f4 |
| stage released | status unchanged | released-status | feature-f4 |
| stage shipping; read-only key | VALIDATION; FORBIDDEN; row unchanged | stage-set | feature-f4 |
| version bumped by another write between read and write (once, then twice) | retry succeeds once; a persistent conflict returns CONFLICT | stage-set | feature-f4 |
| three stage changes and one same-stage set | three feature_stage rows with from/to/source; none for the same stage | feature-audit | feature-f4 |

The check `feature-f4` runs `node changes/004-feature-core/slice-check.mjs src/services/feature-service.ts tests/integration/feature-stage.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Run it with run_checks before you finish and fix every ESLint and tsc error it reports. Integration tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "feature-f4-tests",
      "requirementIds": [
        "stage-set",
        "released-status",
        "feature-audit"
      ],
      "question": "Do the tests prove any-to-any moves, plain-task promotion with kept keys, unchanged status, rejection without writes, the single retry and the feature_stage audit rows?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "specs/004-workspace-session-tracking/data-model.md"
      ],
      "testPaths": [
        "tests/integration/feature-stage.test.ts"
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
    "id": "stage-set",
    "text": "setFeatureStage sets any stage from any stage with stage_source manual and stage_set_at now, turns a plain task into a feature, returns the previous stage (null for a plain task), requires write scope and retries once on a version conflict before returning CONFLICT."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "released-status",
    "text": "Reaching released, by hand or derived, never changes the task status."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "feature-audit",
    "text": "A stage change writes feature_stage with from, to and source; a new or changed PR writes feature_pr with url and state; a repository setting change writes repository_update with remote and release_on_merge; a same-state PR re-report writes neither feature_stage nor feature_pr."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
