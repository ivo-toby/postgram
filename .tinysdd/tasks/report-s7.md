# Slice brief: report-s7

Status: draft

## Outcome and boundaries

Create `src/services/workspace-service.ts` exporting `reportWorkspace(pool: Pool, auth: AuthContext, input: unknown, options: { dormantAfterDays: number }): ServiceResult<ReportResult>`.

Order: parseReportInput (VALIDATION, nothing written) → requireScope(auth, 'write') → one transaction on `pool.connect()`: upsertMachine → (hook with workspace and session) findTargetSession → (hook, non-null boot id) interruptRebootedSessions excluding S → stop here when there is no workspace → upsertWorkspace → resolveFeatureLink → applyHookSession or applyScanSessions → audit → load the workspace's sessions and build the view with toWorkspaceView and `now = new Date()` → loadFeatureSummary → COMMIT. On any error ROLLBACK, release the client in finally, and return err.

Audit rows (appendAuditEntry(client, …), apiKeyId auth.apiKeyId): machine_create (entity_id null, details { alias }), workspace_create and workspace_link (entity_id workspace id; link details { feature_id }), session_create and session_end (entity_id workspace id, details { session_id }), one session_interrupt per interrupted session (entity_id null, details { session_id, reason: 'reboot' }). Nothing else; activity-only reports write no audit row. Never write entities.

Result: workspace (null without workspace), session { id, status } for hook with a session, sessions [{ id, status }] for scan, feature, interrupted_sessions, warnings ([] when none). Omit session/sessions keys when not applicable (exactOptionalPropertyTypes).

Write the slice test `tests/integration/workspace-service.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/workspace-report.feature.test.ts`, `specs/constitution.md`, `specs/constitution.approval.json`, anything under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/data-model.md`, `src/util/audit.ts`, `src/auth/key-service.ts`, `src/services/admin-job-service.ts`, `src/services/task-service.ts`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| valid hook report | result per contract; one transaction | report-response | report-s7 |
| invalid input | err VALIDATION; no rows in any table | report-validate | report-s7 |
| read-only key | err FORBIDDEN; nothing written | report-scope | report-s7 |
| 50 activity reports after the first | no new audit rows; entities unchanged | audit-structural | report-s7 |
| a store step throws mid-transaction | everything rolled back | no-entity-write | report-s7 |

The check `report-s7` runs `node changes/004-report-core/slice-check.mjs src/services/workspace-service.ts tests/integration/workspace-service.test.ts`: Vitest on the slice test and ESLint with zero allowed problems on the listed TypeScript files. It needs Docker for integration tests and is run by the controller on the host; report what you expect it to show.

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
      "id": "report-s7-tests",
      "requirementIds": [
        "report-validate",
        "report-scope",
        "audit-structural",
        "no-entity-write",
        "report-response"
      ],
      "question": "Do the tests prove the step order, rollback on a mid-transaction failure, the exact audit set per case and the response keys for hook, scan and machine-only reports?",
      "interfaces": [
        "specs/004-workspace-session-tracking/data-model.md",
        "src/util/audit.ts",
        "src/auth/key-service.ts",
        "src/services/admin-job-service.ts",
        "src/services/task-service.ts"
      ],
      "testPaths": [
        "tests/integration/workspace-service.test.ts"
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
    "id": "report-validate",
    "text": "A workspace report that breaks the validation table or session-form rules of the report contract is rejected with VALIDATION, and nothing is written."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "report-scope",
    "text": "A workspace report requires write scope; a key without it gets FORBIDDEN and nothing is written."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "audit-structural",
    "text": "Reports write audit rows only for machine_create, workspace_create, workspace_link, session_create, session_end and session_interrupt; activity-only reports write none."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "no-entity-write",
    "text": "No workspace report writes the entities table, changes an entity version or changes enrichment status."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "report-response",
    "text": "The report returns the workspace object, session, sessions, feature, interrupted_sessions and warnings as defined in the report contract, with workspace and feature null when the report has no workspace."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
