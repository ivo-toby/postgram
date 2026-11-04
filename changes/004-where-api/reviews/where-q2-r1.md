# Review: where-q2, run worker-2026-11-01T13-48-01-409Z-f4aa900e

Verdict: revision (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy, SLICE_CHECK_REQUIRE_DOCKER=1)

- Vitest: tests/integration/workspace-query.test.ts 3 passed, 2 failed. ESLint: no
  problems. tsc: no errors outside the protected feature tests.
- Scope: the 2 planned paths created, no extra paths, no violations.
- The worker's own run_checks could not run Vitest (TinySDD #215, ENOTFOUND
  localhost), so it never saw these failures. Not a worker error.

## Required repair

1. `src/services/workspace-query.ts`, `loadWorkspaceRows`: the visibility clause
   is `(A) OR (B)` without outer parentheses, and the filters are joined with
   ` AND `. SQL binds AND tighter than OR, so the result is `(A) OR ((B) AND
   filters)`: an unlinked personal workspace ignores every filter. Observed:
   `listWorkspaces(..., { machine: 'codebox' })` returns 2 workspaces instead of 1
   (test line 198). Wrap the whole visibility condition in one pair of
   parentheses so that every filter applies to both branches.
2. `tests/integration/workspace-query.test.ts` line 168 (`noWork`): the expected
   order `[linkedPersonal, unlinked]` is wrong. `unlinked` is reported last, so it
   has the newest `last_activity_at` and comes first (sort is last_activity_at
   DESC). Either expect `[unlinked, linkedPersonal]`, or set explicit activity
   times with `setActivity` and assert the order those times give.

Keep all other tests passing and change nothing else.
