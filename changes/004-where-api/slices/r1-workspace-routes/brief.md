# Slice brief: where-r1

Status: draft

## Outcome and boundaries

Create `src/transport/workspace-routes.ts` exporting exactly:

```ts
export function registerWorkspaceRoutes(
  app: Hono<{ Variables: { auth: AuthContext } }>,
  pool: Pool,
  options: { dormantAfterDays: number }
): void;
```

Every route reads `c.get('auth')`, calls one service with `options` where it takes them, and throws `result.error` on failure.

| Route | Input | Service | Response |
| --- | --- | --- | --- |
| POST /api/workspaces/report | JSON body, unchanged | reportWorkspace | 200 report object |
| PATCH /api/workspaces/:id | `{ feature_id?: string \| null, missing?: boolean }` (zod) | updateWorkspace({ id, featureId, missing }) | 200 `{ workspace }` |
| PUT /api/machines/:alias | `{ connect_target: string \| null }` (zod, key required) | setMachineConnectTarget | 200 `{ machine }` |
| GET /api/machines | none | listMachines | 200 `{ machines }` |
| GET /api/workspaces/lookup | query machine, path (both required, else 400) | lookupWorkspace | 200 `{ workspace, feature }` |
| GET /api/workspaces | query machine, repo, feature_id, unassigned, include_ended | listWorkspaces | 200 `{ workspaces }` |
| GET /api/where | query view, machine, repo, include_released, include_done, include_ended | getWhere | 200 where object |

Boolean query flags (`unassigned`, `include_*`): absent is undefined, `'true'` is true, `'false'` is false, any other value is VALIDATION (400). Pass optional values only when defined. A body that fails zod is VALIDATION with the first issue message. Register `/api/workspaces/lookup` before any `/api/workspaces/:id` GET (there is none today; keep it that way).

Write the slice test `tests/contract/workspace-routes.test.ts` (direct imports are fine). In the slice test build the app yourself: `const app = new Hono<{ Variables: { auth: AuthContext } }>()`, an `app.onError` copied from src/index.ts, `app.use('/api/*', async (c, next) => { c.set('auth', auth); await next(); })`, then `registerWorkspaceRoutes(app, pool, { dormantAfterDays: 7 })`, and call `app.request(...)`. You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/where-service.feature.test.ts`, `tests/contract/workspace-api.feature.test.ts`, `tests/contract/workspace-mcp.feature.test.ts`, `changes/004-where-api/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `changes/004-where-api/proposal.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| POST report with a valid hook body; with an invalid alias | 200 report object with the workspace; 400 | rest-workspace-routes, rest-errors | where-r1 |
| PATCH link by short id, missing true, empty body, unknown id | 200 { workspace } with feature_id or the missing risk; 400; 404 | rest-workspace-routes, rest-errors | where-r1 |
| PUT machine valid, invalid, unknown alias; GET machines | 200 { machine }; 400; 404; 200 { machines } sorted by alias | rest-workspace-routes, rest-errors | where-r1 |
| GET lookup in a subdirectory; no match; missing path query | 200 with workspace and feature; 200 with both null; 400 | rest-workspace-routes | where-r1 |
| GET workspaces with filters and flags; include_ended=yes | 200 { workspaces } filtered and sorted; 400 | rest-workspace-routes, rest-errors | where-r1 |
| GET where default, view=actions, view=kanban, include_done=1 | stage groups with dormant_after_days 7; actions groups; 400; 400 | rest-workspace-routes, rest-errors | where-r1 |
| Read-only auth on POST report, PATCH and PUT | 403 | rest-errors | where-r1 |

The check `where-r1` runs `node changes/004-where-api/slice-check.mjs src/transport/workspace-routes.ts tests/contract/workspace-routes.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Call run_checks before you finish and fix every ESLint and tsc error it reports. Integration and contract tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "where-r1-tests",
      "requirementIds": [
        "rest-workspace-routes",
        "rest-errors"
      ],
      "question": "Do the tests cover all seven routes with status and body, query flag parsing including invalid values, required lookup parameters, the options passthrough (dormant_after_days), and the 400, 403 and 404 envelopes?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "changes/004-where-api/proposal.md"
      ],
      "testPaths": [
        "tests/contract/workspace-routes.test.ts"
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
    "id": "rest-workspace-routes",
    "text": "POST /api/workspaces/report, PATCH /api/workspaces/:id, PUT /api/machines/:alias, GET /api/machines, GET /api/workspaces/lookup, GET /api/workspaces and GET /api/where call the workspace services with the bearer key's auth and return the rest.md bodies; boolean query flags accept exactly true or false, anything else is 400."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "rest-errors",
    "text": "Service errors use the existing error envelope and status mapping: VALIDATION 400, FORBIDDEN 403, NOT_FOUND 404, CONFLICT 409 with details.candidates; a request without a valid key is 401."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
