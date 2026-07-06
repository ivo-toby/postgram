---
id: TASK-015-maintenance-admin-api
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-006-maintenance-jobs
wave: WAVE-007
slug: maintenance-admin-api
title: Maintenance Admin API
status: in_progress
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
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-015-maintenance-admin-api
worktree_status: active_uncommitted
pr: null
worker_thread_id: 019f37c5-7084-7920-916a-7fd9ac7d8cb6
review_thread_id: null
current_gate: no_pr
branch_freshness: behind_epic_controller_checkpoint
verification:
  - npm test -- tests/contract/admin-maintenance-api.test.ts
  - npm test -- tests/integration/cli-admin.test.ts
  - npm run typecheck
---

# TASK-015-maintenance-admin-api: Maintenance Admin API

## Status

in_progress

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

Active at `/Users/ivo.toby/workspace/postgram/.worktrees/TASK-015-maintenance-admin-api`.

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
- If an operation needs provider/runtime configuration, read WAVE-005 applied
  provider state rather than pending edits. Maintenance dry-run and apply
  responses must make restart-required or reembed-required implications clear
  without copying provider secrets or unsafe validation metadata into jobs.

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

- 2026-07-06T14:11:59Z: Branch/worktree setup verified at activation base
  `848b902`; worker Helmholtz
  (`019f37c5-7084-7920-916a-7fd9ac7d8cb6`) dispatched. Task implementation
  verification has not run yet.
- 2026-07-06T14:29:25Z: Helmholtz was still running with no PR or patch. The
  worktree has active uncommitted changes in expected backend maintenance API
  files: `src/cli/admin/pgm-admin.ts`, `src/transport/admin.ts`,
  `src/services/admin-maintenance-service.ts`,
  `src/transport/admin-maintenance.ts`, and
  `tests/contract/admin-maintenance-api.test.ts`. Tracked `git diff --check`
  passed; the branch is one controller checkpoint behind the epic branch and
  must refresh before review or merge.

## Review Feedback

### P1

- None.

### P2

- None.

### P3

- None.

## Completion Notes

- None yet.
