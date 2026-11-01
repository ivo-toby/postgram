# Slice brief: where-q5

Status: draft

## Outcome and boundaries

Create `src/services/machine-service.ts` exporting exactly:

```ts
export type MachineSummary = { alias: string; hostname: string; connect_target: string | null; last_seen_at: string };

export function listMachines(pool: Pool, auth: AuthContext): ServiceResult<MachineSummary[]>;
export function setMachineConnectTarget(
  pool: Pool,
  auth: AuthContext,
  input: { alias: string; connectTarget: string | null }
): ServiceResult<MachineSummary>;
```

1. `listMachines`: `requireScope(auth, 'read')`; all machines ordered by alias; `last_seen_at` as an ISO string.
2. `setMachineConnectTarget`: `requireScope(auth, 'write')`; a string value must match `^[A-Za-z0-9._@:-]{1,255}$`, else VALIDATION; `null` clears it. `UPDATE machines SET connect_target = $1, updated_at = now() WHERE alias = $2 RETURNING ...`; no row: NOT_FOUND. Never insert or rename a machine. No audit row (D5).

Write the slice test `tests/integration/machine-service.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/where-service.feature.test.ts`, `tests/contract/workspace-api.feature.test.ts`, `tests/contract/workspace-mcp.feature.test.ts`, `changes/004-where-api/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `changes/004-where-api/proposal.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| Two machines reported in reverse alias order | listMachines sorted by alias with hostname, connect_target null and an ISO last_seen_at | machine-list | where-q5 |
| Set a valid target, then null | returned and stored; null clears it | machine-connect-target | where-q5 |
| Value with a space, 256 characters, unknown alias | VALIDATION, VALIDATION, NOT_FOUND; no machine created or changed | machine-connect-target | where-q5 |
| Key without read scope for list; without write scope for set | FORBIDDEN | machine-list, machine-connect-target | where-q5 |

The check `where-q5` runs `node changes/004-where-api/slice-check.mjs src/services/machine-service.ts tests/integration/machine-service.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Call run_checks before you finish and fix every ESLint and tsc error it reports. Integration and contract tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "where-q5-tests",
      "requirementIds": [
        "machine-list",
        "machine-connect-target"
      ],
      "question": "Do the tests cover the alias order and field shapes, setting and clearing the target, the regex edges and length, unknown alias without a write, and both scope checks?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "changes/004-where-api/proposal.md"
      ],
      "testPaths": [
        "tests/integration/machine-service.test.ts"
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
    "id": "machine-list",
    "text": "listMachines requires read scope and returns alias, hostname, connect_target and last_seen_at sorted by alias."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "machine-connect-target",
    "text": "setMachineConnectTarget requires write scope, accepts null or a value matching ^[A-Za-z0-9._@:-]{1,255}$ (else VALIDATION), returns NOT_FOUND for an unknown alias and never creates or renames a machine."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
