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
actions.

## Scope

- Included:
  - TOTP enrollment, verification, disable/reset guardrails if in first scope.
  - Session state indicating MFA completion.
  - Recent re-auth or step-up marker for sensitive actions.
  - Middleware/helper for endpoints requiring step-up.
  - Tests for bypass attempts.
- Excluded:
  - WebAuthn unless Wave 1 explicitly made it first scope.
  - UI screens.

## Non-Scope

- Do not allow production/admin posture without MFA unless Wave 1 records a
  deliberate exception.

## Relevant Context

### Local Context

- `src/auth/admin-service.ts`
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
step-up required on sensitive placeholder endpoint, and replay/expired step-up.

### GREEN

Implement TOTP service, MFA routes, session updates, and step-up middleware.

### REFACTOR

Keep MFA helpers isolated from ordinary API-key auth.

## Implementation Notes

- Use well-reviewed primitives or small focused implementation for TOTP.
- Never return stored TOTP secret after enrollment.
- Audit MFA enrollment and step-up sensitive operations.

## Durable Memory Notes To Consider

- Store durable memory if the MFA requirement or step-up model becomes a stable
  project convention.

## Task-Level Definition of Done

- [ ] MFA enrollment and challenge are covered.
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
