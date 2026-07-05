---
id: TASK-007-admin-api-shell-diagnostics
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-003-admin-api-foundation
wave: WAVE-005
slug: admin-api-shell-diagnostics
title: Admin API Shell And Diagnostics
status: todo
depends_on:
  - TASK-005-admin-session-routes
conflict_domains:
  - src/transport/**
  - src/services/**
  - tests/contract/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-007-admin-api-shell-diagnostics
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm test -- tests/contract/admin-api.test.ts
  - npm run typecheck
---

# TASK-007-admin-api-shell-diagnostics: Admin API Shell And Diagnostics

## Status

todo

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

## Conflict Domains

- `src/transport/**`
- `src/services/**`
- `tests/contract/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-007-admin-api-shell-diagnostics

## Worker Worktree

None assigned yet.

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
