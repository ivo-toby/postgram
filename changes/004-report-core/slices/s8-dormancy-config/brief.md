# Slice brief: report-s8

Status: draft

## Outcome and boundaries

Add the server setting `WORKSPACE_DORMANT_AFTER_DAYS`: integer ≥ 1, default 30, blank treated as unset, using the existing `z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(30))` pattern in `src/config.ts`.

Propagate it: `docker-compose.yml` environment line `WORKSPACE_DORMANT_AFTER_DAYS: ${WORKSPACE_DORMANT_AFTER_DAYS:-30}` next to the other server settings, and a README configuration table row (required: no, default `30`, description: days without activity after which a running or idle agent session is shown as dormant; informational only). Do not reformat other lines. Do not touch `.env.example`: TinySDD treats it as a secret path, so the controller updates it by hand.

Write the slice test `tests/unit/config-workspace.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/workspace-report.feature.test.ts`, `specs/constitution.md`, `specs/constitution.approval.json`, anything under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `src/config.ts`, `tests/unit/config.test.ts`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| unset or blank | 30 | dormancy-config | report-s8 |
| '7' | 7 | dormancy-config | report-s8 |
| '0', '-1', 'abc' | loadConfig throws | dormancy-config | report-s8 |
| docker-compose.yml, README.md | each mentions WORKSPACE_DORMANT_AFTER_DAYS with default 30 | dormancy-config | report-s8 |

The check `report-s8` runs `node changes/004-report-core/slice-check.mjs src/config.ts tests/unit/config-workspace.test.ts`: Vitest on the slice test and ESLint with zero allowed problems on the listed TypeScript files. It needs Docker for integration tests and is run by the controller on the host; report what you expect it to show.

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
      "id": "report-s8-tests",
      "requirementIds": [
        "dormancy-config"
      ],
      "question": "Do the tests check default, override, blank and invalid values, and that docker-compose.yml and README.md carry the setting?",
      "interfaces": [
        "src/config.ts",
        "tests/unit/config.test.ts"
      ],
      "testPaths": [
        "tests/unit/config-workspace.test.ts"
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
    "id": "dormancy-config",
    "text": "The server setting WORKSPACE_DORMANT_AFTER_DAYS defaults to 30, accepts integers of at least 1, and is documented in docker-compose.yml, .env.example and the README configuration table."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
