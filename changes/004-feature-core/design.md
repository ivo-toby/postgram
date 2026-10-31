# Design: 004 phase 2, feature core

## Shape

- `src/types/features.ts`: stage and PR types, result types.
- `src/services/feature-rules.ts`: pure rules (stage order, derivation, PR
  canonicalization and upsert, metadata normalization, defaults). No database
  and no clock; `now` is passed in.
- `src/services/task-service.ts`: `createTask`/`updateTask` call
  `normalizeFeatureMetadata`. This is the existing entrypoint that REST
  `/api/tasks` and MCP `task_create`/`task_update` already use, so the
  normalization is wired for both transports in this change.
- `src/services/feature-service.ts`: `resolveFeatureId`, `createFeature`,
  `setRepositoryReleaseOnMerge`, `setFeatureStage`, `addFeaturePullRequest`.
  REST and MCP adapters follow in phase 3.

## Writes

Feature writes use `updateEntity` with the full metadata object, so the
version bump, the `update` audit row and the "no re-embed without a content
change" rule stay where they are. A private helper does read → compute →
write and retries once on `CONFLICT` (data-model "Writes"). Feature audit rows
(`feature_stage`, `feature_pr`) are appended after a successful write.
`repository_update` is written by the repository upsert.

The report transaction is unchanged: it never writes `entities` (decision D1).

## Slices

| Slice | Files | Test | Depends on |
| --- | --- | --- | --- |
| feature-f1 | types/features.ts, services/feature-rules.ts | unit | none |
| feature-f2 | services/task-service.ts | integration | f1 |
| feature-f3 | services/feature-service.ts (lookup, create, repository) | integration | f1 |
| feature-f4 | services/feature-service.ts (stage) | integration | f3 |
| feature-f5 | services/feature-service.ts (pull requests) | integration | f4 |

f1 is pure, so the worker can run its whole check in the sandbox. For f2–f5
the worker runs ESLint and tsc itself; the integration tests run on the host.

## Checks

`changes/004-feature-core/slice-check.mjs` runs Vitest, ESLint and `tsc
--noEmit` for the project, ignoring tsc errors inside the protected feature
test. Without Docker it skips integration tests with a visible notice; the
controller runs it with `SLICE_CHECK_REQUIRE_DOCKER=1`, which makes a skip a
failure. Lessons from phase 1 (`.js` imports, zod and
`exactOptionalPropertyTypes`, union narrowing, typed pg rows) are stated in
every context.
