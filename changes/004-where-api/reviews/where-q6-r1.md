# Review: where-q6, run worker-2026-11-01T14-14-29-260Z-f0fd857c

Verdict: revision (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy, SLICE_CHECK_REQUIRE_DOCKER=1)

- Vitest: tests/integration/where-service.test.ts 3 passed, 1 failed. ESLint: no
  problems. tsc: no errors outside the protected feature tests.
- The protected feature test tests/integration/where-service.feature.test.ts
  (C1-C5) passes 8 of 8 with this candidate.
- Scope: the 2 planned paths created, no extra paths, no violations.

## Review

The implementation matches the brief: read scope, the view check, one read of
now, loadWorkspaceViews with the normalized repo, feature tasks per step 3, and
buildWhereGroups with filtered set for machine or repo. No change needed there.

## Required repair (test only)

`tests/integration/where-service.test.ts`, test "groups stage and action views
with a plain task in building", line 174: the test expects the building group as
`[building, plain]`, but `plain`'s workspace is reported later, so it has the
newer `last_activity_at` and comes first. Features sort by newest workspace
DESC, which is correct. Set explicit activity times on the workspaces (UPDATE
workspaces SET last_activity_at = ... WHERE path = ...) so that the order you
assert follows from the data, or expect `[plain, building]`. Check the other
order assertions in this file for the same mistake.

Do not change src/services/where-service.ts.
