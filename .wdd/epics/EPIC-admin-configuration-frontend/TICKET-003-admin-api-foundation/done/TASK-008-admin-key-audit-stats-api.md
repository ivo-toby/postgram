---
id: TASK-008-admin-key-audit-stats-api
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-003-admin-api-foundation
wave: WAVE-006
slug: admin-key-audit-stats-api
title: Admin Key Audit Stats API
status: done
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
worktree_status: cleanup_deferred
pr: https://github.com/ivo-toby/postgram/pull/85
worker_thread_id: 019f3748-036a-7422-9f84-ab790313375f
review_thread_id: 019f322c-02e7-7590-8b8e-ebdd1e9c52ac
current_gate: merged
branch_freshness: current_at_merge
verification:
  - npm test -- tests/contract/admin-key-audit-stats.test.ts
  - npm test -- tests/integration/key-service.test.ts
  - npm run typecheck
---

# TASK-008-admin-key-audit-stats-api: Admin Key Audit Stats API

## Status

done

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

Controller heartbeat at 2026-07-06T12:55:24Z observed Maxwell still running,
no PR or patch, and the assigned worktree has staged the TASK-008 task file as
an `in-progress/` to `review/` move without publishing a branch commit or PR.
Tracked `git diff --check` passed. The task branch is four controller
checkpoints behind the epic branch and must be refreshed before review or
merge. Controller queued exact missing-deliverable nudge
`019f3781-76cc-7191-8d71-ad402f5aee47`: commit/push the TASK-008 work and
open a PR against the epic branch, or provide a patch reference if PR creation
is blocked.

## PR / Patch Reference

Draft PR: https://github.com/ivo-toby/postgram/pull/85

Merged locally into the epic branch in `13465eb` after Lorentz returned
`REVIEW_PASS`. GitHub marked PR #85 `MERGED` at
2026-07-06T13:19:57Z after the epic branch push.

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

- [x] Key management endpoints are covered.
- [x] Audit/stats endpoints are covered.
- [x] Step-up protects sensitive key mutations.
- [x] Secrets and hashes are redacted.

## Validation Steps

- `npm test -- tests/contract/admin-key-audit-stats.test.ts`
- `npm test -- tests/integration/key-service.test.ts`
- `npm run typecheck`

## Verification Evidence

- PASS `npm test -- tests/contract/admin-key-audit-stats.test.ts` (10 tests,
  includes explicit `operation=audit.query` pagination and no-body revoke
  regressions).
- PASS `npm test -- tests/integration/key-service.test.ts` (3 tests).
- PASS `npm run typecheck`.
- PASS `npx eslint src/auth/key-service.ts src/transport/admin.ts src/services/admin-audit-service.ts src/services/admin-key-service.ts src/services/admin-stats-service.ts tests/contract/admin-key-audit-stats.test.ts --quiet`.
- PASS `git diff --check`.
- PASS post-merge `npm test -- tests/contract/admin-key-audit-stats.test.ts`
  on the epic branch (10 tests).
- PASS post-merge `npm test -- tests/integration/key-service.test.ts` on the
  epic branch (3 tests).
- PASS post-merge `npm run typecheck` on the epic branch.
- PASS post-merge touched-file ESLint on the epic branch.
- PASS post-merge `git diff --check HEAD^..HEAD`.
- Lorentz review returned `REVIEW_PASS` with no P1/P2/P3 findings at PR head
  `281681b8f6be6a30c6a4ec53f9b646154f85d8bc`.

## Review Feedback

### P1

- None.

### P2

- Fixed review-found P2: explicit `operation=audit.query` pagination no longer
  includes admin audit API self-observation rows written between pages.
- Fixed review-found P2: key create/revoke mutation and required audit insert
  now commit or roll back together.
- Fixed review-found P2: malformed UUID filters/revoke IDs and oversized
  offsets return validation errors instead of storage errors or unbounded
  pagination.
- Fixed review-found P2: duplicate key names return conflict instead of a 500.
- Fixed review-found P2: audit detail redaction covers common API-key aliases
  and secret-looking values.
- Fixed review-found P2: valid revoke requests now accept an empty request body
  instead of requiring callers to send `{}` JSON.

### P3

- None.

## Completion Notes

- Implemented additive `/admin/api/keys`, `/admin/api/audit`, and
  `/admin/api/stats` routes without changing diagnostics/provider-config route
  registrations.
- Key create/revoke require active MFA, CSRF, and recent step-up; list/audit/stats
  require active MFA.
- Key hashes and prefixes are never returned; plaintext is returned only in the
  one-time create response.
- Admin key/list/create/revoke/audit/stats service actions write structured
  `audit_log.admin_user_id` attribution.
- Worker concern remains recorded as non-blocking: full `npm test` still fails
  in the worker worktree on a pre-existing CLI subprocess
  `node_modules/.bin/tsx ENOENT`; targeted TASK-008 gates and post-merge gates
  passed.
