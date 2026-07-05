---
id: TASK-004-admin-auth-persistence
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-002-admin-auth-foundation
wave: WAVE-002
slug: admin-auth-persistence
title: Admin Auth Persistence
status: review
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
worktree_status: verified
pr: https://github.com/ivo-toby/postgram/pull/79
worker_thread_id: 019f329b-24ff-7ec3-93dd-d854e4681fd2
review_thread_id: null
current_gate: ready_for_review
branch_freshness: pushed_after_handoff
verification:
  - npm test -- tests/integration/admin-auth-service.test.ts
  - npm run typecheck
  - git diff --check
---

# TASK-004-admin-auth-persistence: Admin Auth Persistence

## Status

review

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

Assigned by WAVE-002 activation. The controller created and verified this
isolated worktree before dispatch.

## PR / Patch Reference

Draft PR: https://github.com/ivo-toby/postgram/pull/79

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

- [x] Migrations are present and covered.
- [x] Admin service tests pass.
- [x] Password hashes and session tokens are not stored plaintext.
- [x] Bootstrap tokens are stored hash-only, expire, and are single-use.
- [x] First-admin creation is atomic and leaves the admin non-active/pending
      MFA until TASK-006 completes the MFA transition.
- [x] API-key auth remains unchanged.

## Validation Steps

- `npm test -- tests/integration/admin-auth-service.test.ts`
- `npm run typecheck`

## Verification Evidence

- 2026-07-05: `npm test -- tests/integration/admin-auth-service.test.ts`
  passed, 11 tests.
- 2026-07-05: `npm run typecheck` passed.
- 2026-07-05: `git diff --check` passed.
- 2026-07-05: `npx eslint src/auth/admin-service.ts tests/integration/admin-auth-service.test.ts tests/helpers/postgres.ts`
  passed.
- 2026-07-05: `codex review --uncommitted` initially found two P2 issues
  after earlier P2 race fixes; both were fixed and the follow-up review found
  no actionable correctness issues.
- Observed broader checks outside the required task validation: repo-wide
  `npm test` fails in this worktree because CLI tests spawn
  `node_modules/.bin/tsx`, which is absent in the isolated worktree dependency
  layout; repo-wide `npm run lint` reports existing UI/test lint baseline
  errors unrelated to the touched files.

## Review Feedback

### P1

- None.

### P2

- Resolved: session revocation race during `last_used_at` touch. Added
  regression coverage and conditional update/recheck.
- Resolved: disabled-admin race during `last_used_at` touch. Added regression
  coverage and user re-read after session touch.
- Resolved: first-admin setup hashed passwords before bootstrap proof. Token
  validation now happens before Argon2id hashing.
- Resolved: `createAdminUser` accepted creation-time active/non-MFA state. New
  admins now always start `pending_mfa` with MFA required.

### P3

- None.

## Completion Notes

- Added `010_admin_auth.sql` with admin users, sessions, MFA factors,
  bootstrap tokens, and auth-attempt persistence.
- Added `src/auth/admin-service.ts` with Argon2id password hashing, session
  creation/lookup/invalidation, hash-only bootstrap token lifecycle, and
  atomic first-admin creation.
- First admin remains `pending_mfa`/non-active; TASK-006 owns MFA verification
  and activation.
- No HTTP routes, UI, OIDC login, or TOTP verification were implemented.
- Ordinary Postgram API keys are covered as non-admin credentials.
