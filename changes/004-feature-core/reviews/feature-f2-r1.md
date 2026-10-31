# Review: feature-f2, run worker-2026-10-31T20-23-55-108Z-5fe2e119

Verdict: accepted with one controller edit (self-review by the controller agent, delegated by ivo).

## Observed on the host (SLICE_CHECK_REQUIRE_DOCKER=1)

- `node changes/004-feature-core/slice-check.mjs src/services/task-service.ts tests/integration/task-feature-metadata.test.ts`: exit 0; Vitest 6 passed; ESLint 0 problems; tsc no errors outside the protected feature test.
- `tests/integration/task-service.test.ts` (existing): 6 passed.

## Controller edit

- `src/services/task-service.ts` updateTask: the access pre-check used `input.visibility ?? row.visibility`. D7 requires the stored row's visibility; otherwise a key without access to the row could get VALIDATION by passing a visibility it is allowed. Changed to `row.visibility`. Re-ran the slice check: exit 0.
  Done by the controller instead of a revision, because a revision run with this run's extra path hits TinySDD #198.

## Review notes

- createTask and updateTask keep their behaviour for non-feature metadata; updateTask without metadata, context or dueDate skips the read.
- Extra path `internal/evidence/.../checks.json`: written by the worker while run_checks was missing from its tool list (TinySDD #197). Not part of the change; excluded from the commit.
