# Design: 004 phase 3, where API

## Shape

One file per service function or adapter, so a slice never extends a file
that another slice owns (TinySDD #201/#202).

Services:

- `src/services/where-rules.ts`: pure helpers, no database and no clock.
  `featureTitle`, `toWhereFeature` (D2), the group tables of both views and
  `buildWhereGroups` (inclusion and ordering).
- `src/services/workspace-query.ts`: `loadWorkspaceViews` (visible workspaces
  with their machine, then their sessions, then `toWorkspaceView`) and
  `listWorkspaces`.
- `src/services/workspace-lookup.ts`: `lookupWorkspace`.
- `src/services/workspace-update.ts`: `updateWorkspace`.
- `src/services/machine-service.ts`: `listMachines`,
  `setMachineConnectTarget`.
- `src/services/where-service.ts`: `getWhere`.

Adapters (D11, D12):

- `src/transport/workspace-routes.ts`: `registerWorkspaceRoutes(app, pool,
  { dormantAfterDays })` with the seven workspace, machine and where routes.
- `src/transport/feature-routes.ts`: `registerFeatureRoutes(app, pool)` with
  the repository and feature routes. `rest.ts` exports `toStoredEntity`.
- `src/transport/mcp-results.ts`: the tool result helpers, moved from
  `mcp.ts`.
- `src/transport/mcp-workspace-tools.ts`: `registerWorkspaceTools(server,
  pool, auth, { dormantAfterDays })`, called from `createSessionServer`.
- `src/index.ts`: `createApp` registers both route files after
  `registerRestRoutes`, passes `workspaceDormantAfterDays` (default 30) to
  them and to `registerMcpRoutes`; `main` passes the config value.

Visibility (FR-040) is one SQL condition in `loadWorkspaceViews`:
`(w.feature_id IS NULL AND 'personal' = ANY($allowed)) OR (e.type = 'task' AND
e.visibility = ANY($allowed) AND <task type allowed>)`, with a `LEFT JOIN
entities e ON e.id = w.feature_id`. Lookup, update and where reuse this
loader.

## Writes

`updateWorkspace` resolves the feature with `resolveFeatureId`, applies the
feature defaults to a plain task through `updateEntity` (one retry on
`CONFLICT`), then updates `workspaces` and appends `workspace_link`
`{from, to}` when the link changed. `setMachineConnectTarget` is a single
`UPDATE machines`. Routes and tools add no writes of their own.

## Slices

| Slice | Files | Test | Depends on |
| --- | --- | --- | --- |
| where-q1 | services/where-rules.ts | unit | none |
| where-q2 | services/workspace-query.ts | integration | none |
| where-q3 | services/workspace-lookup.ts | integration | q1, q2 |
| where-q4 | services/workspace-update.ts | integration | q2 |
| where-q5 | services/machine-service.ts | integration | none |
| where-q6 | services/where-service.ts | integration | q1, q2 |
| where-r2 | transport/feature-routes.ts, rest.ts (export) | contract | none |
| where-r1 | transport/workspace-routes.ts | contract | q3, q4, q5, q6, r2 |
| where-m1 | transport/mcp-results.ts, mcp-workspace-tools.ts, mcp.ts | contract | q3, q4, q6 |
| where-w1 | index.ts | contract | r1, r2, m1 |

r1 depends on r2 because both read `rest.ts` and r2 changes it (#201).

## Feature tests

- `tests/integration/where-service.feature.test.ts`: C1–C5 through the
  service functions, with data from `reportWorkspace`, `createTask` and
  `createFeature`.
- `tests/contract/workspace-api.feature.test.ts`: C6 through `createApp`
  with `workspaceDormantAfterDays: 7`.
- `tests/contract/workspace-mcp.feature.test.ts`: C7 through `createApp` and
  an MCP client, with `workspaceDormantAfterDays: 9`.

## Checks

`changes/004-where-api/slice-check.mjs` runs Vitest, ESLint and full-project
`tsc`, ignoring tsc errors inside the three feature tests. Integration and
contract tests are skipped without Docker; the controller runs them on the host
with `SLICE_CHECK_REQUIRE_DOCKER=1`. Feature acceptance runs all three feature
tests with Docker access (`.tinysdd/config.json`).
