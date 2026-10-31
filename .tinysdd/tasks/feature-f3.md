# Slice brief: feature-f3

Status: draft

## Outcome and boundaries

Create `src/services/feature-service.ts` exporting:

```ts
export function resolveFeatureId(pool: Pool, auth: AuthContext, id: string): ServiceResult<Entity>;
export function createFeature(pool: Pool, auth: AuthContext, input: { content: string; tags?: string[] | undefined; visibility?: Visibility | undefined }): ServiceResult<Entity>;
export function setRepositoryReleaseOnMerge(pool: Pool, auth: AuthContext, input: { remote: string; releaseOnMerge: boolean }): ServiceResult<RepositorySetting>;
```

- `resolveFeatureId` (read scope): a full UUID (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, lowercase) or an 8-hex short id (`^[0-9a-f]{8}$`); anything else is VALIDATION. UUID: missing, or not visible (visibility not in `auth.allowedVisibility`, or `auth.allowedTypes` set without the row's type) → NOT_FOUND; visible but not a task → VALIDATION. Short id: `type = 'task' AND status IS DISTINCT FROM 'archived' AND id::text LIKE $1 || '%' AND visibility = ANY($2)`, ordered by id; none → NOT_FOUND; more than one → CONFLICT with `details.candidates: [{ id, title }]` where title is `(content ?? '').split('\n')[0].trim().slice(0, 80)`; a key whose allowedTypes excludes task → NOT_FOUND. Returns the task as an `Entity` (copy `EntityRow` and `mapEntity` from task-service).
- `createFeature` (write scope via storeEntity): content must be a non-empty string after trim, else VALIDATION. Calls `storeEntity` with type task, status inbox, the given tags and visibility, and `metadata: featureDefaults(new Date().toISOString())`.
- `setRepositoryReleaseOnMerge` (write scope): `normalizeRemote(remote)`; an empty result is VALIDATION. Upsert `repositories (remote, release_on_merge, updated_at = now())` and read the previous value in the same statement (for example a CTE). When the row is new or the value changed, append audit `repository_update` with `entityId: null` and details `{ remote, release_on_merge }`. Returns `{ remote, release_on_merge }`.

Write the slice test `tests/integration/feature-service.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/feature-service.feature.test.ts`, `changes/004-feature-core/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `specs/004-workspace-session-tracking/research.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| createFeature with content and tags | inbox task with feature defaults and the tags | feature-create | feature-f3 |
| resolve full UUID and its 8-hex prefix | the same task | feature-id-resolve | feature-f3 |
| two tasks sharing a prefix; then one archived | CONFLICT with candidates ordered by id; then the other resolves | feature-id-resolve | feature-f3 |
| bad format, uppercase, memory UUID, unknown UUID, unknown prefix, invisible task | VALIDATION, VALIDATION, VALIDATION, NOT_FOUND, NOT_FOUND, NOT_FOUND | feature-id-resolve | feature-f3 |
| set release_on_merge true twice, then false | normalized remote returned; audit rows for create and change only | repository-setting | feature-f3 |
| read-only key on createFeature or setRepositoryReleaseOnMerge | FORBIDDEN, nothing written | repository-setting | feature-f3 |

The check `feature-f3` runs `node changes/004-feature-core/slice-check.mjs src/services/feature-service.ts tests/integration/feature-service.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Run it with run_checks before you finish and fix every ESLint and tsc error it reports. Integration tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "feature-f3-tests",
      "requirementIds": [
        "feature-create",
        "feature-id-resolve",
        "repository-setting",
        "feature-audit"
      ],
      "question": "Do the tests cover every row of the feature id table, candidate ordering and titles, archived exclusion, createFeature defaults, and repository upsert with audit only on create or change?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "specs/004-workspace-session-tracking/research.md"
      ],
      "testPaths": [
        "tests/integration/feature-service.test.ts"
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
    "id": "feature-create",
    "text": "createFeature creates a task with status inbox and the feature defaults, with the given content, tags and visibility."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "feature-id-resolve",
    "text": "A feature id is a full UUID or an 8-hex short id matching the start of a non-archived visible task id; more than one match is CONFLICT with candidates id and title, any other format or a non-task UUID is VALIDATION, and an unknown or invisible id is NOT_FOUND."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "repository-setting",
    "text": "setRepositoryReleaseOnMerge normalizes the remote, upserts its release_on_merge value, requires write scope and returns remote and release_on_merge; a missing repository row means release_on_merge false."
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
