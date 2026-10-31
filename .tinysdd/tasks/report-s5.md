# Slice brief: report-s5

Status: draft

## Outcome and boundaries

Create `src/services/workspace-store.ts`. Every function takes `client: PoolClient` first and runs only its own statements (the caller owns BEGIN/COMMIT). Use server `now()` for all times.

- `upsertMachine(client, input: { alias: string; hostname: string; bootId: string | null; source: 'hook' | 'scan' }): Promise<{ machine: MachineRow; created: boolean }>`: step 1. boot_id is set only when bootId is non-null and source is hook; otherwise the stored value stays.
- `upsertWorkspace(client, input: { machineId: string; source: 'hook' | 'scan'; path: string; repoRemote?: string | null; repoRoot?: string | null; branch?: string | null; git?: GitSnapshot | null; observedAt?: Date | null }): Promise<{ workspace: WorkspaceRow; created: boolean }>`: step 3. An undefined repo field keeps the stored value, null sets null. git undefined keeps the snapshot and git_state_at; null clears the three git columns and sets git_state_at = now(); an object sets them and git_state_at = now(). missing_since becomes null. last_activity_at is now() for hook; for scan it is GREATEST(existing, observedAt), or observedAt ?? now() on insert.
- `resolveFeatureLink(client, auth: AuthContext, input: { workspaceId: string; featureId?: string }): Promise<{ workspace: WorkspaceRow; linkChanged: boolean; warning: ReportWarning | null }>`: step 4. Visible task means entities.type = 'task', visibility in auth.allowedVisibility and allowedTypes null or containing 'task'. Not found or invisible → 'feature_not_found'; exists but not a task (and visible) → 'feature_not_task'; both leave the link unchanged. featureId undefined keeps the link. Never writes entities.
- `loadFeatureSummary(client, auth, featureId: string | null): Promise<ReportFeature | null>`: visible task → { id, title: first line of content trimmed and cut at 80 chars, stage: metadata.stage as string or null }; otherwise null.

Write the slice test `tests/integration/workspace-store.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/workspace-report.feature.test.ts`, `specs/constitution.md`, `specs/constitution.approval.json`, anything under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/data-model.md`, `src/auth/types.ts`, `tests/helpers/postgres.ts`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| first and second report for an alias | created true then false; one row | machine-upsert | report-s5 |
| scan report with boot id, hook report with null boot id | stored boot_id unchanged in both | machine-upsert | report-s5 |
| git omitted / null / object | keep / clear + new git_state_at / replace | workspace-upsert | report-s5 |
| branch omitted vs null | kept vs cleared | workspace-upsert | report-s5 |
| feature id: visible task, memory, unknown, work task with personal-only auth | linked / feature_not_task / feature_not_found / feature_not_found, link unchanged on warnings | feature-link | report-s5 |

The check `report-s5` runs `node changes/004-report-core/slice-check.mjs src/services/workspace-store.ts tests/integration/workspace-store.test.ts`: Vitest on the slice test and ESLint with zero allowed problems on the listed TypeScript files. It needs Docker for integration tests and is run by the controller on the host; report what you expect it to show.

## Stop conditions

- Stop and report if a cited excerpt contradicts this brief.
- Stop if the work would need a change to a protected file, a deletion or a write to `entities`.
- Report every file you created or changed.

## Slice test review contract

The JSON block must exactly match slice.json.testReview.

```json
{
  "schemaVersion": 1,
  "workflow": "slice-tests",
  "criteria": [
    {
      "id": "report-s5-tests",
      "requirementIds": [
        "machine-upsert",
        "workspace-upsert",
        "feature-link"
      ],
      "question": "Do the tests prove the omitted-versus-null semantics, the boot_id rule per source, every link outcome and that entities rows are never modified?",
      "interfaces": [
        "specs/004-workspace-session-tracking/data-model.md",
        "src/auth/types.ts",
        "tests/helpers/postgres.ts"
      ],
      "testPaths": [
        "tests/integration/workspace-store.test.ts"
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
    "id": "machine-upsert",
    "text": "Each report upserts its machine by alias with hostname and last_seen_at; the machine boot_id is set only by a hook report with a non-null boot id."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "workspace-upsert",
    "text": "A report upserts the workspace by machine and path with a trailing slash stripped; omitted repo keys keep stored values and null clears them; git null clears the snapshot, an omitted git keeps it and an object replaces it; missing_since is cleared; last_activity_at is now for hook reports and the newest observed time for scan reports."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "feature-link",
    "text": "A report with a feature_id of a visible task links the workspace; an unknown or invisible id gives warning feature_not_found and a non-task gives feature_not_task, both leaving the link unchanged; an absent feature_id keeps the link; a report never creates a feature or unlinks."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
