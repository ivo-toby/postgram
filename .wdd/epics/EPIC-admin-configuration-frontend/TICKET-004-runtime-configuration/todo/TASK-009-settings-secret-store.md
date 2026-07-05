---
id: TASK-009-settings-secret-store
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-004-runtime-configuration
wave: WAVE-004
slug: settings-secret-store
title: Settings And Secret Store
status: todo
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
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm test -- tests/integration/admin-settings-service.test.ts
  - npm run typecheck
---

# TASK-009-settings-secret-store: Settings And Secret Store

## Status

todo

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

None assigned yet.

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

- None yet.
