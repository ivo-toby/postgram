---
id: TASK-006-admin-mfa-step-up
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-002-admin-auth-foundation
wave: WAVE-004
slug: admin-mfa-step-up
title: Admin MFA And Step-Up
status: todo
depends_on:
  - TASK-004-admin-auth-persistence
  - TASK-005-admin-session-routes
conflict_domains:
  - src/auth/**
  - src/transport/**
  - tests/contract/**
  - tests/integration/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-006-admin-mfa-step-up
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm test -- tests/contract/admin-mfa-routes.test.ts
  - npm test -- tests/integration/admin-auth-service.test.ts
  - npm run typecheck
---

# TASK-006-admin-mfa-step-up: Admin MFA And Step-Up

## Status

todo

## Parent Ticket

TICKET-002-admin-auth-foundation

## Wave

WAVE-004

## Objective

Add TOTP MFA enrollment/challenge and step-up enforcement for sensitive admin
actions, including the first-admin transition from pending setup state to
active admin access.

## Scope

- Included:
  - TOTP enrollment, verification, disable/reset guardrails if in first scope.
  - Session state indicating MFA completion.
  - First-admin setup completion: verify MFA enrollment/challenge and atomically
    transition the TASK-004 pending first admin to active status.
  - Recent re-auth or step-up marker for sensitive actions.
  - Middleware/helper for endpoints requiring step-up.
  - Tests for bypass attempts and for the inactive/pending first admin before
    MFA completion.
- Excluded:
  - WebAuthn unless Wave 1 explicitly made it first scope.
  - UI screens.

## Non-Scope

- Do not allow production/admin posture without MFA unless Wave 1 records a
  deliberate exception.

## Relevant Context

### Local Context

- `src/auth/admin-service.ts`
- `src/db/migrations/010_admin_auth.sql`
- `src/transport/admin.ts`
- `tests/contract/admin-auth-routes.test.ts`
- `tests/integration/admin-auth-service.test.ts`

### Shared Context References

- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `src/auth/admin-mfa-service.ts`
- `src/auth/admin-middleware.ts`
- `src/transport/admin.ts`
- `tests/contract/admin-mfa-routes.test.ts`

## Dependencies

- TASK-004-admin-auth-persistence
- TASK-005-admin-session-routes

## Conflict Domains

- `src/auth/**`
- `src/transport/**`
- `tests/contract/**`
- `tests/integration/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-006-admin-mfa-step-up

## Worker Worktree

None assigned yet.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add tests for MFA enrollment, challenge failure/success, session before MFA,
pending first-admin denial before MFA completion, active first-admin transition
after verified MFA, step-up required on sensitive placeholder endpoint, and
replay/expired step-up.

### GREEN

Implement TOTP service, MFA routes, session updates, and step-up middleware.

### REFACTOR

Keep MFA helpers isolated from ordinary API-key auth.

## Implementation Notes

- Use well-reviewed primitives or small focused implementation for TOTP.
- Never return stored TOTP secret after enrollment.
- Audit MFA enrollment and step-up sensitive operations.
- TASK-004 owns bootstrap token persistence and pending first-admin state;
  TASK-005 owns route/session/CSRF behavior; this task owns the testable
  transition that a first admin is not active until MFA is verified.
- Use the merged `admin_mfa_factors` table and `admin_sessions.mfa_verified_at`
  state from TASK-004. Do not introduce a second MFA/session state model.
- The first-admin activation path must update the `pending_mfa` admin to
  `active` only after verified TOTP enrollment/challenge, and must not return
  stored TOTP secrets after enrollment.
- TASK-005 now provides `/admin/api/session/current`,
  `/admin/api/session/csrf`, and `/admin/api/session/logout` for a valid
  `pgm_admin_session` cookie, plus CSRF enforcement through `X-CSRF-Token`.
  Keep those setup/session routes usable for pending-MFA sessions, but add a
  separate active-admin/MFA guard for privileged admin operations.
- `createAdminSessionMiddleware` currently proves a valid session and CSRF
  token; it does not by itself prove the admin user is `active` or MFA-verified.
  This task must add the helper/middleware that future admin APIs compose on
  top of it.
- Tests should explicitly prove ordinary API-key bearer tokens, MCP OAuth
  bearer tokens, and pending-MFA sessions cannot bypass the MFA/active-admin
  gate.

## Durable Memory Notes To Consider

- Store durable memory if the MFA requirement or step-up model becomes a stable
  project convention.

## Task-Level Definition of Done

- [ ] MFA enrollment and challenge are covered.
- [ ] First admin remains non-active/pending until MFA enrollment and
      verification complete.
- [ ] First admin becomes active only through the MFA completion path.
- [ ] Sensitive action step-up helper exists and is tested.
- [ ] API-key bearer tokens cannot bypass MFA/admin auth.
- [ ] Secrets are redacted.

## Validation Steps

- `npm test -- tests/contract/admin-mfa-routes.test.ts`
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
