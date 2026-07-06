---
id: TASK-014-admin-job-foundation
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-006-maintenance-jobs
wave: WAVE-006
slug: admin-job-foundation
title: Admin Job Foundation
status: review
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
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-014-admin-job-foundation
worktree_status: verified_pushed
pr: pending draft PR
worker_thread_id: null
review_thread_id: null
current_gate: ready_for_review
branch_freshness: current_at_dispatch_base
verification:
  - npm test -- tests/integration/admin-job-service.test.ts
  - npm run typecheck
---

# TASK-014-admin-job-foundation: Admin Job Foundation

## Status

review

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

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-014-admin-job-foundation

Assigned by WAVE-006 activation and verified at pushed epic head `a41ffb4`.
The controller created and pushed branch
`codex/task/TASK-014-admin-job-foundation`, then verified this isolated
worktree contains the in-progress task file and orchestration state.

## PR / Patch Reference

Pending draft PR creation.

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
- Use WAVE-004 `audit_log.admin_user_id` for structured admin actor
  attribution on job create/update/cancel audit events.
- Job-backed sensitive apply operations must require active MFA and recent
  step-up; dry-run/read-only job status may use active-MFA without step-up
  unless it exposes sensitive metadata.
- If jobs reference runtime settings or provider secrets, record only setting
  keys/secret names and redacted metadata. Do not store plaintext secrets,
  ciphertext, token prefixes, or arbitrary secret validation metadata in job
  payloads or result summaries.
- Treat WAVE-005 provider configuration as pending/applied state: pending
  provider edits are not runtime state until validation/apply succeeds, and
  jobs that need provider/runtime context should reference applied values or
  safe setting identifiers only.
- Job status routes should live under the existing `/admin/api/*` transport and
  coexist with diagnostics and provider-config routes without changing their
  auth/CSRF behavior.

## Durable Memory Notes To Consider

- Store durable memory if a stable job model is chosen.

## Task-Level Definition of Done

- [x] Job model is persisted and covered.
- [x] Job status API exists.
- [x] Audit metadata records admin actor.
- [x] Long-running maintenance tasks have a target foundation.

## Validation Steps

- `npm test -- tests/integration/admin-job-service.test.ts`
- `npm run typecheck`

## Verification Evidence

- `npm test -- tests/integration/admin-job-service.test.ts` - PASS (5 tests)
- `npm run typecheck` - PASS
- `npm test -- tests/contract/admin-api.test.ts` - PASS (3 tests)
- `npx eslint src/services/admin-job-service.ts src/transport/admin-jobs.ts tests/integration/admin-job-service.test.ts tests/helpers/postgres.ts src/transport/admin.ts` - PASS
- `git diff --check` - PASS
- `codex review --uncommitted` - PASS; no actionable P0/P1/P2 correctness issues found.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- Added `admin_jobs` and `admin_job_events` persistence for queued/running/cancel-requested/terminal lifecycle state, progress, requested scope, request summary, result summary, and idempotency.
- Added `admin-job-service` helpers for create/read/list/start/progress/cancel/complete with structured admin actor audit events.
- Added read-only `/admin/api/jobs` and `/admin/api/jobs/:jobId` status routes under active MFA, leaving existing admin transport behavior additive.
- Enforced active MFA for job creation, recent step-up plus scoped idempotency for apply jobs, and summary safety guards that reject provider secrets, ciphertext, token prefixes, arbitrary validation metadata, and provider metadata/body containers.
- Did not implement specific maintenance operations or UI.
