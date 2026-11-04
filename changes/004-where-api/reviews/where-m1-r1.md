# Review: where-m1, run worker-2026-11-01T14-22-38-058Z-1b10bcef

Verdict: revision (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy, SLICE_CHECK_REQUIRE_DOCKER=1)

- Vitest: tests/contract/mcp-workspace-tools.test.ts 7 passed. ESLint: no
  problems. tsc: no errors outside the protected feature tests.
- Regression: tests/contract/mcp-tools.test.ts 17 passed, 1 failed ("lists all
  expected tools", line 205). That test asserts the exact sorted tool list, and
  the six new tools are now registered. The other 17 existing tool tests pass
  after the helper move.
- Protected feature test tests/contract/workspace-mcp.feature.test.ts: 4 passed,
  1 failed (dormant_after_days 30 instead of 9). This is expected until where-w1
  passes workspaceDormantAfterDays from createApp. Not an m1 defect.
- Scope: the 4 planned paths, no extra paths, no violations.

## Review

- D11: the six helpers moved unchanged to mcp-results.ts. mcp.ts imports them
  and no existing tool changed.
- The tools, descriptions, inputs and compact payloads match mcp.md and the
  brief. The compact where workspaces have exactly the D13 keys, and
  latest_session is sessions[0]. full_response returns the full payload, and no
  toon parameter is added (D10).
- createSessionServer and registerMcpRoutes accept workspaceDormantAfterDays,
  with a default of 30.

## Required repair

The brief did not mention that `tests/contract/mcp-tools.test.ts` checks the exact
tool list. That is a controller omission. In that file, in the test "lists all
expected tools" (around line 205), add the six new tool names to the expected
array so that it stays sorted: `feature_pr`, `feature_stage`, `where`,
`workspace_link`, `workspace_lookup`, `workspace_report`. Change nothing else
in that file and nothing in src/.
