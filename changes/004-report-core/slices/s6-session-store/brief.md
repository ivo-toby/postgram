# Slice brief: report-s6

Status: draft

## Outcome and boundaries

Create `src/services/session-store.ts`. Every function takes `client: PoolClient` first; the caller owns the transaction. Use server `now()`.

- `findTargetSession(client, input: { machineId: string; path: string; agentKind: AgentKind; agentSessionId: string | null; event: SessionEvent }): Promise<string | null>`: id of S, locked FOR UPDATE. With an id: the row with that (workspace at machineId+path, agentKind, agentSessionId). Without an id: null for start, else the newest id-less row of that kind in that workspace. Null when the workspace does not exist.
- `interruptRebootedSessions(client, input: { machineId: string; bootId: string; excludeSessionId: string | null }): Promise<string[]>`: step 2. Sets status interrupted, end_reason 'reboot', ended_at now() on every session of the machine with status running or idle, non-null boot_id different from bootId, and id distinct from excludeSessionId. Returns the changed ids.
- `applyHookSession(client, input: { workspaceId: string; targetSessionId: string | null; agentKind: AgentKind; agentSessionId: string | null; event: SessionEvent; bootId: string | null; reason: string | null; cwd: string | null; transcriptPath: string | null }): Promise<{ session: AgentSessionRow; created: boolean; ended: boolean }>`: step 5 hook. Updates the target row or inserts one. Status by event: start/activity → running, stop → idle, end → ended with ended_at now() and end_reason = reason. Non-end events clear ended_at and end_reason. Sets last_activity_at now(), boot_id = bootId, and cwd/transcript_path only when non-null. `ended` is true when the status moved into ended from another status.
- `applyScanSessions(client, input: { workspaceId: string; sessions: { agentKind: AgentKind; agentSessionId: string | null; observedAt: Date; cwd: string | null; transcriptPath: string | null }[] }): Promise<{ session: AgentSessionRow; created: boolean }[]>`: step 5 scan. Insert: status idle, boot_id null, started_at = last_activity_at = observedAt. Existing (same key): last_activity_at = GREATEST(existing, observedAt) and fill cwd/transcript_path only when null; status unchanged.

Write the slice test `tests/integration/session-store.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/workspace-report.feature.test.ts`, `specs/constitution.md`, `specs/constitution.approval.json`, anything under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/data-model.md`, `tests/helpers/postgres.ts`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| s1, s2 running on boot A; interrupt with boot B excluding s1 | s2 interrupted/reboot, s1 untouched, returns [s2] | reboot-rule | report-s6 |
| session with null boot_id, or ended session, or other machine | never interrupted | reboot-rule | report-s6 |
| start, stop, end, activity on one id | running, idle, ended (+ended_at, end_reason), running (cleared); one row | session-hook | report-s6 |
| id-less start twice, then id-less stop | two rows; stop updates the newest | session-hook | report-s6 |
| scan insert, then scan with older and newer observedAt | idle/null boot; last_activity_at only moves forward | session-scan | report-s6 |

The check `report-s6` runs `node changes/004-report-core/slice-check.mjs src/services/session-store.ts tests/integration/session-store.test.ts`: Vitest on the slice test and ESLint with zero allowed problems on the listed TypeScript files. It needs Docker for integration tests and is run by the controller on the host; report what you expect it to show.

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
      "id": "report-s6-tests",
      "requirementIds": [
        "reboot-rule",
        "session-hook",
        "session-scan"
      ],
      "question": "Do the tests pin the reboot exclusions, every event transition, the id-less rules and the scan forward-only timestamp rule?",
      "interfaces": [
        "specs/004-workspace-session-tracking/data-model.md",
        "tests/helpers/postgres.ts"
      ],
      "testPaths": [
        "tests/integration/session-store.test.ts"
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
    "id": "reboot-rule",
    "text": "A hook report with a non-null boot id marks every other running or idle session on that machine whose non-null boot_id differs as interrupted with end_reason reboot and ended_at now; the reported session is never interrupted and interrupted_sessions counts the changed rows."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "session-hook",
    "text": "Hook reports upsert the session keyed by workspace, agent kind and agent session id; start and activity set running, stop sets idle, end sets ended with ended_at and end_reason, and any non-end event clears ended_at and end_reason; id-less start inserts, other id-less events update the newest id-less session of that kind or insert one."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "session-scan",
    "text": "Scan reports insert new sessions as idle with a null boot id and started_at and last_activity_at set to observed_at; existing sessions only move last_activity_at forward and fill a null cwd or transcript_path."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
