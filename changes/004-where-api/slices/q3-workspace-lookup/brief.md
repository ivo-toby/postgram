# Slice brief: where-q3

Status: draft

## Outcome and boundaries

Create `src/services/workspace-lookup.ts` exporting exactly:

```ts
export type LookupFeature = { id: string; title: string; stage: FeatureStage; pull_requests: FeaturePullRequest[] };
export type LookupResult = { workspace: WorkspaceView | null; feature: LookupFeature | null };

export function lookupWorkspace(
  pool: Pool,
  auth: AuthContext,
  input: { machine: string; path: string },
  options: WorkspaceViewOptions
): ServiceResult<LookupResult>;
```

1. `requireScope(auth, 'read')` first. An empty `machine` or a `path` that does not start with `/` is VALIDATION.
2. Strip trailing slashes with `normalizeWorkspacePath`.
3. Find candidate ids on that machine: `w.path = $path OR starts_with($path, w.path || '/') OR w.path = '/'` (`starts_with` avoids LIKE wildcards in paths).
4. Load them with `loadWorkspaceViews(pool, auth, { workspaceIds }, { now, dormantAfterDays })`, which drops the invisible ones, and pick the one with the longest `path` (D8). No candidate left: return `{ workspace: null, feature: null }`. An unknown machine is the same, never an error.
5. When the chosen workspace has a `feature_id`, read `id, content, status, metadata` of that entity, map it with `toWhereFeature` and return `{ id, title, stage, pull_requests }`. Otherwise `feature: null`.

Write the slice test `tests/integration/workspace-lookup.test.ts` (direct imports are fine). You may create or modify other ordinary project files when the implementation needs them; the listed paths are expected outputs, not a hard limit. Do not delete files, and do not edit `tests/integration/where-service.feature.test.ts`, `tests/contract/workspace-api.feature.test.ts`, `tests/contract/workspace-mcp.feature.test.ts`, `changes/004-where-api/slice-check.mjs`, `specs/constitution.md`, `specs/constitution.approval.json`, anything else under `changes/` or `.tinysdd/`.

## Sources and interfaces

The compiled context holds the constitution and the exact excerpts for this slice. Interfaces: `specs/004-workspace-session-tracking/contracts/rest.md`, `specs/004-workspace-session-tracking/spec.md`, `changes/004-where-api/proposal.md`.

## Acceptance and checks

| Situation | Expected result and preserved state | Requirement | Exact check |
| --- | --- | --- | --- |
| Path equal to a workspace, with a trailing slash, or inside it (subdirectory) | that workspace and its feature summary | workspace-lookup | where-q3 |
| Nested workspaces /a and /a/sub, lookup /a/sub/x; and /a/sub invisible to the caller | the inner one; the outer one when the inner one is invisible | workspace-lookup | where-q3 |
| Path /a/bc next to workspace /a/b; unknown machine | workspace null and feature null | workspace-lookup | where-q3 |
| Linked plain task; linked feature with stage review and a PR | stage building with pull_requests []; stage review with the PR | workspace-lookup | where-q3 |
| Relative path, empty machine, key without read scope | VALIDATION, VALIDATION, FORBIDDEN | workspace-lookup | where-q3 |

The check `where-q3` runs `node changes/004-where-api/slice-check.mjs src/services/workspace-lookup.ts tests/integration/workspace-lookup.test.ts`: Vitest on the slice test, ESLint with zero allowed problems on the listed files, and tsc on the whole project. Call run_checks before you finish and fix every ESLint and tsc error it reports. Integration and contract tests show as SKIPPED in your sandbox (no Docker); the controller runs them on the host.

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
      "id": "where-q3-tests",
      "requirementIds": [
        "workspace-lookup"
      ],
      "question": "Do the tests cover exact, trailing-slash and subdirectory matches, the slash boundary, longest and longest-visible matches, unknown machine, the feature summary for a plain task and a staged feature, and the rejections?",
      "interfaces": [
        "specs/004-workspace-session-tracking/contracts/rest.md",
        "specs/004-workspace-session-tracking/spec.md",
        "changes/004-where-api/proposal.md"
      ],
      "testPaths": [
        "tests/integration/workspace-lookup.test.ts"
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
    "id": "workspace-lookup",
    "text": "lookupWorkspace requires read scope, strips a trailing slash, rejects a relative path with VALIDATION, and returns the visible workspace on that machine whose path equals the given path or is its longest prefix ending at a slash boundary, with feature id, title, stage and pull_requests; no match or an unknown machine returns workspace null and feature null."
  }
]
```

Approval: pending normal task approval.

Evidence: none yet.
