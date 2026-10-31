# Slice brief: report-s4

Status: draft

## Outcome and boundaries

Create `src/services/workspace-report-schema.ts` exporting `type ReportInput` and `parseReportInput(raw: unknown): Result<ReportInput, AppError>`.

Rules: every row of the rest.md validation table, plus the session forms. `source` defaults to `hook`. Without `workspace`, `session`, `sessions` and `feature_id` must be absent. Hook: at most one `session`, `sessions` is rejected, `event` is required. Scan: `sessions` array required, `session` rejected, each entry needs ISO `observed_at`; `event` is ignored. Unknown keys are rejected.

Output shape: keys the caller omitted stay absent (`undefined`) and `null` stays `null`, for `repo_remote`, `repo_root`, `branch` and `git`. `workspace.path` loses trailing `/` except for `/` itself. `feature_id: null` becomes absent. A string `repo_remote` is passed through `normalizeRemote`. `ReportInput` is a discriminated union on `source`. Every failure is one AppError with code VALIDATION and the zod issues in details.

Write the slice test `tests/unit/workspace-report-schema.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/workspace-report.feature.test.ts`, `specs/constitution.md`, `specs/constitution.approval.json`, anything under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `src/util/errors.ts`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| valid hook report | ok, defaults applied, remote normalized | report-validate | report-s4 |
| alias with uppercase, relative path, short feature id, event missing for hook | err VALIDATION each | report-validate | report-s4 |
| hook with sessions, scan with session, scan entry without observed_at | err VALIDATION | report-validate | report-s4 |
| no workspace but session present | err VALIDATION | report-validate | report-s4 |
| git omitted vs git null | omitted stays undefined ('git' in output is false), null stays null | report-validate | report-s4 |

The check `report-s4` runs `node changes/004-report-core/slice-check.mjs src/services/workspace-report-schema.ts tests/unit/workspace-report-schema.test.ts`: Vitest on the slice test and ESLint with zero allowed problems on the listed TypeScript files. It needs Docker for integration tests and is run by the controller on the host; report what you expect it to show.

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
      "id": "report-s4-tests",
      "requirementIds": [
        "report-validate"
      ],
      "question": "Do the tests cover every validation-table row, both session forms, the omitted-versus-null distinction and the trailing slash rule?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "src/util/errors.ts"
      ],
      "testPaths": [
        "tests/unit/workspace-report-schema.test.ts"
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
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
