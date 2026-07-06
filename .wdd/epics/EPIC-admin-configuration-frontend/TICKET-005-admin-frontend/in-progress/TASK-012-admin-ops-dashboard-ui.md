---
id: TASK-012-admin-ops-dashboard-ui
kind: task
epic: EPIC-admin-configuration-frontend
ticket: TICKET-005-admin-frontend
wave: WAVE-008
slug: admin-ops-dashboard-ui
title: Admin Ops Dashboard UI
status: in_progress
depends_on:
  - TASK-008-admin-key-audit-stats-api
  - TASK-011-admin-auth-ui
conflict_domains:
  - ui/src/components/**
  - ui/src/lib/**
  - ui/src/hooks/**
assigned_model_class: implementationComplex
review_model_class: review
branch: codex/task/TASK-012-admin-ops-dashboard-ui
worker_worktree: /Users/ivo.toby/workspace/postgram/.worktrees/TASK-012-admin-ops-dashboard-ui
worktree_status: active_uncommitted
pr: null
worker_thread_id: 019f3879-c7a0-7851-b455-5fe3749adc2b
review_thread_id: null
current_gate: no_pr
branch_freshness: behind_epic_by_3_controller_checkpoints
verification:
  - npm --prefix ui run test -- --run src/components/AdminOps.test.tsx
  - npm --prefix ui run typecheck
---

# TASK-012-admin-ops-dashboard-ui: Admin Ops Dashboard UI

## Status

in_progress

## Parent Ticket

TICKET-005-admin-frontend

## Wave

WAVE-008

## Objective

Add admin dashboard pages for API-key management, audit logs, stats, health,
queue, and read-only model status.

## Scope

- Included:
  - Admin dashboard layout inside protected shell.
  - API-key list/create/revoke UI with one-time key display.
  - Audit log filters and table.
  - Stats, health, queue, and model summary panels.
  - Tests for success, errors, redaction, and step-up prompts.
- Excluded:
  - Runtime configuration edit UI.
  - Maintenance job UI.

## Non-Scope

- Do not display key hashes or stored secrets.

## Relevant Context

### Local Context

- `ui/src/lib/adminApi.ts`
- `ui/src/components/admin/AdminAuth.tsx`
- `ui/src/lib/api.ts`
- `ui/src/components/TasksPage.tsx`
- `ui/src/components/StatusWidget.tsx`
- `ui/src/components/tasks/*`

### Shared Context References

- `../../shared-context/resources/api-contracts.md`
- `../../shared-context/resources/testing-validation.md`

## Likely Files / Areas

- `ui/src/lib/adminApi.ts`
- `ui/src/components/admin/AdminDashboard.tsx`
- `ui/src/components/admin/AdminApiKeys.tsx`
- `ui/src/components/admin/AdminAudit.tsx`
- `ui/src/components/AdminOps.test.tsx`

## Dependencies

- TASK-008-admin-key-audit-stats-api
- TASK-011-admin-auth-ui

## Conflict Domains

- `ui/src/components/**`
- `ui/src/lib/**`
- `ui/src/hooks/**`

## Assigned Model Class

implementationComplex

## Branch

codex/task/TASK-012-admin-ops-dashboard-ui

## Worker Worktree

`/Users/ivo.toby/workspace/postgram/.worktrees/TASK-012-admin-ops-dashboard-ui`
assigned for WAVE-008 activation; created from pushed epic activation head
`7e5c49c` and pushed to origin.

Worker Sagan (`019f3879-c7a0-7851-b455-5fe3749adc2b`) dispatched at
2026-07-06T17:29:45Z. Await PR or patch reference.

Controller observed active uncommitted implementation work at
2026-07-06T17:47:01Z with no PR yet. The task branch is behind the epic branch
by one controller monitoring checkpoint and will need freshness verification
before merge.

Controller observed continued active uncommitted implementation work at
2026-07-06T18:02:01Z with no PR yet. The task branch is behind the epic branch
by two controller monitoring checkpoints and will need freshness verification
before merge.

Controller observed continued active uncommitted implementation work at
2026-07-06T18:17:01Z with no PR yet. The task branch is behind the epic branch
by three controller monitoring checkpoints and will need freshness verification
before merge.

## PR / Patch Reference

None yet.

## RED-GREEN TDD Plan

### RED

Add UI tests for dashboard loading, key create/revoke, one-time key display,
audit filters, and stats/health error states.

### GREEN

Implement dashboard components against admin API client.

### REFACTOR

Extract reusable dense table and confirmation patterns if they reduce
duplication.

## Implementation Notes

- Keep text within compact controls and avoid marketing-style layout.
- Key create/revoke should surface step-up requirement clearly.
- Extend the WAVE-007 admin API client in `ui/src/lib/adminApi.ts`; do not add
  a parallel admin auth store or localStorage-backed admin credential path.
- Use the WAVE-006 route contracts: `/admin/api/keys`,
  `/admin/api/keys/:id/revoke`, `/admin/api/audit`, `/admin/api/stats`,
  `/admin/api/diagnostics/health`, `/diagnostics/queue`,
  `/diagnostics/models`, and `/diagnostics/config-status`.
- API-key plaintext is one-time display only after create. It must not be
  recoverable from list/audit views or stored in localStorage.
- Key create/revoke mutations require CSRF and recent step-up; use the existing
  WAVE-007 step-up flow rather than prompting for another credential.
- Audit/details UI must preserve server-side redaction and must not try to
  reconstruct hidden secret values from details.

## Durable Memory Notes To Consider

- Record durable memory only for stable UI/admin workflow conventions.

## Task-Level Definition of Done

- [ ] Dashboard pages are implemented and covered.
- [ ] Key plaintext appears only immediately after create.
- [ ] Audit/stats/queue states are usable.
- [ ] UI typecheck passes.

## Validation Steps

- `npm --prefix ui run test -- --run src/components/AdminOps.test.tsx`
- `npm --prefix ui run typecheck`

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
