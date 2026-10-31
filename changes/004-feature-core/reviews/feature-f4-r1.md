# Review: feature-f4, run worker-2026-10-31T20-56-26-852Z-b801c659

Verdict: accepted (self-review by the controller agent, delegated by ivo).

## Observed on the host (disposable copy, SLICE_CHECK_REQUIRE_DOCKER=1)

- `node changes/004-feature-core/slice-check.mjs src/services/feature-service.ts tests/integration/feature-stage.test.ts`: exit 0; Vitest 6 passed; ESLint 0 problems; tsc no errors outside the protected feature test.
- setFeatureStage checks scope, validates the stage, resolves either id form, applies defaults to a plain task (`previous_stage: null`), writes through updateEntity with one CONFLICT retry, and appends `feature_stage {from, to, source: 'manual'}` only when the stage changes. Status is never touched.
- Tests cover promotion by short id, backwards moves, status unchanged at released, rejection without writes, the conflict retry and one audit row per change.

## Review notes

- Extra path `.tinysdd-worker-attempt.txt` (worker scratch note, the worker has no delete tool). Excluded on apply.
- 1.3M tokens and 27 minutes; run_checks was still missing from the tool list (TinySDD #197).
