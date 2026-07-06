---
id: TASK-007-admin-api-shell-diagnostics
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-003-admin-api-foundation
wave: WAVE-005
slug: admin-api-shell-diagnostics
title: Admin API Shell And Diagnostics
status: in_progress
depends_on:
  - TASK-005-admin-session-routes
  - TASK-006-admin-mfa-step-up
conflict_domains:
  - src/transport/**
  - src/services/**
  - tests/contract/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-007-admin-api-shell-diagnostics
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-007-admin-api-shell-diagnostics
worktree_status: clean_pushed
pr: null
worker_thread_id: 019f35ff-5f3c-7cc0-aa6e-78941a3fd7fd
review_thread_id: null
current_gate: no_pr
branch_freshness: current_at_dispatch
verification:
  - npm test -- tests/contract/admin-api.test.ts
  - npm run typecheck
---

# TASK-007-admin-api-shell-diagnostics: Admin API Shell And Diagnostics

## Status

in_progress

## Parent Ticket

TICKET-003-admin-api-foundation

## Wave

WAVE-005

## Objective

Add the authenticated admin API shell and first read-only diagnostics endpoints.

## Scope

- Included:
  - Admin API route namespace after admin middleware.
  - Read-only health, queue, model list, and safe configuration status.
  - Contract tests for session auth, CSRF behavior where relevant, and bearer
    denial.
- Excluded:
  - Mutating key/config/maintenance endpoints.

## Non-Scope

- Do not duplicate ordinary user API behavior unless admin semantics differ.

## Relevant Context

### Local Context

- `src/index.ts`
- `src/transport/rest.ts`
- `src/transport/admin.ts`
- `src/auth/admin-middleware.ts`
- `src/services/queue-service.ts`
- `src/services/embeddings/admin.ts`
- `tests/contract/rest-api.test.ts`

### Shared Context References

- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `src/transport/admin.ts`
- `src/services/admin-diagnostics-service.ts`
- `tests/contract/admin-api.test.ts`

## Dependencies

- TASK-005-admin-session-routes
- TASK-006-admin-mfa-step-up

## Conflict Domains

- `src/transport/**`
- `src/services/**`
- `tests/contract/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-007-admin-api-shell-diagnostics

## Worker Worktree

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-007-admin-api-shell-diagnostics

Assigned by WAVE-005 activation. The controller must create and verify this
isolated worktree before dispatch.

Verified and dispatched at 2026-07-06T05:56:19Z with worker Wegener
(`019f35ff-5f3c-7cc0-aa6e-78941a3fd7fd`) on branch
`codex/task/TASK-007-admin-api-shell-diagnostics`.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add contract tests for admin diagnostics success with session and failure with
ordinary API-key bearer auth.

### GREEN

Implement admin diagnostics routes and service helpers.

### REFACTOR

Keep route response shapes reusable for frontend API client.

## Implementation Notes

- Diagnostics must not reveal stored secret values.
- Prefer existing queue/health/model helpers when safe.
- Use the WAVE-003 `/admin/api/*` route family and `createAdminSessionMiddleware`
  for session/CSRF behavior; do not add a second admin auth system.
- Diagnostics should require the active-admin/MFA guard from TASK-006. A valid
  pending-MFA session is enough for setup/current/csrf/logout, but not for
  operational diagnostics.
- Compose `createAdminSessionMiddleware({ pool })` with
  `createActiveAdminMiddleware()` from `src/auth/admin-middleware.ts`.
  Diagnostics are read-only, so they should not require recent step-up unless a
  diagnostic exposes sensitive secret/config metadata beyond coarse status.
- Use `admin_settings_service` redacted metadata only for safe configuration
  status. Do not return stored provider secrets, ciphertext, token prefixes, or
  arbitrary secret validation metadata.
- Contract tests must prove ordinary Postgram API-key bearer tokens and MCP
  OAuth bearer tokens still fail on the admin diagnostics routes.
- Contract tests must also prove a pending-MFA session receives `403` from the
  diagnostics shell while an active MFA session succeeds.

## Durable Memory Notes To Consider

- Record stable admin route namespace if it becomes settled here.

## Task-Level Definition of Done

- [ ] Admin diagnostics API exists.
- [ ] Ordinary bearer auth is rejected.
- [ ] Responses are redacted.
- [ ] Contract tests pass.

## Validation Steps

- `npm test -- tests/contract/admin-api.test.ts`
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
