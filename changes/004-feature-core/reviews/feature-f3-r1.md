# Review: feature-f3, run worker-2026-10-31T20-37-28-063Z-3c9d50d8

Verdict: revision (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy, SLICE_CHECK_REQUIRE_DOCKER=1)

- Vitest: 5 passed, 2 failed. ESLint: 3 errors. tsc: 1 error. All in `tests/integration/feature-service.test.ts`.
- `src/services/feature-service.ts` matches the brief.
- Extra paths `.tmp-listing-check` and `__run_checks_now.json`: written while run_checks was missing (TinySDD #197).
- The approval went stale after feature-f2 was applied (it changed cited lines in `src/services/task-service.ts`), so this run cannot be applied.

## Required repair

1. Test "creates a feature ...": two features are created earlier in the same test, so `SELECT count(*)` is 2, not 0. Assert that the rejected calls wrote nothing: expect `'2'`.
2. Test "reports CONFLICT with candidates ...": `(ambiguous._unsafeUnwrapErr() as { details: ... })` is TS2352. `_unsafeUnwrapErr()` already returns AppError; read `.details['candidates']` without a cast.
3. Same test: `await resolveFeatureId(...)._unsafeUnwrap()` calls `_unsafeUnwrap` on the ResultAsync. Write `(await resolveFeatureId(db().pool, auth(), 'abef1234'))._unsafeUnwrap()`.

Do not write files outside the two allowed paths. Keep all other tests passing and change nothing else.
