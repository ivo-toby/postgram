# Slice brief: report-s3

Status: draft

## Outcome and boundaries

Create `src/services/workspace-view.ts`, pure functions only (no database, no clock reads):

- `isDormant(session: AgentSessionRow, now: Date, dormantAfterDays: number): boolean`: status running or idle and last_activity_at older than now minus dormantAfterDays days.
- `selectResumeSession(sessions: AgentSessionRow[]): AgentSessionRow | null`: highest last_activity_at among sessions with a non-null agent_session_id, any status.
- `selectVisibleSessions(sessions: AgentSessionRow[], includeEnded: boolean): AgentSessionRow[]`: by default all non-ended sessions plus the single most recently active session even when ended; with includeEnded all sessions; always sorted by last_activity_at descending.
- `computeRisks(workspace: WorkspaceRow, sessions: AgentSessionRow[]): Risk[]`: order dirty, unpushed, no_upstream, interrupted, missing, per the rest.md table; null git fields raise nothing; interrupted uses the most recently active session of any kind.
- `toWorkspaceView(input: { workspace: WorkspaceRow; machine: MachineRow; sessions: AgentSessionRow[]; now: Date; dormantAfterDays: number; includeEnded?: boolean }): WorkspaceView`: `machine` is machine.alias, `connect_target` is machine.connect_target ?? machine.alias, timestamps as ISO strings, `git` is null when all three git columns are null, otherwise the three values.

Write the slice test `tests/unit/workspace-view.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/workspace-report.feature.test.ts`, `specs/constitution.md`, `specs/constitution.approval.json`, anything under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| dirty 2, unpushed 3, upstream true | risks ['dirty','unpushed'] | report-response | report-s3 |
| has_upstream false with branch null | no no_upstream risk | report-response | report-s3 |
| newest session interrupted, older running | interrupted risk | report-response | report-s3 |
| ended session is newest with an id | resume_session is that ended session | report-response | report-s3 |
| idle session 31 days old, threshold 30 | dormant true, no risk added | report-response | report-s3 |

The check `report-s3` runs `node changes/004-report-core/slice-check.mjs src/services/workspace-view.ts tests/unit/workspace-view.test.ts`: Vitest on the slice test and ESLint with zero allowed problems on the listed TypeScript files. It needs Docker for integration tests and is run by the controller on the host; report what you expect it to show.

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
      "id": "report-s3-tests",
      "requirementIds": [
        "report-response"
      ],
      "question": "Do the tests pin the risk order, null-git handling, resume selection across statuses, visible-session defaults and dormancy boundary?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md"
      ],
      "testPaths": [
        "tests/unit/workspace-view.test.ts"
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
    "id": "report-response",
    "text": "The report returns the workspace object, session, sessions, feature, interrupted_sessions and warnings as defined in the report contract, with workspace and feature null when the report has no workspace."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
