# Review: where-q3, run worker-2026-11-01T13-59-15-298Z-62229c57

Verdict: accepted (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy, SLICE_CHECK_REQUIRE_DOCKER=1)

- Vitest: tests/integration/workspace-lookup.test.ts 6 passed. ESLint: no
  problems. tsc: no errors outside the protected feature tests.
- Scope: the 2 planned paths created, no extra paths, no violations.

## Review

- Read scope first. An empty machine or a relative path is VALIDATION.
  normalizeWorkspacePath strips trailing slashes.
- The candidate query uses starts_with at a slash boundary (and the root path),
  with no LIKE. loadWorkspaceViews with workspaceIds drops invisible
  workspaces, and lookup then picks the longest path, so an invisible inner
  workspace never hides a visible outer one (D8).
- The feature summary comes from toWhereFeature. A plain task shows as
  building (D2). An unknown machine or no match gives both fields null.
- The tests cover every acceptance row of the brief.
