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
  - Bootstrap status/setup routes according to the Wave 1 decision, backed by
    TASK-004 bootstrap token and pending first-admin services.
  - Route behavior for missing, expired, used, invalid, and rate-limited
    bootstrap tokens without leaking token validity details.
  - Session cookie issuance and clearing.
  - CSRF token issuance and mutation enforcement.
  - Admin middleware rejecting missing/expired sessions.
  - Tests proving ordinary bearer tokens do not authorize admin endpoints.
- Excluded:
  - MFA implementation beyond "MFA required/pending" placeholders if needed.
  - Activating the first admin after MFA; TASK-006 owns that transition.
  - Admin business endpoints.

## Non-Scope

- Do not mount admin operations under ordinary `/api/*` bearer middleware.

## Relevant Context

### Local Context

- `src/index.ts`
- `src/auth/admin-service.ts`
- `src/auth/middleware.ts`
- `src/auth/bearer.ts`
- `src/transport/rest.ts`
- `src/transport/oauth.ts`
- `src/db/migrations/010_admin_auth.sql`
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

Write route tests for bootstrap status, setup refusal without a valid token,
used/expired bootstrap token behavior, successful login, logout, current
session, CSRF rejection, lockout/rate-limit behavior, and bearer-token denial.

### GREEN

Implement admin route module and middleware using the admin persistence service.

### REFACTOR

Keep route parsing and cookie helpers focused and reusable for MFA routes.

## Implementation Notes

- Cookie flags must be explicit and environment-aware for secure deployments.
- Mutating admin requests must fail without CSRF.
- Avoid leaking whether a username exists in login errors.
- Bootstrap status may be public, but it must expose only state and never token
  material.
- Bootstrap setup routes must use the TASK-004 atomic persistence service; the
  route layer owns HTTP parsing, cookies/session behavior, CSRF semantics, and
  safe error mapping.
- Use `createFirstAdminWithBootstrapToken`, `verifyAdminPassword`,
  `createAdminSession`, `findAdminSession`, and `invalidateAdminSession` from
  `src/auth/admin-service.ts` rather than reimplementing token/password logic.
- If TASK-006 is not implemented yet, first-admin setup must leave the account
  pending/non-active and return a state that cannot be used as full admin
  access.
- Route tests must prove admin routes reject ordinary Postgram API-key bearer
  tokens and MCP OAuth bearer tokens even when those credentials are otherwise
  valid for non-admin APIs.
- Bootstrap/login error responses must not reveal username existence or whether
  a guessed bootstrap token was missing, expired, used, or malformed.

## Durable Memory Notes To Consider

- Store durable memory if bootstrap behavior becomes a stable deployment rule.

## Task-Level Definition of Done

- [ ] Admin session routes are covered.
- [ ] Bootstrap status/setup routes are covered for valid, missing, invalid,
      expired, and already-used token states.
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
