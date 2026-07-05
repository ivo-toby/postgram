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
worktree_status: verified
pr: https://github.com/ivo-toby/postgram/pull/81
worker_thread_id: 019f3333-4104-7b02-b1aa-1fce6978e410
review_thread_id: 019f334b-60fb-7712-8406-458f8ac26762
current_gate: review
branch_freshness: current_at_pr
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

Draft PR: https://github.com/ivo-toby/postgram/pull/81

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

## Review Feedback

### P1

- Resolved before push: reject credential-shaped keys such as
  `OPENAI_API_KEY` in plain runtime setting save/read/validation paths so
  provider secrets cannot bypass encrypted write-only storage.

### P2

- None.

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
- Final gate: draft PR #81 ready for review.
