---
id: TASK-005-admin-session-routes
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-002-admin-auth-foundation
wave: WAVE-003
slug: admin-session-routes
title: Admin Session Routes
status: todo
depends_on:
  - TASK-004-admin-auth-persistence
conflict_domains:
  - src/auth/**
  - src/transport/**
  - src/index.ts
  - tests/contract/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-005-admin-session-routes
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm test -- tests/contract/admin-auth-routes.test.ts
  - npm run typecheck
---

# TASK-005-admin-session-routes: Admin Session Routes

## Status

todo

## Parent Ticket

TICKET-002-admin-auth-foundation

## Wave

WAVE-003

## Objective

Add first-run bootstrap, login/logout/current-session routes, admin middleware,
CSRF protection, and login lockout/rate-limit behavior.

## Scope

- Included:
  - Dedicated admin route registration.
  - Bootstrap route according to Wave 1 decision.
  - Session cookie issuance and clearing.
  - CSRF token issuance and mutation enforcement.
  - Admin middleware rejecting missing/expired sessions.
  - Tests proving ordinary bearer tokens do not authorize admin endpoints.
- Excluded:
  - MFA implementation beyond "MFA required" placeholders if needed.
  - Admin business endpoints.

## Non-Scope

- Do not mount admin operations under ordinary `/api/*` bearer middleware.

## Relevant Context

### Local Context

- `src/index.ts`
- `src/auth/middleware.ts`
- `src/auth/bearer.ts`
- `src/transport/rest.ts`
- `src/transport/oauth.ts`
- `tests/contract/oauth-routes.test.ts`

### Shared Context References

- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `src/transport/admin.ts`
- `src/auth/admin-middleware.ts`
- `src/index.ts`
- `tests/contract/admin-auth-routes.test.ts`

## Dependencies

- TASK-004-admin-auth-persistence

## Conflict Domains

- `src/auth/**`
- `src/transport/**`
- `src/index.ts`
- `tests/contract/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-005-admin-session-routes

## Worker Worktree

None assigned yet.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Write route tests for bootstrap status, successful login, logout, current
session, CSRF rejection, lockout/rate-limit behavior, and bearer-token denial.

### GREEN

Implement admin route module and middleware using the admin persistence service.

### REFACTOR

Keep route parsing and cookie helpers focused and reusable for MFA routes.

## Implementation Notes

- Cookie flags must be explicit and environment-aware for secure deployments.
- Mutating admin requests must fail without CSRF.
- Avoid leaking whether a username exists in login errors.

## Durable Memory Notes To Consider

- Store durable memory if bootstrap behavior becomes a stable deployment rule.

## Task-Level Definition of Done

- [ ] Admin session routes are covered.
- [ ] Admin middleware rejects ordinary API keys and OAuth tokens.
- [ ] CSRF is enforced for mutations.
- [ ] Lockout/rate-limit behavior is covered.

## Validation Steps

- `npm test -- tests/contract/admin-auth-routes.test.ts`
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
