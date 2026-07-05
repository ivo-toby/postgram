---
id: TASK-015-maintenance-admin-api
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-006-maintenance-jobs
wave: WAVE-007
slug: maintenance-admin-api
title: Maintenance Admin API
status: todo
depends_on:
  - TASK-008-admin-key-audit-stats-api
  - TASK-010-provider-config-apply
  - TASK-014-admin-job-foundation
conflict_domains:
  - src/cli/admin/pgm-admin.ts
  - src/services/**
  - src/transport/**
  - tests/contract/**
  - tests/integration/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-015-maintenance-admin-api
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm test -- tests/contract/admin-maintenance-api.test.ts
  - npm test -- tests/integration/cli-admin.test.ts
  - npm run typecheck
---

# TASK-015-maintenance-admin-api: Maintenance Admin API

## Status

todo

## Parent Ticket

TICKET-006-maintenance-jobs

## Wave

WAVE-007

## Objective

Expose the approved first maintenance operations through typed admin APIs using
shared services, dry-run previews, step-up auth, jobs, and audit.

## Scope

- Included:
  - First-scope maintenance operations selected by TASK-001.
  - Service extraction from `pgm-admin` where needed.
  - Dry-run and apply endpoints.
  - Job-backed progress where operations are long-running.
  - Regression coverage for CLI behavior where services are shared.
- Excluded:
  - Raw SQL.
  - Generic purge unless TASK-001 explicitly approves a constrained variant.

## Non-Scope

- Do not shell out to `pgm-admin` from the web server.

## Relevant Context

### Local Context

- `src/cli/admin/pgm-admin.ts`
- `src/services/memory-grooming-service.ts`
- `src/services/edge-service.ts`
- `src/services/edge-validation-service.ts`
- `src/services/embeddings/admin.ts`
- `tests/integration/cli-admin.test.ts`

### Shared Context References

- `../../shared-context/resources/admin-surface-inventory.md`
- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `src/services/admin-maintenance-service.ts`
- `src/transport/admin.ts`
- `src/cli/admin/pgm-admin.ts`
- `tests/contract/admin-maintenance-api.test.ts`
- `tests/integration/cli-admin.test.ts`

## Dependencies

- TASK-008-admin-key-audit-stats-api
- TASK-010-provider-config-apply
- TASK-014-admin-job-foundation

## Conflict Domains

- `src/cli/admin/pgm-admin.ts`
- `src/services/**`
- `src/transport/**`
- `tests/contract/**`
- `tests/integration/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-015-maintenance-admin-api

## Worker Worktree

None assigned yet.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add tests for one or more approved dry-run/apply maintenance operations,
step-up requirement, job creation/progress, audit, and CLI regression.

### GREEN

Extract service logic and wire admin endpoints to it.

### REFACTOR

Keep command-specific logic typed and bounded rather than generic.

## Implementation Notes

- Keep operation scopes explicit: all/type/id/failed/limit as applicable.
- Surface cost or destructive implications in response metadata for the UI.
- Compose WAVE-003 session/CSRF middleware with the WAVE-004 active-MFA gate.
  Apply/destructive operations require recent step-up.
- Write mutation audit rows with structured `audit_log.admin_user_id`.
- If an operation reads provider/runtime config state, use the WAVE-004
  settings service redacted metadata only; do not expose or persist provider
  secrets, ciphertext, token prefixes, or arbitrary validation metadata in
  maintenance responses or job results.

## Durable Memory Notes To Consider

- Record durable memory if a command is permanently excluded or if service
  extraction changes operator conventions.

## Task-Level Definition of Done

- [ ] Approved maintenance endpoints are covered.
- [ ] Dry-run/apply and step-up are enforced.
- [ ] CLI regressions pass where services are shared.
- [ ] No raw SQL or shell execution is exposed.

## Validation Steps

- `npm test -- tests/contract/admin-maintenance-api.test.ts`
- `npm test -- tests/integration/cli-admin.test.ts`
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
