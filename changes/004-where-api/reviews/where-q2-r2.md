# Review: where-q2, run worker-2026-11-01T13-54-46-823Z-e6d4afde (revision of worker-2026-11-01T13-48-01-409Z-f4aa900e)

Verdict: accepted (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy, SLICE_CHECK_REQUIRE_DOCKER=1)

- Vitest: tests/integration/workspace-query.test.ts 5 passed. ESLint: no
  problems. tsc: no errors outside the protected feature tests.
- Scope: the 2 planned paths modified, no extra paths, no violations.

## Review

- Repair 1: the whole visibility condition is now in one pair of parentheses,
  so every filter applies to both the linked and the unlinked branch. The filter
  test (machine, repo, short feature id, unassigned) now passes.
- Repair 2: the test sets explicit `last_activity_at` values, so the expected
  order `[linkedPersonal, unlinked]` follows from the data.
- Everything else matches the brief: one workspace query that joins machines
  and entities (left join), one sessions query with the same columns and order
  as loadWorkspaceSessions, skipped when there are no rows. `listWorkspaces`
  checks the read scope first, normalizes the repo, resolves the feature id and
  rejects featureId together with unassigned. `now` is read once.
