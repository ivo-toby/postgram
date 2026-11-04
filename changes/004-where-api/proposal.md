# Proposal: 004 phase 3, where API

Status: accepted (Ivo, 2026-11-01: decisions D1-D13, one change for services and adapters, 10-slice plan)

## Outcome

The service layer can read and manage workspaces, machines and the where
views. New service functions:

- `listWorkspaces`: visible workspaces with filters (machine, repo, feature,
  unassigned, include_ended), newest activity first.
- `lookupWorkspace`: machine + path to the workspace that equals the path or is
  its longest prefix at a `/` boundary, plus its feature summary (FR-039).
- `updateWorkspace`: link or unlink a feature, mark a workspace missing or
  found again.
- `listMachines` and `setMachineConnectTarget`.
- `getWhere`: the `stage` and `actions` views with their groups, inclusion
  rules and ordering (FR-026, FR-029, FR-031).

Every function returns the workspace object of rest.md through the existing
`toWorkspaceView`, follows the visibility rule of FR-040 (linked: the feature
is a visible task; unlinked: `personal` allowed) and checks the `read` or
`write` scope.

Rejections: invalid input is `VALIDATION`, a missing scope is `FORBIDDEN`, an
unknown or invisible workspace, machine or feature is `NOT_FOUND`, an
ambiguous short id is `CONFLICT`, and nothing is written in any of these
cases. Lookup never fails for "no match": it returns both fields `null`.

The services become reachable through REST and MCP:

- REST (rest.md): `POST /api/workspaces/report`, `PATCH /api/workspaces/:id`,
  `PUT /api/machines/:alias`, `PUT /api/repositories`, `POST /api/features`,
  `POST /api/features/:id/stage`, `POST /api/features/:id/pull-requests`,
  `GET /api/machines`, `GET /api/workspaces/lookup`, `GET /api/workspaces`
  and `GET /api/where`, with the existing auth and error envelope.
- MCP (mcp.md): `workspace_report`, `workspace_lookup`, `workspace_link`,
  `feature_stage`, `feature_pr` and `where`, compact by default and full with
  `full_response`.
- `createApp` takes `workspaceDormantAfterDays` (default 30), and the server
  passes `WORKSPACE_DORMANT_AFTER_DAYS` to it.

Preserved: the report transaction and feature service from phases 1 and 2,
the `entities` schema, migrations 001–018, every existing REST route and MCP
tool and their output.

Out of scope (later phases): all CLI work, hooks, the pi extension and scan.

## Source facts

- `specs/004-workspace-session-tracking/contracts/rest.md:49-98`: the
  workspace object, `resume_session`, `sessions`, `dormant`, `risks`.
- `specs/004-workspace-session-tracking/contracts/rest.md:99-104`: visibility
  (FR-040).
- `specs/004-workspace-session-tracking/contracts/rest.md:202-219`: PATCH
  workspace and PUT machine.
- `specs/004-workspace-session-tracking/contracts/rest.md:248-343`: machines,
  lookup, list and where (groups, inclusion, ordering).
- `specs/004-workspace-session-tracking/spec.md:186-206`: FR-026–FR-031,
  FR-039, FR-040.
- `src/services/workspace-view.ts`: pure `toWorkspaceView`, `computeRisks`,
  `selectResumeSession`, `selectVisibleSessions` (phase 1).
- `src/services/workspace-store.ts:244-356`: feature visibility checks and the
  title rule used by the report (phase 1).
- `src/services/feature-service.ts`: `resolveFeatureId` (phase 2).
- `src/services/feature-rules.ts`: `featureDefaults`, `isFeatureStage`
  (phase 2).
- `src/db/migrations/018_workspace_tracking.sql`: `workspaces.feature_id`
  references `entities(id) ON DELETE SET NULL`; `UNIQUE (machine_id, path)`.
- `specs/004-workspace-session-tracking/contracts/rest.md:123-246`: write
  endpoints and their bodies.
- `specs/004-workspace-session-tracking/contracts/mcp.md`: tools, compact
  outputs and descriptions.
- `src/transport/rest.ts:222-234,291-301`: `parseJsonBody`, `registerRestRoutes`.
- `src/transport/mcp.ts:159-271,292-305,970-990`: tool result helpers, the
  session server and `registerMcpRoutes`.
- `src/index.ts:218-236,295-316`: `createApp`, its error handler and the route
  registration.

## Proposed decisions

- D1: Linking a plain task through `updateWorkspace` applies the feature
  defaults (rest.md PATCH). This is a deliberate link, unlike a report, which
  never writes `entities` (phase 2 D1). The defaults go through `updateEntity`
  with one retry on `CONFLICT`.
- D2: A linked task without a valid `metadata.stage` is shown as `building`
  in every view (lookup and where), with `stage_source` and `stage_set_at`
  `null`. An invalid stored stage is treated the same.
- D3: Released features are hidden together with their workspaces unless
  `include_released=true` in the stage view; the actions view never shows them
  (FR-026, FR-031). Their workspaces never fall into `unassigned`, the same rule
  as `include_done`.
- D4: `listWorkspaces` accepts either feature id form for `featureId`, through
  `resolveFeatureId`, with its errors.
- D5: Machines carry no visibility. `listMachines` and
  `setMachineConnectTarget` need only the `read` or `write` scope. A connect
  target change writes no audit row (it is not in the audit list).
- D6: `updateWorkspace` writes `workspace_link` `{from, to}` only when the link
  changes. Marking missing or found writes no audit row (not in the audit
  list).
- D7: Shared pure helpers (the title rule, the feature summary of a task row,
  group building and ordering) live in `src/services/where-rules.ts` with unit
  tests. Each service function lives in its own file, so slices do not extend
  each other's files.
- D8 (controller detail, follows FR-040): lookup picks the longest matching
  path among the workspaces the caller can see. An invisible inner workspace
  never hides a visible outer one.
- D9 (controller detail, follows FR-040): unlinking makes a workspace
  personal, so `updateWorkspace` with `featureId: null` is `FORBIDDEN` for a
  caller without `personal` in `allowedVisibility`, before anything is
  written. A workspace id that is not a UUID is `NOT_FOUND`, like an unknown
  one.

- D10: The new tools accept `full_response` but not `toon`. The existing TOON
  output exists only for search, list and graph responses with their own
  encoders; `where` has none.
- D11: The MCP helpers `ToolPayload`, `toToolSuccess`, `toToolError`,
  `toolFromService`, `boolishSchema` and `fullResponseSchema` move unchanged
  from `src/transport/mcp.ts` to a new `src/transport/mcp-results.ts`, so the
  new tool file can use them. No existing tool changes.
- D12: New routes and tools live in new files:
  `src/transport/workspace-routes.ts`, `src/transport/feature-routes.ts` and
  `src/transport/mcp-workspace-tools.ts`. `rest.ts` only exports its existing
  `toStoredEntity`. Boolean query flags accept exactly `true` or `false`;
  anything else is `400`.
- D13: Compact `where` workspaces are `{machine, connect_target, path, branch,
  risks, resume_session: {agent_kind, agent_session_id, status, cwd} | null,
  latest_session: {agent_kind, agent_session_id, status} | null}`; feature
  fields stay as they are. `latest_session` is the first entry of `sessions`.

## Unknowns and stop conditions

- Stop if a view needs a migration or a change to `entities`.
- Stop if the visibility rule cannot be expressed in SQL over `workspaces`
  joined to `entities`.

## Requirements

See `deltas/where-api.json`.

## Acceptance criteria

- C1: `listWorkspaces` returns only visible workspaces per FR-040, applies
  every filter, sorts by `last_activity_at` DESC and honours `includeEnded`.
- C2: `lookupWorkspace` matches the exact path or the longest prefix at a `/`
  boundary on that machine, and returns `null`s for no match, an unknown
  machine or an invisible workspace.
- C3: `updateWorkspace` links (either id form, defaults on a plain task),
  unlinks, marks missing and found, audits link changes, and rejects without
  writing.
- C4: `listMachines` sorts by alias; `setMachineConnectTarget` validates the
  value and returns `NOT_FOUND` for an unknown alias.
- C5: `getWhere` returns every group in contract order, applies the inclusion
  rules, filters and ordering, and shows plain linked tasks as `building`.
- C6: every REST route of rest.md answers through `createApp` with the
  documented status, body and error envelope, and `GET /api/where` reports
  the configured `dormant_after_days`.
- C7: every MCP tool of mcp.md is listed, returns the compact output by
  default and the full one with `full_response`, and maps errors to tool
  errors.
