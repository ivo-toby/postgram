# Review: where-q5, run worker-2026-11-01T14-11-05-156Z-49e682e8

Verdict: accepted (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy, SLICE_CHECK_REQUIRE_DOCKER=1)

- Vitest: tests/integration/machine-service.test.ts 5 passed. ESLint: no
  problems. tsc: no errors outside the protected feature tests.
- Scope: the 2 planned paths created, no extra paths, no violations.

## Review

- listMachines checks the read scope, sorts by alias and returns an ISO
  last_seen_at. setMachineConnectTarget checks the write scope and validates
  against the regex from the brief (null clears the value). It runs one UPDATE
  ... RETURNING, an unknown alias is NOT_FOUND, and it never inserts a machine
  or writes an audit row (D5).
- The tests cover every acceptance row, plus the 255-character boundary.
