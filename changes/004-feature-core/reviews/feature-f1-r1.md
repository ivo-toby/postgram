# Review: feature-f1, run worker-2026-10-31T20-11-46-974Z-c9d82596

Verdict: revision (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy, SLICE_CHECK_REQUIRE_DOCKER=1)

- Vitest: 57 passed, 1 failed. ESLint: 2 errors. tsc: no errors outside the protected feature test.
- Scope: 3 planned paths created, no extra paths, no violations.
- The implementation of deriveStage, compareStages, canonicalization, upsert and normalization matches the brief.
- run_checks was not in the worker's tool list (TinySDD issue #197), so the worker could not run the check. Not a worker error.

## Required repair

1. `tests/unit/feature-rules.test.ts` line 247, test "never returns a stage before current": the assertion is inverted. `compareStages(current, next) >= 0` fails for every forward move. Assert that `next` is not before `current`: `expect(compareStages(next, current)).toBeGreaterThanOrEqual(0)`.
2. `src/services/feature-rules.ts` lines 144 and 157: `String(result.stage)` and `String(result.stage_source)` on `unknown` values fail `@typescript-eslint/no-base-to-string`. Do not stringify the rejected value; use a fixed message such as `'invalid feature stage'` and keep the field name in details. Check the file for any other `String(...)` or template interpolation of an `unknown` value and fix it the same way.

Keep all other tests passing and change nothing else.
