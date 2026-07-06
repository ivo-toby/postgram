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
worktree_status: verified_pushed
pr: null
worker_thread_id: null
review_thread_id: null
current_gate: no_pr
branch_freshness: current_at_dispatch_base
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
