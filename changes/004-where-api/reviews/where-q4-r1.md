# Review: where-q4, run worker-2026-11-01T14-04-32-510Z-07c6af2e

Verdict: accepted (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy, SLICE_CHECK_REQUIRE_DOCKER=1)

- Vitest: tests/integration/workspace-update.test.ts 5 passed. ESLint: no
  problems. tsc: no errors outside the protected feature tests.
- Scope: the 2 planned paths created, no extra paths, no violations.

## Review

- Every validation and resolution step runs before the first write: scope,
  "no fields", a non-UUID or invisible id (NOT_FOUND), unlink without personal
  (FORBIDDEN, D9), and resolveFeatureId errors unchanged.
- D1: a plain task gets featureDefaults through updateEntity. On CONFLICT it
  is resolved again and retried once, and a task that is already a feature is
  not written.
- D6: workspace_link {from, to} is written only when the link changes. missing
  sets missing_since with COALESCE and clears it to NULL, with no audit row.
- The tests cover every acceptance row, including the version checks for
  "no entity write" and "nothing written" on rejection.
- Not tested, and not in the acceptance table: the CONFLICT retry path. The
  code matches the brief.
- The UUID check is case-sensitive (lowercase only), so an uppercase UUID gives
  NOT_FOUND. That is acceptable: ids are lowercase everywhere in the API.
