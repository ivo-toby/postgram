# Slice brief: where-m1

Status: draft

## Outcome and boundaries

1. Create `src/transport/mcp-results.ts` and move these from `src/transport/mcp.ts` without changing them: `type ToolPayload` (export it), `boolishSchema`, `fullResponseSchema`, `toToolSuccess`, `toToolError`, `toolFromService`. Export each. In `mcp.ts` delete the moved definitions and import them from `./mcp-results.js`. Every existing tool keeps its exact behaviour.

2. Create `src/transport/mcp-workspace-tools.ts` exporting exactly:

```ts
export function registerWorkspaceTools(
  server: McpServer,
  pool: Pool,
  auth: AuthContext,
  options: { dormantAfterDays: number }
): void;
```

Tools (descriptions from mcp.md, word for word; every tool takes `full_response: fullResponseSchema`, none takes `toon`). With `full_response` the tool returns the full payload; otherwise the compact one:

| Tool | Input | Full payload | Compact payload |
| --- | --- | --- | --- |
| workspace_report | `source?`, `machine`, `workspace?`, `feature_id?` (string or null), `session?`, `sessions?` (z.unknown() for the objects) | the report object | `{ workspace_id: workspace?.id ?? null, session_id: session?.id ?? null, session_status: session?.status ?? null, feature, interrupted_sessions, warnings }` |
| workspace_lookup | `machine`, `path` | `{ workspace, feature }` | `{ workspace_id: workspace?.id ?? null, feature }` |
| workspace_link | `workspace_id`, `feature_id` (string or null) | `{ workspace }` | `{ workspace_id, feature_id: workspace.feature_id }` |
| feature_stage | `id`, `stage` | `{ entity, previous_stage }` (entity as toStoredEntity in mcp.ts would give; you may return `entity.id` and `entity.metadata` only) | `{ id: entity.id, stage: <metadata.stage>, previous_stage }` |
| feature_pr | `id`, `url`, `state?` | `{ entity, stage_changed, from, to }` | `{ id: entity.id, stage: to, stage_changed }` |
| where | `view?`, `machine?`, `repo?`, `include_released?`, `include_done?`, `include_ended?` (booleans with boolishSchema) | the where object | the where object with every workspace (in features and in unassigned) reduced to `{ machine, connect_target, path, branch, risks, resume_session: { agent_kind, agent_session_id, status, cwd } \| null, latest_session: { agent_kind, agent_session_id, status } \| null }`, where latest_session is `sessions[0]` |

Service errors become tool errors through `toolFromService` (`toToolError`). Build compact objects with explicit keys only.

3. In `mcp.ts`: add `workspaceDormantAfterDays?: number | undefined` to the options of `createSessionServer` and `registerMcpRoutes`, and call `registerWorkspaceTools(server, pool, auth, { dormantAfterDays: options.workspaceDormantAfterDays ?? 30 })` in `createSessionServer` after the existing tools.

Write the slice test `tests/contract/mcp-workspace-tools.test.ts` (direct imports are fine). In the slice test start the real app with `createApp({ pool })` from src/index.js (no dormancy option yet, so 30 is used) and an MCP client, as tests/contract/mcp-tools.test.ts does. You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/where-service.feature.test.ts`, `tests/contract/workspace-api.feature.test.ts`, `tests/contract/workspace-mcp.feature.test.ts`, `changes/004-where-api/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/mcp.md`, `changes/004-where-api/proposal.md`, `src/transport/mcp.ts`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| listTools | contains the six new tools and every existing tool | mcp-workspace-tools | where-m1 |
| workspace_report compact and with full_response | exactly the six compact keys; the full report object | mcp-workspace-tools | where-m1 |
| workspace_link by short id, then null; workspace_lookup in a subdirectory and with no match | compact ids; feature summary; both null | mcp-workspace-tools | where-m1 |
| feature_stage and feature_pr compact; invalid stage | the compact shapes; a tool error with code VALIDATION | mcp-workspace-tools | where-m1 |
| where compact and full | compact workspaces with exactly the D13 keys; full workspaces with sessions and git; dormant_after_days 30 | mcp-where-compact | where-m1 |
| Read-only key calls workspace_report | tool error FORBIDDEN | mcp-workspace-tools | where-m1 |
| An existing tool (store, task_create) after the helper move | same output as before | mcp-workspace-tools | where-m1 |

The check `where-m1` runs `node changes/004-where-api/slice-check.mjs src/transport/mcp-results.ts src/transport/mcp-workspace-tools.ts src/transport/mcp.ts tests/contract/mcp-workspace-tools.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Call run_checks before you finish and fix every ESLint and tsc error it reports. Integration and contract tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "where-m1-tests",
      "requirementIds": [
        "mcp-workspace-tools",
        "mcp-where-compact"
      ],
      "question": "Do the tests cover the tool list, every tool in compact and full form, the exact compact keys including the where workspace reduction, error mapping for validation and scope, and that an existing tool still works after the helper move?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/mcp.md",
        "changes/004-where-api/proposal.md",
        "src/transport/mcp.ts"
      ],
      "testPaths": [
        "tests/contract/mcp-workspace-tools.test.ts"
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
    "id": "mcp-workspace-tools",
    "text": "The MCP tools workspace_report, workspace_lookup, workspace_link, feature_stage, feature_pr and where call the same services as REST, return the compact outputs of mcp.md by default and the full REST-shaped payload with full_response, and return service errors as tool errors."
  },
  {
    "spec": "specs/workspace-tracking.md",
    "baseSha256": null,
    "operation": "add",
    "id": "mcp-where-compact",
    "text": "In compact where output each workspace is machine, connect_target, path, branch, risks, resume_session (agent_kind, agent_session_id, status, cwd) or null, and latest_session (agent_kind, agent_session_id, status) or null."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
