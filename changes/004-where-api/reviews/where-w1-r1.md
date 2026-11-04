# Review: where-w1, run worker-2026-11-01T14-59-46-102Z-670179b3

Verdict: revision (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy, SLICE_CHECK_REQUIRE_DOCKER=1)

- Vitest: tests/contract/workspace-wiring.test.ts 3 passed, 1 failed ("registers
  the feature and workspace REST routes": expected 201, got 403 on POST
  /api/features). ESLint: no problems. tsc: no errors outside the protected
  feature tests.
- With this candidate, all three protected feature tests pass:
  where-service.feature 8/8, workspace-api.feature 6/6, workspace-mcp.feature 5/5.
- Scope: index.ts modified and the slice test created. No extra paths, no violations.

## Review

The index.ts change matches the brief exactly. It adds the AppOptions field,
registers both route files right after registerRestRoutes with
dormantAfterDays = option ?? 30, passes workspaceDormantAfterDays to
registerMcpRoutes, and makes main pass config.WORKSPACE_DORMANT_AFTER_DAYS. No
change is needed in src/.

## Required repair (test only)

In tests/contract/workspace-wiring.test.ts, `apiKey()` calls createKey without
`allowedTypes` and `allowedVisibility`, so the key does not allow creating a
`work` feature, and the route correctly answers 403. Create the key the same way
the feature tests do:
`{ name, clientId: name, scopes: ['read', 'write'], allowedTypes: null,
allowedVisibility: ['personal', 'work', 'shared'] }`. Change nothing else.
