# Design: 004 phase 1, workspace report core

Status: draft

## Research inputs

- Proposal: `changes/004-report-core/proposal.md` (sha256 `3ed4d940…`)
- Research record: `phase-1b2bf88e-6f4a-4185-8c33-3308eb77ea3a` (human, by ivo)
- Compiled excerpts: `changes/004-report-core/research.context.json`
  (manifest `c2350d25…`, compiled `ae77c84a…`, 49 074 bytes)
- Unresolved facts: none.

Requirement IDs in the deltas are the proposal IDs without the `R-` prefix
(`R-reboot-rule` → `reboot-rule`).

## Interfaces and real callers

| Interface or caller | Source excerpt | Responsibility | Consumer slice |
| --- | --- | --- | --- |
| `src/db/migrate.ts` | research 1-60 | applies `018_workspace_tracking.sql` | report-s1 |
| `src/util/audit.ts` | research 1-31 | audit rows inside the report transaction | report-s1, report-s7 |
| `tests/helpers/postgres.ts` | research 1-148 | truncates the new tables between tests | report-s1 |
| `src/auth/key-service.ts` | research 113-120 | `requireScope` | report-s7 |
| `src/config.ts` | research 1-12, 42-45 | `WORKSPACE_DORMANT_AFTER_DAYS` | report-s8 |

## Implementation design

New modules and their contracts. Every SQL helper takes a `PoolClient` so the
orchestrator owns the single transaction.

- `src/types/workspaces.ts` (s1): string unions `AgentKind`, `SessionStatus`,
  `SessionEvent`, `ReportSource`, `Risk`, `ReportWarning`; row types
  `MachineRow`, `WorkspaceRow`, `AgentSessionRow` (snake_case columns, `Date`
  for timestamptz); view types `GitSnapshot`, `SessionView`,
  `ResumeSessionView`, `WorkspaceView`, `ReportResult` with the exact rest.md
  keys.
- `src/db/migrations/018_workspace_tracking.sql` (s1): data-model tables,
  checks, unique and partial unique indexes, FK `feature_id` → `entities`
  ON DELETE SET NULL, `workspace_id` ON DELETE CASCADE.
- `src/util/audit.ts` (s1): parameter type `Pool | PoolClient`; body unchanged.
- `src/util/git-remote.ts` (s2): `normalizeRemote(remote: string): string`.
  Rest.md vectors; an input that does not parse as host + path is returned
  trimmed, lowercased and without a trailing `.git` or `/` (D7, new).
- `src/services/workspace-view.ts` (s3): pure `computeRisks`,
  `selectResumeSession`, `isDormant`, `selectVisibleSessions`,
  `toWorkspaceView`.
- `src/services/workspace-report-schema.ts` (s4):
  `parseReportInput(raw: unknown): Result<ReportInput, AppError>` (neverthrow
  sync `Result`), zod schema with the rest.md table and session-form rules;
  strips a trailing `/`; `feature_id: null` becomes absent; omitted keys stay
  `undefined`, so later steps can tell omitted from `null`; `repo_remote` is
  passed through `normalizeRemote`.
- `src/services/workspace-store.ts` (s5): `upsertMachine`, `upsertWorkspace`,
  `resolveFeatureLink`, `loadWorkspaceView` rows.
- `src/services/session-store.ts` (s6): `findTargetSession`,
  `interruptRebootedSessions`, `applyHookSession`, `applyScanSessions`.
- `src/services/workspace-service.ts` (s7): `reportWorkspace(pool, auth,
  input: unknown, options: { dormantAfterDays: number }):
  ServiceResult<ReportResult>`. Validate, `requireScope(auth, 'write')`, then
  one transaction in report order (machine → target session lookup → reboot
  rule → workspace → link → sessions → audit → view). Audit operations per
  data-model step 6, written with `appendAuditEntry(client, …)`.
- Config (s8): `WORKSPACE_DORMANT_AFTER_DAYS` (default 30, int ≥ 1) in
  `src/config.ts`, `docker-compose.yml`, `.env.example`, README table.

Additional decision (D7, for operator review): unparseable remotes are kept in
a normalized fallback form instead of failing the report, so a local-path
remote still registers.

The response always returns the reported workspace, even when the caller
cannot see its linked feature; `feature` is then `null`. Visibility filtering
of lists is a phase 3 concern.

## Test responsibilities

- Feature test (strong-prepared, protected):
  `tests/integration/workspace-report.feature.test.ts`. It runs the real
  `runMigrations` through `createTestDatabase()` and calls `reportWorkspace`.
  It covers C1–C5, validation, scope, linking, the omitted-workspace form and
  the response object. Without migration 018 or without the service it fails.
- Slice tests (worker-written, direct imports): one per slice, listed below.
- Wiring: phase 1 has no transport caller. The migration runner is the wired
  entrypoint; REST/MCP wiring is a phase 3 integration obligation.

## Slice DAG and budgets

| Slice | Behavior | Implementation outputs | Writable slice tests | Depends on | Wiring |
| --- | --- | --- | --- | --- | --- |
| report-s1 | schema and types | migration 018, `src/types/workspaces.ts`, `src/util/audit.ts`, `tests/helpers/postgres.ts` | `tests/integration/workspace-migration.test.ts` | – | yes, migration runner |
| report-s2 | remote normalization | `src/util/git-remote.ts` | `tests/unit/git-remote.test.ts` | – | no |
| report-s3 | workspace view mapper | `src/services/workspace-view.ts` | `tests/unit/workspace-view.test.ts` | s1 | no |
| report-s4 | input validation and remote normalization of the input | `src/services/workspace-report-schema.ts` | `tests/unit/workspace-report-schema.test.ts` | s1, s2 | no |
| report-s5 | machine, workspace, link SQL | `src/services/workspace-store.ts` | `tests/integration/workspace-store.test.ts` | s1 | no |
| report-s6 | session SQL and reboot rule | `src/services/session-store.ts` | `tests/integration/session-store.test.ts` | s1 | no |
| report-s7 | report orchestrator | `src/services/workspace-service.ts` | `tests/integration/workspace-service.test.ts` | s3, s4, s5, s6 | no |
| report-s8 | dormancy config | `src/config.ts`, `docker-compose.yml`, `.env.example`, `README.md` | `tests/unit/config-workspace.test.ts` | – | no |

Change budget: `maxImplementationFiles` 4, `maxSliceTestFiles` 1,
`maxCompiledContextBytes` 65536.

## Integration obligations

- report-migration: requirements all phase 1 requirements; entrypoint
  `src/db/migrate.ts`; wiring slice report-s1; protected test
  `tests/integration/workspace-report.feature.test.ts`; feature check
  `feature-report`.

## Review and gate contract

- Every active task protects the feature test and the constitution pair.
- A candidate is reviewed by exact bytes, including ordinary extra tests.
- Checks run on the host (`run_checks` is unavailable on macOS, tiny-sdd#176);
  integration tests need Docker for testcontainers.
- `feature accept` is unavailable on macOS; slices are reviewed and applied
  one by one, and feature acceptance waits for a Linux host.

## Open decisions

- D7 (remote fallback) awaits operator review.
