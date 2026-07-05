---
id: TASK-004-admin-auth-persistence
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-002-admin-auth-foundation
wave: WAVE-002
slug: admin-auth-persistence
title: Admin Auth Persistence
status: in-progress
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
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-004-admin-auth-persistence
worktree_status: pending_creation
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: worktree_pending
branch_freshness: pending
verification:
  - npm test -- tests/integration/admin-auth-service.test.ts
  - npm run typecheck
---

# TASK-004-admin-auth-persistence: Admin Auth Persistence

## Status

in-progress

## Parent Ticket

TICKET-002-admin-auth-foundation

## Wave

WAVE-002

## Objective

Add admin identity/session/MFA/bootstrap-token persistence and core service
tests without registering browser routes yet.

## Scope

- Included:
  - Admin user, session, MFA factor, and login attempt or lockout tables.
  - Bootstrap token persistence/service contract: hash-only storage, expiry,
    single-use consumption, invalidation after use, and persistence-backed
    attempt/rate-limit metadata if used by the route layer.
  - Atomic first-admin setup persistence contract: consume the bootstrap token
    and create the first admin in a non-active/pending-MFA setup state in one
    transaction.
  - Admin auth service functions for creating admin users, password hashing,
    password verification, session creation, session lookup, and invalidation.
  - Test helper reset updates.
  - Integration tests for persistence, password policy, bootstrap token
    lifecycle, and pending first-admin activation state.
- Excluded:
  - HTTP routes.
  - UI.
  - OIDC login.
  - TOTP verification or MFA route behavior; TASK-006 completes MFA and active
    first-admin transition.

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

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-004-admin-auth-persistence

Assigned by WAVE-002 activation. The controller must create this isolated
worktree from the synced epic branch before worker dispatch.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add failing service tests for admin creation, password policy, hash storage,
session creation/lookup, session expiry, logout/invalidation, bootstrap token
hash/expiry/single-use behavior, and atomic first-admin creation in a
pending-MFA/non-active state.

### GREEN

Add migrations and admin auth service implementation with Argon2id password
hashing and typed service results.

### REFACTOR

Keep service APIs independent from HTTP and UI concerns.

## Implementation Notes

- Follow existing `neverthrow` service style where practical.
- Avoid storing plaintext secrets or MFA seeds in logs or returned payloads.
- Store only bootstrap token hashes; never return a stored plaintext bootstrap
  token from service reads.
- Use a transaction/row lock or equivalent atomic guard so two concurrent
  first-admin attempts cannot both consume the bootstrap token or activate two
  initial admins.
- Persist enough state for TASK-006 to prove the first admin cannot become
  active until MFA enrollment/verification completes.
- Update test reset order for new tables.

## Durable Memory Notes To Consider

- Record stable table/auth architecture decisions if they affect future agents.

## Task-Level Definition of Done

- [ ] Migrations are present and covered.
- [ ] Admin service tests pass.
- [ ] Password hashes and session tokens are not stored plaintext.
- [ ] Bootstrap tokens are stored hash-only, expire, and are single-use.
- [ ] First-admin creation is atomic and leaves the admin non-active/pending
      MFA until TASK-006 completes the MFA transition.
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
