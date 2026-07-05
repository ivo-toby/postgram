---
id: TASK-014-admin-job-foundation
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-006-maintenance-jobs
wave: WAVE-006
slug: admin-job-foundation
title: Admin Job Foundation
status: todo
depends_on:
  - TASK-006-admin-mfa-step-up
  - TASK-009-settings-secret-store
conflict_domains:
  - src/db/migrations/**
  - src/services/**
  - src/transport/**
  - tests/helpers/**
  - tests/integration/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-014-admin-job-foundation
worker_worktree: null
worktree_status: unassigned
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: not_started
branch_freshness: unknown
verification:
  - npm test -- tests/integration/admin-job-service.test.ts
  - npm run typecheck
---

# TASK-014-admin-job-foundation: Admin Job Foundation

## Status

todo

## Parent Ticket

TICKET-006-maintenance-jobs

## Wave

WAVE-006

## Objective

Add an admin job model for long-running or dangerous maintenance operations.

## Scope

- Included:
  - Job persistence, status transitions, progress, result summaries, and audit.
  - Service APIs for create/read/update/cancel if in scope.
  - Admin API shell for job status.
  - Tests for idempotency and status transitions.
- Excluded:
  - Specific graph/memory/embedding maintenance operations.
  - UI.

## Non-Scope

- Do not run unbounded maintenance work inside an ordinary request without job
  tracking.

## Relevant Context

### Local Context

- `src/cli/admin/pgm-admin.ts`
- `src/services/queue-service.ts`
- `src/util/errors.ts`
- `tests/helpers/postgres.ts`

### Shared Context References

- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/security-model.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `src/services/admin-job-service.ts`
- `src/db/migrations/*admin_jobs*.sql`
- `src/transport/admin.ts`
- `tests/integration/admin-job-service.test.ts`

## Dependencies

- TASK-006-admin-mfa-step-up
- TASK-009-settings-secret-store

## Conflict Domains

- `src/db/migrations/**`
- `src/services/**`
- `src/transport/**`
- `tests/helpers/**`
- `tests/integration/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-014-admin-job-foundation

## Worker Worktree

None assigned yet.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add tests for job creation, status transitions, progress updates, result
storage, cancellation behavior if supported, and admin actor audit metadata.

### GREEN

Implement job persistence and service helpers.

### REFACTOR

Keep job runner plumbing generic enough for multiple maintenance types without
creating an overbroad abstraction.

## Implementation Notes

- Jobs should record requested scope and dry-run/apply mode.
- Repeated clicks should not create confusing duplicate destructive jobs.

## Durable Memory Notes To Consider

- Store durable memory if a stable job model is chosen.

## Task-Level Definition of Done

- [ ] Job model is persisted and covered.
- [ ] Job status API exists.
- [ ] Audit metadata records admin actor.
- [ ] Long-running maintenance tasks have a target foundation.

## Validation Steps

- `npm test -- tests/integration/admin-job-service.test.ts`
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
