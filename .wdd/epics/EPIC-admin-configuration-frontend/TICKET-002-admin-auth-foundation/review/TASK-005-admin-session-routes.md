---
id: TASK-005-admin-session-routes
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-002-admin-auth-foundation
wave: WAVE-003
slug: admin-session-routes
title: Admin Session Routes
status: review
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
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-005-admin-session-routes
worktree_status: verified
pr: https://github.com/ivo-toby/postgram/pull/80
worker_thread_id: 019f32d9-051d-7c40-8daf-2e05d9888901
review_thread_id: 019f3308-cc6a-7010-a13e-f1417397300a
current_gate: pr_open
branch_freshness: rebased_onto_origin_epic_f2d48cd
verification:
  - npm test -- tests/contract/admin-auth-routes.test.ts
  - npm run typecheck
---

# TASK-005-admin-session-routes: Admin Session Routes

## Status

review

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

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-005-admin-session-routes

Assigned by WAVE-003 activation. The controller must create and verify this
isolated worktree before dispatch.

Verified and dispatched at 2026-07-05T15:15:57Z with worker Leibniz
(`019f32d9-051d-7c40-8daf-2e05d9888901`) on branch
`codex/task/TASK-005-admin-session-routes`.

## PR / Patch Reference

Draft PR: https://github.com/ivo-toby/postgram/pull/80

Branch `codex/task/TASK-005-admin-session-routes` targets
`codex/epic/admin-configuration-frontend`.

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

- [x] Admin session routes are covered.
- [x] Bootstrap status/setup routes are covered for valid, missing, invalid,
      expired, and already-used token states.
- [x] Admin middleware rejects ordinary API keys and OAuth tokens.
- [x] CSRF is enforced for mutations.
- [x] Lockout/rate-limit behavior is covered.

## Validation Steps

- `npm test -- tests/contract/admin-auth-routes.test.ts`
- `npm run typecheck`

## Verification Evidence

- RED: `npm test -- tests/contract/admin-auth-routes.test.ts` failed before
  implementation with 8 failing tests, all due to missing `/admin/api/*` route
  behavior returning 404.
- GREEN: `npm test -- tests/contract/admin-auth-routes.test.ts` passed
  (9 tests).
- `npm run typecheck` passed.
- Adjacent auth/transport regression coverage passed:
  `npm test -- tests/unit/errors.test.ts tests/integration/admin-auth-service.test.ts tests/integration/auth-middleware.test.ts tests/contract/oauth-routes.test.ts tests/contract/mcp-oauth.test.ts tests/contract/rest-api.test.ts`
  (50 tests).
- Direct lint on touched files passed:
  `npx eslint src/auth/admin-middleware.ts src/auth/admin-service.ts src/transport/admin.ts src/index.ts src/util/errors.ts tests/contract/admin-auth-routes.test.ts tests/integration/admin-auth-service.test.ts tests/unit/errors.test.ts`.
- `git diff --check` passed.
- Codex review gate reported no blocking correctness, security, or
  maintainability issues after the P2 fixes below.
- After rebase onto `origin/codex/epic/admin-configuration-frontend` at
  `f2d48cd`, the required admin route suite, typecheck, adjacent regression
  suite, touched-file ESLint, and `git diff --check` all passed again.
- Repo-wide `npm run lint -- ...` still reports unrelated existing lint
  baseline failures outside the TASK-005 diff; direct touched-file lint passed.

## Review Feedback

### P1

- None.

### P2

- Resolved: admin session/current and CSRF responses now use no-store headers,
  and admin session cookies are Secure in HTTPS/proxy deployments while
  remaining usable on local HTTP loopback hosts.
- Resolved: bootstrap setup now uses generic failure mapping for missing,
  invalid, expired, used, validation-failing, and rate-limited token attempts.
- Resolved: login avoids missing-user timing enumeration by using a dummy Argon2
  verify path in the TASK-004 admin password service.
- Resolved: login lockout includes a global pre-verification failure budget so
  rotating nonexistent identifiers cannot bypass the limiter.
- Resolved: internal verifier errors are propagated as server errors and are not
  recorded as credential failures.
- Resolved: valid-token bootstrap validation failures are recorded so repeated
  weak-password attempts cannot bypass bootstrap lockout.

### P3

- None.

## Completion Notes

- Worker Leibniz was dispatched at 2026-07-05T15:15:57Z. Draft PR
  https://github.com/ivo-toby/postgram/pull/80 is open against
  `codex/epic/admin-configuration-frontend`.
- Worker Leibniz implemented dedicated admin session routes in
  `src/transport/admin.ts` and admin session/CSRF middleware in
  `src/auth/admin-middleware.ts`.
- Bootstrap setup uses TASK-004 `createFirstAdminWithBootstrapToken`; login and
  session routes use `verifyAdminPassword`, `createAdminSession`,
  `findAdminSession`, and `invalidateAdminSession`.
- First-admin setup returns pending-MFA state and does not activate the admin;
  TASK-006 still owns MFA activation.
- Admin routes reject ordinary API-key and MCP OAuth bearer tokens because they
  require the dedicated HttpOnly admin session cookie.
