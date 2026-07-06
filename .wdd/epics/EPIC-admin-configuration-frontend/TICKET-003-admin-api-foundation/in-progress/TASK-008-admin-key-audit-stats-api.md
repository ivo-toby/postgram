---
id: TASK-008-admin-key-audit-stats-api
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-003-admin-api-foundation
wave: WAVE-006
slug: admin-key-audit-stats-api
title: Admin Key Audit Stats API
status: in_progress
depends_on:
  - TASK-007-admin-api-shell-diagnostics
conflict_domains:
  - src/auth/key-service.ts
  - src/services/**
  - src/transport/**
  - tests/contract/**
  - tests/integration/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-008-admin-key-audit-stats-api
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-008-admin-key-audit-stats-api
worktree_status: active_uncommitted
pr: null
worker_thread_id: 019f3748-036a-7422-9f84-ab790313375f
review_thread_id: null
current_gate: no_pr
branch_freshness: behind_epic_controller_checkpoints
verification:
  - npm test -- tests/contract/admin-key-audit-stats.test.ts
  - npm test -- tests/integration/key-service.test.ts
  - npm run typecheck
---

# TASK-008-admin-key-audit-stats-api: Admin Key Audit Stats API

## Status

in_progress

## Parent Ticket

TICKET-003-admin-api-foundation

## Wave

WAVE-006

## Objective

Expose API-key management, audit query, and stats through typed admin endpoints.

## Scope

- Included:
  - Admin endpoints for key create/list/revoke.
  - One-time plaintext key display on create only.
  - Audit query endpoint with filters and pagination.
  - Stats endpoint equivalent to safe `pgm-admin stats` behavior.
  - Step-up enforcement for key create/revoke.
- Excluded:
  - Runtime provider settings.
  - Maintenance jobs.

## Non-Scope

- Do not return key hashes or plaintext keys after creation.

## Relevant Context

### Local Context

- `src/auth/key-service.ts`
- `src/cli/admin/pgm-admin.ts`
- `src/transport/admin.ts`
- `tests/integration/key-service.test.ts`
- `tests/integration/cli-admin.test.ts`

### Shared Context References

- `../../shared-context/resources/admin-surface-inventory.md`
- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/security-model.md`

## Likely Files / Areas

- `src/services/admin-key-service.ts`
- `src/services/admin-stats-service.ts`
- `src/transport/admin.ts`
- `tests/contract/admin-key-audit-stats.test.ts`

## Dependencies

- TASK-007-admin-api-shell-diagnostics

## Conflict Domains

- `src/auth/key-service.ts`
- `src/services/**`
- `src/transport/**`
- `tests/contract/**`
- `tests/integration/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-008-admin-key-audit-stats-api

## Worker Worktree

/Users/ivo.toby/workspace/postgram/.worktrees/TASK-008-admin-key-audit-stats-api

Assigned by WAVE-006 activation and verified at pushed epic head `a41ffb4`.
The controller created and pushed branch
`codex/task/TASK-008-admin-key-audit-stats-api`, then verified this isolated
worktree contains the in-progress task file and orchestration state.

Dispatched to worker Maxwell (`019f3748-036a-7422-9f84-ab790313375f`) at
2026-07-06T11:49:24Z.

Controller heartbeat at 2026-07-06T12:10:24Z observed Maxwell still running,
no PR, and active uncommitted changes in expected TASK-008 areas:
`src/transport/admin.ts`, admin key/audit/stats services, and
`tests/contract/admin-key-audit-stats.test.ts`. `git diff --check` passed. The
task branch is one controller checkpoint behind the epic branch and must be
refreshed before review or merge.

Controller heartbeat at 2026-07-06T12:25:24Z observed Maxwell still running,
no PR, and active uncommitted changes in expected TASK-008 areas, now including
`src/auth/key-service.ts`. Tracked `git diff --check` passed. The task branch
is two controller checkpoints behind the epic branch and must be refreshed
before review or merge.

Controller heartbeat at 2026-07-06T12:40:24Z observed Maxwell still running,
no PR, and recent activity in expected TASK-008 files:
`src/auth/key-service.ts`, `src/services/admin-audit-service.ts`,
`src/transport/admin.ts`, and `tests/contract/admin-key-audit-stats.test.ts`.
Tracked `git diff --check` passed. The task branch is three controller
checkpoints behind the epic branch and must be refreshed before review or
merge.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add tests for key create/list/revoke, audit filters, stats, step-up required,
and redaction.

### GREEN

Implement endpoints using shared services and existing key primitives.

### REFACTOR

Extract duplicated CLI logic into services only where it reduces drift.

## Implementation Notes

- Preserve existing key scope/type/visibility semantics.
- Audit admin key mutations with admin actor attribution.
- Do not log plaintext keys.
- Use `audit_log.admin_user_id` from WAVE-004 for structured admin actor
  attribution; do not rely on free-form JSON details as the only actor record.
- Key create/revoke must compose the active-MFA admin gate with recent step-up.
  One-time plaintext key display remains create-response-only.
- Extend the existing WAVE-005 `/admin/api/*` admin transport rather than
  adding a parallel route family. Keep `/admin/api/diagnostics/*` working with
  active-MFA sessions while adding key, audit, and stats routes.
- New tests should include a regression that diagnostics routes still reject
  ordinary API-key/MCP OAuth bearer tokens and pending-MFA sessions after key,
  audit, and stats endpoints are registered.
- Reuse WAVE-005 redaction posture for stats and audit responses: no API key
  hashes, plaintext keys, token prefixes, provider secrets, or arbitrary
  provider validation metadata.

## Durable Memory Notes To Consider

- Record stable admin API key management contract if it affects docs or future
  workers.

## Task-Level Definition of Done

- [ ] Key management endpoints are covered.
- [ ] Audit/stats endpoints are covered.
- [ ] Step-up protects sensitive key mutations.
- [ ] Secrets and hashes are redacted.

## Validation Steps

- `npm test -- tests/contract/admin-key-audit-stats.test.ts`
- `npm test -- tests/integration/key-service.test.ts`
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
