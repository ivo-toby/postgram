---
id: TASK-009-settings-secret-store
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-004-runtime-configuration
wave: WAVE-004
slug: settings-secret-store
title: Settings And Secret Store
status: in_progress
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
worktree_status: active_uncommitted
pr: null
worker_thread_id: 019f3333-4104-7b02-b1aa-1fce6978e410
review_thread_id: null
current_gate: no_pr
branch_freshness: current_at_dispatch
verification:
  - npm test -- tests/integration/admin-settings-service.test.ts
  - npm run typecheck
---

# TASK-009-settings-secret-store: Settings And Secret Store

## Status

in_progress

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

None yet.

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

- [ ] Settings persistence exists.
- [ ] Secret readback is redacted.
- [ ] Tests cover validation and reset helpers.
- [ ] New config values are documented if added.

## Validation Steps

- `npm test -- tests/integration/admin-settings-service.test.ts`
- `npm run typecheck`

## Verification Evidence

- Not run yet.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

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
