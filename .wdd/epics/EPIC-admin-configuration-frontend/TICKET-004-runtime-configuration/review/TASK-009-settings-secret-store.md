---
id: TASK-009-settings-secret-store
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-004-runtime-configuration
wave: WAVE-004
slug: settings-secret-store
title: Settings And Secret Store
status: review
depends_on:
  - TASK-003-runtime-config-feasibility
  - TASK-005-admin-session-routes
conflict_domains:
  - src/db/migrations/**
  - src/config.ts
  - src/services/**
  - tests/helpers/**
  - tests/integration/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-009-settings-secret-store
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-009-settings-secret-store
worktree_status: clean_pushed
pr: https://github.com/ivo-toby/postgram/pull/81
worker_thread_id: 019f3333-4104-7b02-b1aa-1fce6978e410
review_thread_id: 019f322c-02e7-7590-8b8e-ebdd1e9c52ac
current_gate: review_feedback_fixed
branch_freshness: current_after_epic_merge
verification:
  - npm test -- tests/integration/admin-settings-service.test.ts
  - npm run typecheck
  - git diff --check
  - npx eslint src/services/admin-settings-service.ts src/config.ts tests/integration/admin-settings-service.test.ts tests/unit/config.test.ts tests/helpers/postgres.ts
  - npm test -- tests/unit/config.test.ts
  - npm test -- tests/integration/migration.test.ts
  - npm test -- tests/integration/admin-auth-service.test.ts
---

# TASK-009-settings-secret-store: Settings And Secret Store

## Status

review

## Parent Ticket

TICKET-004-runtime-configuration

## Wave

WAVE-004

## Objective

Add persistence and services for runtime settings and stored secrets according
to the Wave 1 feasibility decision.

## Scope

- Included:
  - Runtime settings tables.
  - Secret storage or secret metadata tables.
  - Service APIs for read, write, redacted read, validation metadata, and audit
    hooks.
  - Test helper updates and integration tests.
- Excluded:
  - Provider connection tests and apply/reload behavior.
  - UI.

## Non-Scope

- Do not expose stored secret values through read APIs.

## Relevant Context

### Local Context

- `src/config.ts`
- `src/db/migrations/*`
- `tests/helpers/postgres.ts`
- `tests/unit/config.test.ts`

### Shared Context References

- `../../shared-context/resources/migration-config-notes.md`
- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `src/services/admin-settings-service.ts`
- `src/db/migrations/*admin_settings*.sql`
- `tests/integration/admin-settings-service.test.ts`
- `tests/helpers/postgres.ts`

## Dependencies

- TASK-003-runtime-config-feasibility
- TASK-005-admin-session-routes

## Conflict Domains

- `src/db/migrations/**`
- `src/config.ts`
- `src/services/**`
- `tests/helpers/**`
- `tests/integration/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-009-settings-secret-store

## Worker Worktree

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-009-settings-secret-store

Assigned by WAVE-004 activation. The controller must create and verify this
isolated worktree before dispatch.

Verified and dispatched at 2026-07-05T16:47:34Z with worker Euclid
(`019f3333-4104-7b02-b1aa-1fce6978e410`) on branch
`codex/task/TASK-009-settings-secret-store`.

## PR / Patch Reference

Draft PR #81: https://github.com/ivo-toby/postgram/pull/81

Review requested from Lorentz (`019f322c-02e7-7590-8b8e-ebdd1e9c52ac`) at
2026-07-05T17:32:34Z with submission
`019f3357-e7f4-7dd1-a1cf-afa9616d4a26`.

Lorentz returned `REVIEW_BLOCKED` with one P2 metadata-redaction finding and
one P2 branch-freshness finding. Both are fixed on this branch.

## RED-GREEN TDD Plan

### RED

Add tests for saving settings, redacted reads, secret write-only behavior,
validation errors, and audit metadata.

### GREEN

Implement migrations and settings service.

### REFACTOR

Keep generic setting storage separate from provider-specific validation.

## Implementation Notes

- Follow the selected secret key-management strategy from TASK-003.
- Update Docker/docs only if a new required runtime config value is introduced.
- This task should build persistence/service APIs, not a separate admin auth
  layer. Any HTTP exposure must use the WAVE-003 `/admin/api/*` session/CSRF
  boundary and, for secret writes or reads of sensitive metadata, the TASK-006
  active-MFA/step-up guard.
- Service read APIs may return safe metadata such as `configured`, validation
  state, timestamps, and provider identity, but must never return plaintext
  secrets, token hashes, ciphertext, or reusable prefixes.
- Tests should include a handoff assertion or service contract note that
  ordinary API-key bearer auth and MCP OAuth bearer auth are not accepted as
  admin authority for settings/secrets routes when those routes are added.

## Durable Memory Notes To Consider

- Record durable memory if the secret storage strategy becomes final.

## Task-Level Definition of Done

- [x] Settings persistence exists.
- [x] Secret readback is redacted.
- [x] Tests cover validation and reset helpers.
- [x] New config values are documented if added.

## Validation Steps

- `npm test -- tests/integration/admin-settings-service.test.ts`
- `npm run typecheck`

## Verification Evidence

- RED: `npm test -- tests/integration/admin-settings-service.test.ts` failed
  before implementation because `admin-settings-service` did not exist.
- RED: `npm test -- tests/unit/config.test.ts` failed before config support
  because `ADMIN_SETTINGS_ENCRYPTION_KEY` was not parsed.
- RED: review-driven regression proved `saveRuntimeSetting` accepted
  `OPENAI_API_KEY` as plaintext settings JSON before the secret-key guard.
- GREEN: `npm test -- tests/integration/admin-settings-service.test.ts`
  passed: 1 test file, 7 tests.
- GREEN: `npm test -- tests/unit/config.test.ts` passed: 1 test file,
  23 tests.
- Adjacent: `npm test -- tests/integration/migration.test.ts` passed:
  1 test file, 2 tests.
- Adjacent: `npm test -- tests/integration/admin-auth-service.test.ts`
  passed: 1 test file, 11 tests.
- Static: `npm run typecheck` passed.
- Static: `npx eslint src/services/admin-settings-service.ts src/config.ts
  tests/integration/admin-settings-service.test.ts tests/unit/config.test.ts
  tests/helpers/postgres.ts` passed.
- Static: `git diff --check` passed.
- Review: `codex review --uncommitted` first found one P1 about
  credential-shaped keys bypassing the encrypted secret store through generic
  settings persistence. Fixed before push.
- Review: second `codex review --uncommitted` returned no blocking issues.
- RED: Lorentz P2 regression `npm test --
  tests/integration/admin-settings-service.test.ts` failed when malicious
  secret validation metadata containing an authorization header, plaintext
  token, and reusable token prefix was returned through redacted metadata.
- GREEN: `npm test -- tests/integration/admin-settings-service.test.ts`
  passed after secret validation metadata was normalized to `{}` on save and
  redacted to `{}` on read.
- Static: `npm run typecheck` passed after the P2 fix.
- Static: `git diff --check` passed after the P2 fix.
- Branch freshness: merged `origin/codex/epic/admin-configuration-frontend`
  into `codex/task/TASK-009-settings-secret-store`; conflict was limited to
  this WDD task file and preserved PR/review/fix evidence.
- Final merged-tree verification:
  - `npm test -- tests/integration/admin-settings-service.test.ts` passed:
    1 test file, 8 tests.
  - `npm run typecheck` passed.
  - `git diff --check && git diff --cached --check` passed.
  - `npx eslint src/services/admin-settings-service.ts
    tests/integration/admin-settings-service.test.ts` passed.

## Review Feedback

### P1

- Resolved before push: reject credential-shaped keys such as
  `OPENAI_API_KEY` in plain runtime setting save/read/validation paths so
  provider secrets cannot bypass encrypted write-only storage.

### P2

- Resolved Lorentz `REVIEW_BLOCKED` finding: secret validation metadata no
  longer persists or returns arbitrary caller-provided JSON. `saveRuntimeSecret`
  normalizes secret validation metadata to `{}`, and secret metadata read/list
  paths defensively map validation metadata to `{}`.
- Resolved Lorentz branch-freshness finding: merged latest
  `origin/codex/epic/admin-configuration-frontend` into the task branch and
  resolved the WDD task-file-only conflict while preserving PR #81 evidence.

### P3

- None.

## Completion Notes

- Added migration `011_admin_settings.sql` with `admin_runtime_settings`,
  `admin_runtime_secrets`, and `audit_log.admin_user_id`.
- Added `admin-settings-service` APIs for settings persistence, validation
  metadata updates, encrypted provider-secret writes, and redacted secret
  metadata reads/lists.
- Implemented AES-256-GCM secret encryption with one external installation
  key, provided as `ADMIN_SETTINGS_ENCRYPTION_KEY`.
- Plain runtime settings reject credential-shaped keys such as `_API_KEY`,
  `_TOKEN`, `_PASSWORD`, `_SECRET`, and `_PRIVATE_KEY`, plus
  `DATABASE_URL` and `ADMIN_SETTINGS_ENCRYPTION_KEY`.
- Added the future HTTP authority contract assertion for `/admin/api/*`
  session/CSRF semantics and TASK-006 step-up for secret writes; no HTTP
  routes are exposed by this task.
- Updated `.env.example`, `docker-compose.yml`, and `README.md` for
  `ADMIN_SETTINGS_ENCRYPTION_KEY`.
- Updated the shared Postgres test reset helper for settings and secrets
  tables.
- Shared-context update needed: none. TASK-010 can consume this service for
  provider validation/apply behavior.
- WAVE-004 activation started at 2026-07-05T16:47:34Z as the
  settings/secret-store hybrid bundle. Branch/worktree creation is pending the
  pushed activation artifact commit.
- Controller verified the worktree and dispatched worker Euclid
  (`019f3333-4104-7b02-b1aa-1fce6978e410`). No PR or patch exists yet.
- 2026-07-05T17:12:04Z controller heartbeat observed active uncommitted work
  in `.env.example`, `README.md`, `docker-compose.yml`, `src/config.ts`,
  `src/db/migrations/011_admin_settings.sql`,
  `src/services/admin-settings-service.ts`, `tests/helpers/postgres.ts`,
  `tests/unit/config.test.ts`, and
  `tests/integration/admin-settings-service.test.ts`. No PR or patch exists
  yet; branch remains current with the epic branch at `f9bbc0f`.
- 2026-07-05T17:32:34Z controller heartbeat observed Euclid `DONE`, draft PR
  #81 open at `b96ca9d5b0ff3445aa8a8231451998f86ce23e5c`, and the worktree
  clean/pushed. GitHub reports `mergeStateStatus=DIRTY`; the branch is one
  epic controller commit behind (`rev-list origin/codex/epic/admin-configuration-frontend...HEAD`
  = `1 2`) and needs a branch-freshness refresh after review and before merge.
  The worker branch moved its task copy to `review/`; this epic-side task copy
  records the review gate while the PR is open. Lorentz review is in progress.
- After controller checkpoint `0eb4472` was pushed, GitHub reports PR #81
  `mergeStateStatus=UNKNOWN` and the task branch is behind the epic branch
  (`rev-list origin/codex/epic/admin-configuration-frontend...HEAD` = `2 2`).
  Refresh against the latest epic branch and rerun freshness verification
  before merge.
- 2026-07-05T17:51Z worker fixed Lorentz P2 metadata feedback with RED/GREEN
  coverage. Secret validation metadata is now empty for storage and redacted
  reads/lists, including malicious authorization/token-prefix metadata.
- 2026-07-05T17:52Z worker merged latest
  `origin/codex/epic/admin-configuration-frontend`; only this WDD task file
  conflicted, and the resolution preserved controller review notes plus worker
  implementation/fix evidence.
- 2026-07-05T17:54Z worker reran required verification on the merged tree.
- Final gate: draft PR #81 ready for follow-up review.
