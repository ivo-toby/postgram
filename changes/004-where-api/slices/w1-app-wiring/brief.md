# Slice brief: where-w1

Status: draft

## Outcome and boundaries

Change only `src/index.ts`:

1. Add `workspaceDormantAfterDays?: number | undefined` to `AppOptions`.
2. In `createApp`, inside the block that calls `registerRestRoutes`, compute `const dormantAfterDays = options.workspaceDormantAfterDays ?? 30;`, call `registerWorkspaceRoutes(app, options.pool, { dormantAfterDays })` and `registerFeatureRoutes(app, options.pool)` right after `registerRestRoutes`, and pass `workspaceDormantAfterDays: dormantAfterDays` to `registerMcpRoutes`.
3. In `main`, pass `workspaceDormantAfterDays: config.WORKSPACE_DORMANT_AFTER_DAYS` to `createApp` (use the same config object the surrounding code uses for other values).

Nothing else changes; every existing route keeps working.

Write the slice test `tests/contract/workspace-wiring.test.ts` (direct imports are fine). The slice test uses `createApp({ pool, workspaceDormantAfterDays: 5 })` and `createApp({ pool })` and checks GET /api/where dormant_after_days (5 and 30) and that an existing route (GET /api/tasks) still answers. You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/where-service.feature.test.ts`, `tests/contract/workspace-api.feature.test.ts`, `tests/contract/workspace-mcp.feature.test.ts`, `changes/004-where-api/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `changes/004-where-api/proposal.md`, `src/index.ts`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| createApp with workspaceDormantAfterDays 5; without it | GET /api/where reports dormant_after_days 5; 30 | dormancy-wiring | where-w1 |
| createApp: POST /api/features and POST /api/workspaces/report | answer through the app (201 and 200) | rest-feature-routes, rest-workspace-routes | where-w1 |
| createApp: an existing route | unchanged answer | dormancy-wiring | where-w1 |

The check `where-w1` runs `node changes/004-where-api/slice-check.mjs src/index.ts tests/contract/workspace-wiring.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Call run_checks before you finish and fix every ESLint and tsc error it reports. Integration and contract tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "where-w1-tests",
      "requirementIds": [
        "dormancy-wiring",
        "rest-workspace-routes",
        "rest-feature-routes",
        "mcp-workspace-tools"
      ],
      "question": "Do the tests prove that createApp registers both route files and passes the dormancy option (set and default), and that an existing route still works?",
      "interfaces": [
        "changes/004-where-api/proposal.md",
        "src/index.ts"
      ],
      "testPaths": [
        "tests/contract/workspace-wiring.test.ts"
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
    "id": "dormancy-wiring",
    "text": "createApp accepts workspaceDormantAfterDays (default 30) and passes it to the workspace routes and MCP tools; the server passes WORKSPACE_DORMANT_AFTER_DAYS; existing routes and tools are unchanged."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "rest-workspace-routes",
    "text": "POST /api/workspaces/report, PATCH /api/workspaces/:id, PUT /api/machines/:alias, GET /api/machines, GET /api/workspaces/lookup, GET /api/workspaces and GET /api/where call the workspace services with the bearer key's auth and return the rest.md bodies; boolean query flags accept exactly true or false, anything else is 400."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "rest-feature-routes",
    "text": "PUT /api/repositories, POST /api/features (201), POST /api/features/:id/stage and POST /api/features/:id/pull-requests call the feature services, accept either feature id form in the path and return the rest.md bodies with entities in the existing stored-entity shape."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "mcp-workspace-tools",
    "text": "The MCP tools workspace_report, workspace_lookup, workspace_link, feature_stage, feature_pr and where call the same services as REST, return the compact outputs of mcp.md by default and the full REST-shaped payload with full_response, and return service errors as tool errors."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
