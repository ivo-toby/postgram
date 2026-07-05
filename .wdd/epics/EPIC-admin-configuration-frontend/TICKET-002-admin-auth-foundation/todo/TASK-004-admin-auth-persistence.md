---
id: TASK-004-admin-auth-persistence
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-002-admin-auth-foundation
wave: WAVE-002
slug: admin-auth-persistence
title: Admin Auth Persistence
status: todo
depends_on:
  - TASK-001-admin-surface-inventory
  - TASK-002-threat-model-bootstrap
conflict_domains:
  - src/db/migrations/**
  - src/auth/**
  - tests/helpers/**
  - tests/integration/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-004-admin-auth-persistence
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm test -- tests/integration/admin-auth-service.test.ts
  - npm run typecheck
---

# TASK-004-admin-auth-persistence: Admin Auth Persistence

## Status

todo

## Parent Ticket

TICKET-002-admin-auth-foundation

## Wave

WAVE-002

## Objective

Add admin identity/session/MFA persistence and core service tests without
registering browser routes yet.

## Scope

- Included:
  - Admin user, session, MFA factor, and login attempt or lockout tables.
  - Admin auth service functions for creating admin users, password hashing,
    password verification, session creation, session lookup, and invalidation.
  - Test helper reset updates.
  - Integration tests for persistence and password policy.
- Excluded:
  - HTTP routes.
  - UI.
  - OIDC login.

## Non-Scope

- Do not accept Postgram API keys as admin identities.

## Relevant Context

### Local Context

- `src/db/migrations/001_initial_schema.sql`
- `src/auth/key-service.ts`
- `tests/helpers/postgres.ts`
- `tests/integration/key-service.test.ts`

### Shared Context References

- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/migration-config-notes.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `src/db/migrations/*admin*.sql`
- `src/auth/admin-service.ts`
- `tests/integration/admin-auth-service.test.ts`
- `tests/helpers/postgres.ts`

## Dependencies

- TASK-001-admin-surface-inventory
- TASK-002-threat-model-bootstrap

## Conflict Domains

- `src/db/migrations/**`
- `src/auth/**`
- `tests/helpers/**`
- `tests/integration/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-004-admin-auth-persistence

## Worker Worktree

None assigned yet.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add failing service tests for admin creation, password policy, hash storage,
session creation/lookup, session expiry, and logout/invalidation.

### GREEN

Add migrations and admin auth service implementation with Argon2id password
hashing and typed service results.

### REFACTOR

Keep service APIs independent from HTTP and UI concerns.

## Implementation Notes

- Follow existing `neverthrow` service style where practical.
- Avoid storing plaintext secrets or MFA seeds in logs or returned payloads.
- Update test reset order for new tables.

## Durable Memory Notes To Consider

- Record stable table/auth architecture decisions if they affect future agents.

## Task-Level Definition of Done

- [ ] Migrations are present and covered.
- [ ] Admin service tests pass.
- [ ] Password hashes and session tokens are not stored plaintext.
- [ ] API-key auth remains unchanged.

## Validation Steps

- `npm test -- tests/integration/admin-auth-service.test.ts`
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
